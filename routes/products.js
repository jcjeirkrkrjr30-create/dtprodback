// src/server/routes/products.js
const express = require('express');
const { query } = require('../utils/db');
const { authenticate, restrictTo } = require('../utils/auth');
const { uploadToCloudinary } = require('../utils/cloudinary');
const router = express.Router();

// Get all products (public)
router.get('/', async (req, res) => {
  try {
    const categoryId = req.query.category ? parseInt(req.query.category) : null;
    let sql = 'SELECT * FROM products WHERE available = TRUE AND is_deleted = FALSE';
    const params = [];
    if (categoryId) {
      sql += ' AND category_id = ?';
      params.push(categoryId);
    }
    sql += ' ORDER BY created_at DESC';
    const products = await query(sql, params);
    console.log('Fetched products:', products);
    res.json(products);
  } catch (error) {
    console.error('Products fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch products', details: error.message });
  }
});

// Get deleted products (admin only)
router.get('/deleted', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const products = await query('SELECT * FROM products WHERE is_deleted = TRUE ORDER BY created_at DESC');
    console.log('Fetched deleted products:', products);
    res.json(products);
  } catch (error) {
    console.error('Deleted products fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch deleted products', details: error.message });
  }
});

// Get single product (public)
router.get('/:id', async (req, res) => {
  try {
    const products = await query('SELECT * FROM products WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!products || products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    console.log('Fetched product:', products[0]);
    res.json(products[0]);
  } catch (error) {
    console.error('Product fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch product', details: error.message });
  }
});

// Add product (admin only)
router.post('/', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { name, description, regular_price, sale_price, imageBase64, galleryBase64 = [], available = true, category_id } = req.body;
    console.log('POST /api/products - Request body:', { name, description, regular_price, sale_price, imageBase64, galleryBase64: galleryBase64.length, available, category_id });

    if (!name || !description || !regular_price) {
      return res.status(400).json({ error: 'Missing required fields: name, description, regular_price' });
    }
    const regPrice = parseFloat(regular_price);
    if (isNaN(regPrice) || regPrice <= 0) {
      return res.status(400).json({ error: 'Invalid regular_price: must be a positive number' });
    }
    const saleP = sale_price ? parseFloat(sale_price) : null;
    if (sale_price && (isNaN(saleP) || saleP <= 0)) {
      return res.status(400).json({ error: 'Invalid sale_price: must be a positive number' });
    }
    if (Array.isArray(galleryBase64) && galleryBase64.length > 10) {
      return res.status(400).json({ error: 'Gallery can have at most 10 images' });
    }
    const catId = category_id ? parseInt(category_id) : null;
    if (category_id && (isNaN(catId) || catId <= 0)) {
      return res.status(400).json({ error: 'Invalid category_id' });
    }

    let image_url = null;
    if (imageBase64 && imageBase64.startsWith('data:image')) {
      try {
        image_url = await uploadToCloudinary(imageBase64);
        console.log('Uploaded main image to Cloudinary:', image_url);
      } catch (uploadError) {
        console.error('Cloudinary upload failed:', uploadError);
        return res.status(500).json({ error: 'Failed to upload main image to Cloudinary', details: uploadError.message });
      }
    }

    let gallery_images = null;
    if (Array.isArray(galleryBase64) && galleryBase64.length > 0) {
      try {
        const galleryUrls = await Promise.all(
          galleryBase64
            .filter(base64 => base64 && base64.startsWith('data:image'))
            .map(base64 => uploadToCloudinary(base64))
        );
        gallery_images = JSON.stringify(galleryUrls);
        console.log('Uploaded gallery images to Cloudinary:', galleryUrls);
      } catch (uploadError) {
        console.error('Cloudinary gallery upload failed:', uploadError);
        return res.status(500).json({ error: 'Failed to upload gallery images to Cloudinary', details: uploadError.message });
      }
    }

    const result = await query(
      'INSERT INTO products (name, description, price_per_day, sale_price, image_url, gallery_images, available, category_id, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)',
      [name, description, regPrice, saleP, image_url, gallery_images, !!available, catId]
    );
    if (!result || !result.insertId) {
      throw new Error('Failed to insert product into database');
    }
    console.log('Insert product result:', result);
    res.status(201).json({ message: 'Product added', id: result.insertId });
  } catch (error) {
    console.error('Product add error:', error);
    res.status(500).json({ error: 'Failed to add product', details: error.message });
  }
});

// Update product (admin only)
router.put('/:id', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { name, description, regular_price, sale_price, imageBase64, galleryBase64 = [], available = true, category_id } = req.body;
    console.log('PUT /api/products/:id - Request body:', { id: req.params.id, name, description, regular_price, sale_price, imageBase64, galleryBase64: galleryBase64.length, available, category_id });

    const products = await query('SELECT * FROM products WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!products || products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updateFields = {};
    if (name !== undefined && name !== '') updateFields.name = name;
    if (description !== undefined && description !== '') updateFields.description = description;
    if (regular_price !== undefined && regular_price !== '') {
      const price = parseFloat(regular_price);
      if (isNaN(price) || price <= 0) {
        return res.status(400).json({ error: 'Invalid regular_price: must be a positive number' });
      }
      updateFields.price_per_day = price;
    }
    if (sale_price !== undefined && sale_price !== '') {
      updateFields.sale_price = parseFloat(sale_price) || null;
    }
    if (category_id !== undefined) {
      updateFields.category_id = category_id ? parseInt(category_id) : null;
      if (category_id && (isNaN(updateFields.category_id) || updateFields.category_id <= 0)) {
        return res.status(400).json({ error: 'Invalid category_id' });
      }
    }
    updateFields.available = !!available;

    let image_url = products[0].image_url || null;
    if (imageBase64 && imageBase64.startsWith('data:image')) {
      try {
        image_url = await uploadToCloudinary(imageBase64);
        console.log('Uploaded main image to Cloudinary:', image_url);
        updateFields.image_url = image_url;
      } catch (uploadError) {
        console.error('Cloudinary upload failed:', uploadError);
        return res.status(500).json({ error: 'Failed to upload main image to Cloudinary', details: uploadError.message });
      }
    }

    let gallery_images = products[0].gallery_images ? JSON.parse(products[0].gallery_images) : [];
    if (Array.isArray(galleryBase64) && galleryBase64.length > 0) {
      try {
        const newGalleryUrls = await Promise.all(
          galleryBase64
            .filter(base64 => base64 && base64.startsWith('data:image'))
            .map(base64 => uploadToCloudinary(base64))
        );
        gallery_images = [...gallery_images, ...newGalleryUrls];
        if (gallery_images.length > 10) {
          return res.status(400).json({ error: 'Total gallery images cannot exceed 10' });
        }
        updateFields.gallery_images = JSON.stringify(gallery_images);
        console.log('Merged gallery images:', gallery_images);
      } catch (uploadError) {
        console.error('Cloudinary gallery upload failed:', uploadError);
        return res.status(500).json({ error: 'Failed to upload gallery images to Cloudinary', details: uploadError.message });
      }
    } else if (galleryBase64.length === 0 && req.body.existingGalleryImages) {
      gallery_images = req.body.existingGalleryImages;
      if (gallery_images.length > 10) {
        return res.status(400).json({ error: 'Total gallery images cannot exceed 10' });
      }
      updateFields.gallery_images = JSON.stringify(gallery_images);
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const setClause = Object.keys(updateFields)
      .map(field => `${field} = ?`)
      .join(', ');
    const values = [...Object.values(updateFields), req.params.id];

    const result = await query(
      `UPDATE products SET ${setClause} WHERE id = ? AND is_deleted = FALSE`,
      values
    );
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found or no changes made' });
    }
    console.log('Update product result:', result);
    res.json({ message: 'Product updated' });
  } catch (error) {
    console.error('Product update error:', error);
    res.status(500).json({ error: 'Failed to update product', details: error.message });
  }
});

// Delete product (admin only)
router.delete('/:id', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const result = await query('UPDATE products SET is_deleted = TRUE WHERE id = ? AND is_deleted = FALSE', [req.params.id]);
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    console.log('Soft delete product result:', result);
    res.json({ message: 'Product deleted' });
  } catch (error) {
    console.error('Product delete error:', error);
    res.status(500).json({ error: 'Failed to delete product', details: error.message });
  }
});

// Restore product (admin only)
router.put('/:id/restore', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const result = await query('UPDATE products SET is_deleted = FALSE WHERE id = ? AND is_deleted = TRUE', [req.params.id]);
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found in trash' });
    }
    console.log('Restore product result:', result);
    res.json({ message: 'Product restored' });
  } catch (error) {
    console.error('Product restore error:', error);
    res.status(500).json({ error: 'Failed to restore product', details: error.message });
  }
});

module.exports = router;
