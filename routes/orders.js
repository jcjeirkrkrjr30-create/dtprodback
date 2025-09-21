const express = require('express');
const { query, pool } = require('../utils/db');
const { authenticate, restrictTo } = require('../utils/auth');
const router = express.Router();

// Place an order with multiple cart items
router.post('/', authenticate, async (req, res) => {
  try {
    const { cartItems, guestSessionId, name, email, address, phone } = req.body;
    const userId = req.user ? req.user.id : null;

    console.log('POST /api/orders:', { userId, guestSessionId, cartItems, name, email, address, phone });

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ error: 'At least one cart item is required' });
    }

    if (!userId && !guestSessionId) {
      return res.status(400).json({ error: 'User ID or guest session ID required' });
    }

    let orderName, orderEmail, orderAddress, orderPhone;

    if (userId) {
      const [user] = await query('SELECT username, email, address, phone FROM users WHERE id = ?', [userId]);
      console.log('User query result:', user);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (!user.email) {
        return res.status(400).json({ error: 'User profile missing required email' });
      }
      orderName = user.username;
      orderEmail = user.email;
      orderAddress = user.address || 'Not provided';
      orderPhone = user.phone || 'Not provided';
    } else {
      if (!name || !email || !address || !phone) {
        return res.status(400).json({ error: 'Missing required fields: name, email, address, phone' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      orderName = name;
      orderEmail = email;
      orderAddress = address;
      orderPhone = phone;
    }

    await pool.query('START TRANSACTION');

    try {
      const orderResult = await query(
        'INSERT INTO orders (user_id, guest_session_id, name, email, address, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, userId ? null : guestSessionId, orderName, orderEmail, orderAddress, orderPhone, 'pending']
      );
      const orderId = orderResult.insertId;
      console.log('Insert order result:', orderResult);

      for (const { cartId, productId, start_date, end_date, quantity } of cartItems) {
        let cartItem = null;
        if (cartId) {
          // Fetch cart item if cartId is provided
          const queryStr = userId
            ? 'SELECT c.*, p.name AS product_name, p.price_per_day, p.image_url FROM cart c JOIN products p ON c.product_id = p.id WHERE c.id = ? AND c.user_id = ?'
            : 'SELECT c.*, p.name AS product_name, p.price_per_day, p.image_url FROM cart c JOIN products p ON c.product_id = p.id WHERE c.id = ? AND c.guest_session_id = ?';
          const params = userId ? [cartId, userId] : [cartId, guestSessionId];
          const [item] = await query(queryStr, params);
          cartItem = item;
          console.log('Cart item query result:', cartItem);
          if (!cartItem) {
            throw new Error(`Cart item ${cartId} not found or does not belong to user`);
          }
        }

        const [product] = await query('SELECT id, price_per_day, image_url FROM products WHERE id = ? AND available = TRUE', [productId]);
        console.log('Product query result:', product);
        if (!product) {
          throw new Error(`Product ${productId} not found or unavailable`);
        }

        const startDate = cartItem ? cartItem.start_date : start_date;
        const endDate = cartItem ? cartItem.end_date : end_date;
        const qty = cartItem ? cartItem.quantity : quantity;

        if (!startDate || !endDate || !qty) {
          throw new Error('Missing required fields: start_date, end_date, quantity');
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
          throw new Error('Invalid date range');
        }

        const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        const totalPrice = days * product.price_per_day * qty;

        await query(
          'INSERT INTO order_items (order_id, product_id, product_name, start_date, end_date, quantity, price_per_day, total_price, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [orderId, product.id, cartItem ? cartItem.product_name : product.name, startDate, endDate, qty, product.price_per_day, totalPrice, product.image_url]
        );

        if (cartId) {
          const deleteQuery = userId
            ? 'DELETE FROM cart WHERE id = ? AND user_id = ?'
            : 'DELETE FROM cart WHERE id = ? AND guest_session_id = ?';
          const deleteParams = userId ? [cartId, userId] : [cartId, guestSessionId];
          await query(deleteQuery, deleteParams);
        }
      }

      await pool.query('COMMIT');
      console.log('Order placed successfully:', { orderId });
      res.json({ message: 'Order placed successfully', orderId });
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Order transaction error:', error);
      res.status(500).json({ error: 'Failed to place order', details: error.message });
    }
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: 'Failed to place order', details: error.message });
  }
});

// Get current user's orders (authenticated)
router.get('/my-orders', authenticate, async (req, res) => {
  try {
    const orders = await query(
      `SELECT o.*, 
              GROUP_CONCAT(
                CONCAT(
                  oi.product_id, ':',
                  COALESCE(REPLACE(p.name, ':', '::'), 'Unknown'), ':',
                  COALESCE(oi.start_date, ''), ':',
                  COALESCE(oi.end_date, ''), ':',
                  oi.quantity, ':',
                  oi.price_per_day, ':',
                  oi.total_price, ':',
                  COALESCE(p.image_url, '')
                )
                SEPARATOR '|||'
              ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.user_id = ?
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );

    const formattedOrders = orders.map(order => ({
      ...order,
      items: order.items
        ? order.items.split('|||').map(item => {
            const parts = item.split(':');
            if (parts.length < 7) {
              console.warn('Invalid item format:', { item, orderId: order.id });
              return null;
            }
            let [product_id, name, start_date, end_date, quantity, price_per_day, total_price, ...imageParts] = parts;
            const image_url = imageParts.join(':');
            name = name.replace('::', ':').replace(/[^a-zA-Z0-9\s-_]/g, '');
            if (!name || name.trim() === '') {
              console.warn('Invalid product name:', { name, item, orderId: order.id });
              return null;
            }
            const isValidUrl = image_url && image_url.startsWith('http');
            return {
              product_id: parseInt(product_id) || 0,
              product_name: name,
              start_date: start_date || null,
              end_date: end_date || null,
              quantity: parseInt(quantity) || 0,
              price_per_day: parseFloat(price_per_day) || 0,
              total_price: parseFloat(total_price) || 0,
              image_url: isValidUrl ? image_url : null,
            };
          }).filter(item => item !== null && item.product_id && item.product_name)
        : [],
    }));

    console.log('Fetched user orders:', formattedOrders);
    res.json(formattedOrders);
  } catch (error) {
    console.error('Fetch user orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
  }
});

// Get orders for a specific user (admin only)
router.get('/user/:userId', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const orders = await query(
      `SELECT o.*, 
              GROUP_CONCAT(
                CONCAT(
                  oi.product_id, ':',
                  COALESCE(REPLACE(p.name, ':', '::'), 'Unknown'), ':',
                  COALESCE(oi.start_date, ''), ':',
                  COALESCE(oi.end_date, ''), ':',
                  oi.quantity, ':',
                  oi.price_per_day, ':',
                  oi.total_price, ':',
                  COALESCE(p.image_url, '')
                )
                SEPARATOR '|||'
              ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.user_id = ?
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [userId]
    );

    const formattedOrders = orders.map(order => ({
      ...order,
      items: order.items
        ? order.items.split('|||').map(item => {
            const parts = item.split(':');
            if (parts.length < 7) {
              console.warn('Invalid item format:', { item, orderId: order.id });
              return null;
            }
            let [product_id, name, start_date, end_date, quantity, price_per_day, total_price, ...imageParts] = parts;
            const image_url = imageParts.join(':');
            name = name.replace('::', ':').replace(/[^a-zA-Z0-9\s-_]/g, '');
            if (!name || name.trim() === '') {
              console.warn('Invalid product name:', { name, item, orderId: order.id });
              return null;
            }
            const isValidUrl = image_url && image_url.startsWith('http');
            return {
              product_id: parseInt(product_id) || 0,
              product_name: name,
              start_date: start_date || null,
              end_date: end_date || null,
              quantity: parseInt(quantity) || 0,
              price_per_day: parseFloat(price_per_day) || 0,
              total_price: parseFloat(total_price) || 0,
              image_url: isValidUrl ? image_url : null,
            };
          }).filter(item => item !== null && item.product_id && item.product_name)
        : [],
    }));

    console.log('Fetched orders for user:', { userId, orders: formattedOrders });
    res.json(formattedOrders);
  } catch (error) {
    console.error('Fetch user orders error:', error);
    res.status(500).json({ error: 'Failed to fetch user orders', details: error.message });
  }
});

// Get all orders (admin only)
router.get('/', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const orders = await query(
      `SELECT o.*, 
              GROUP_CONCAT(
                CONCAT(
                  oi.product_id, ':',
                  COALESCE(REPLACE(p.name, ':', '::'), 'Unknown'), ':',
                  COALESCE(oi.start_date, ''), ':',
                  COALESCE(oi.end_date, ''), ':',
                  oi.quantity, ':',
                  oi.price_per_day, ':',
                  oi.total_price, ':',
                  COALESCE(p.image_url, '')
                )
                SEPARATOR '|||'
              ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       GROUP BY o.id
       ORDER BY o.created_at DESC`
    );
    const formattedOrders = orders.map(order => ({
      ...order,
      items: order.items
        ? order.items.split('|||').map(item => {
            const parts = item.split(':');
            if (parts.length < 7) {
              console.warn('Invalid item format:', { item, orderId: order.id });
              return null;
            }
            let [product_id, name, start_date, end_date, quantity, price_per_day, total_price, ...imageParts] = parts;
            const image_url = imageParts.join(':');
            name = name.replace('::', ':').replace(/[^a-zA-Z0-9\s-_]/g, '');
            if (!name || name.trim() === '') {
              console.warn('Invalid product name:', { name, item, orderId: order.id });
              return null;
            }
            const isValidUrl = image_url && image_url.startsWith('http');
            return {
              product_id: parseInt(product_id) || 0,
              product_name: name,
              start_date: start_date || null,
              end_date: end_date || null,
              quantity: parseInt(quantity) || 0,
              price_per_day: parseFloat(price_per_day) || 0,
              total_price: parseFloat(total_price) || 0,
              image_url: isValidUrl ? image_url : null,
            };
          }).filter(item => item !== null && item.product_id && item.product_name)
        : [],
    }));
    console.log('Fetched all orders:', formattedOrders);
    res.json(formattedOrders);
  } catch (error) {
    console.error('Fetch all orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
  }
});

// Update order status (admin only)
router.put('/:id', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const result = await query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    console.log('Update order status result:', result);
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const [updatedOrder] = await query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    res.json({ message: 'Order status updated', order: updatedOrder });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Failed to update order status', details: error.message });
  }
});

module.exports = router;
