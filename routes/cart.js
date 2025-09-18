const express = require('express');
const { query } = require('../utils/db');
const { authenticate, restrictTo } = require('../utils/auth');
const router = express.Router();

// Add to cart
router.post('/', authenticate, async (req, res) => {
  try {
    const { product_id, start_date, end_date, quantity } = req.body;
    const userId = req.user ? req.user.id : null;
    const guestSessionId = req.guestSessionId;

    console.log('POST /api/cart:', { userId, guestSessionId, product_id, start_date, end_date, quantity });

    if (!product_id || !start_date || !end_date || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!userId && !guestSessionId) {
      return res.status(400).json({ error: 'User ID or guest session ID required' });
    }
    if (new Date(start_date) >= new Date(end_date)) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }
    if (new Date(start_date) < new Date().setHours(0, 0, 0, 0)) {
      return res.status(400).json({ error: 'Start date cannot be in the past' });
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }

    const [product] = await query('SELECT price_per_day, sale_price FROM products WHERE id = ? AND available = TRUE', [product_id]);
    console.log('Product query result:', product);
    if (!product) {
      return res.status(404).json({ error: 'Product not found or unavailable' });
    }
    const effectivePrice = product.sale_price !== null ? product.sale_price : product.price_per_day;

    const result = await query(
      'INSERT INTO cart (user_id, guest_session_id, product_id, start_date, end_date, quantity, price_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, guestSessionId, product_id, start_date, end_date, quantity, effectivePrice]
    );
    console.log('Insert cart result:', result);

    res.json({ message: 'Product added to cart', cartId: result.insertId });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ error: `Failed to add to cart: ${error.message}` });
  }
});

// Get cart items
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const guestSessionId = req.guestSessionId;

    console.log('GET /api/cart:', { userId, guestSessionId });

    if (!userId && !guestSessionId) {
      return res.status(400).json({ error: 'User ID or guest session ID required' });
    }

    const queryStr = userId
      ? 'SELECT c.*, c.price_snapshot as price_per_day, p.name, p.image_url FROM cart c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?'
      : 'SELECT c.*, c.price_snapshot as price_per_day, p.name, p.image_url FROM cart c JOIN products p ON c.product_id = p.id WHERE c.guest_session_id = ?';
    const params = userId ? [userId] : [guestSessionId];
    const cartItems = await query(queryStr, params);
    console.log('Cart items fetched:', cartItems);

    res.json(cartItems);
  } catch (error) {
    console.error('Fetch cart error:', error);
    res.status(500).json({ error: 'Failed to fetch cart items' });
  }
});

// Update cart item
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { quantity } = req.body;
    const cartId = req.params.id;
    const userId = req.user ? req.user.id : null;
    const guestSessionId = req.guestSessionId;

    console.log('PUT /api/cart/:id:', { cartId, userId, guestSessionId, quantity });

    if (!userId && !guestSessionId) {
      return res.status(400).json({ error: 'User ID or guest session ID required' });
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }

    const queryStr = userId
      ? 'UPDATE cart SET quantity = ? WHERE id = ? AND user_id = ?'
      : 'UPDATE cart SET quantity = ? WHERE id = ? AND guest_session_id = ?';
    const params = userId ? [quantity, cartId, userId] : [quantity, cartId, guestSessionId];
    const result = await query(queryStr, params);
    console.log('Update cart result:', result);

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    res.json({ message: 'Cart item updated' });
  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).json({ error: 'Failed to update cart item' });
  }
});

// Remove from cart
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const cartId = req.params.id;
    const userId = req.user ? req.user.id : null;
    const guestSessionId = req.guestSessionId;

    console.log('DELETE /api/cart/:id:', { cartId, userId, guestSessionId });

    if (!userId && !guestSessionId) {
      return res.status(400).json({ error: 'User ID or guest session ID required' });
    }

    const queryStr = userId
      ? 'DELETE FROM cart WHERE id = ? AND user_id = ?'
      : 'DELETE FROM cart WHERE id = ? AND guest_session_id = ?';
    const params = userId ? [cartId, userId] : [cartId, guestSessionId];
    const result = await query(queryStr, params);
    console.log('Delete cart result:', result);

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    res.json({ message: 'Cart item removed' });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ error: `Failed to remove cart item: ${error.message}` });
  }
});

// Get all cart items (admin only)
router.get('/all', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const cartItems = await query(
      'SELECT c.*, p.name, p.price_per_day, p.sale_price, c.price_snapshot, p.image_url FROM cart c JOIN products p ON c.product_id = p.id'
    );
    console.log('All cart items fetched:', cartItems);

    res.json(cartItems);
  } catch (error) {
    console.error('Fetch all cart items error:', error);
    res.status(500).json({ error: 'Failed to fetch cart items' });
  }
});

module.exports = router;