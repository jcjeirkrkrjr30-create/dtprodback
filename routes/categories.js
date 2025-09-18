// src/server/routes/categories.js (new)
const express = require('express');
const { query } = require('../utils/db');
const { authenticate, restrictTo } = require('../utils/auth');
const { uploadToCloudinary } = require('../utils/cloudinary');
const router = express.Router();

// Get all categories (public)
router.get('/', async (req, res) => {
  try {
    const categories = await query('SELECT * FROM categories ORDER BY name ASC');
    console.log('Fetched categories:', categories);
    res.json(categories);
  } catch (error) {
    console.error('Categories fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
  }
});

// Get single category (public)
router.get('/:id', async (req, res) => {
  try {
    const categories = await query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!categories || categories.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    console.log('Fetched category:', categories[0]);
    res.json(categories[0]);
  } catch (error) {
    console.error('Category fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch category', details: error.message });
  }
});

// Add category (admin only)
router.post('/', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { name, description, imageBase64 } = req.body;
    console.log('POST /api/categories - Request body:', { name, description, imageBase64: !!imageBase64 });

    if (!name) {
      return res.status(400).json({ error: 'Missing required field: name' });
    }

    let image_url = null;
    if (imageBase64 && imageBase64.startsWith('data:image')) {
      try {
        image_url = await uploadToCloudinary(imageBase64);
        console.log('Uploaded image to Cloudinary:', image_url);
      } catch (uploadError) {
        console.error('Cloudinary upload failed:', uploadError);
        return res.status(500).json({ error: 'Failed to upload image to Cloudinary', details: uploadError.message });
      }
    }

    const result = await query(
      'INSERT INTO categories (name, description, image_url) VALUES (?, ?, ?)',
      [name, description || null, image_url]
    );
    if (!result || !result.insertId) {
      throw new Error('Failed to insert category into database');
    }
    console.log('Insert category result:', result);
    res.status(201).json({ message: 'Category added', id: result.insertId });
  } catch (error) {
    console.error('Category add error:', error);
    res.status(500).json({ error: 'Failed to add category', details: error.message });
  }
});

// Update category (admin only)
router.put('/:id', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { name, description, imageBase64 } = req.body;
    console.log('PUT /api/categories/:id - Request body:', { id: req.params.id, name, description, imageBase64: !!imageBase64 });

    const categories = await query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!categories || categories.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const updateFields = {};
    if (name !== undefined && name !== '') updateFields.name = name;
    if (description !== undefined) updateFields.description = description || null;

    let image_url = categories[0].image_url;
    if (imageBase64 && imageBase64.startsWith('data:image')) {
      try {
        image_url = await uploadToCloudinary(imageBase64);
        console.log('Uploaded image to Cloudinary:', image_url);
        updateFields.image_url = image_url;
      } catch (uploadError) {
        console.error('Cloudinary upload failed:', uploadError);
        return res.status(500).json({ error: 'Failed to upload image to Cloudinary', details: uploadError.message });
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const setClause = Object.keys(updateFields)
      .map(field => `${field} = ?`)
      .join(', ');
    const values = [...Object.values(updateFields), req.params.id];

    const result = await query(
      `UPDATE categories SET ${setClause} WHERE id = ?`,
      values
    );
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found or no changes made' });
    }
    console.log('Update category result:', result);
    res.json({ message: 'Category updated' });
  } catch (error) {
    console.error('Category update error:', error);
    res.status(500).json({ error: 'Failed to update category', details: error.message });
  }
});

// Delete category (admin only)
router.delete('/:id', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const result = await query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    console.log('Delete category result:', result);
    res.json({ message: 'Category deleted' });
  } catch (error) {
    console.error('Category delete error:', error);
    res.status(500).json({ error: 'Failed to delete category', details: error.message });
  }
});

module.exports = router;