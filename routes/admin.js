const express = require('express');
const { query } = require('../utils/db');
const { authenticate, restrictTo } = require('../utils/auth');
const router = express.Router();

// Helper function to calculate percentage change
const calculatePercentageChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0; // Handle division by zero
  return ((current - previous) / previous) * 100;
};

// Admin stats overview
router.get('/stats', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query; // Get period from query (default: month)
    
    // Define date ranges based on period (for single-table queries)
    let currentPeriodSQL, previousPeriodSQL;
    switch (period) {
      case 'day':
        currentPeriodSQL = `DATE(created_at) = CURDATE()`;
        previousPeriodSQL = `DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`;
        break;
      case 'week':
        currentPeriodSQL = `YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)`;
        previousPeriodSQL = `YEARWEEK(created_at, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 1 WEEK), 1)`;
        break;
      case 'month':
        currentPeriodSQL = `YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())`;
        previousPeriodSQL = `YEAR(created_at) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND MONTH(created_at) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))`;
        break;
      case 'year':
        currentPeriodSQL = `YEAR(created_at) = YEAR(CURDATE())`;
        previousPeriodSQL = `YEAR(created_at) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 YEAR))`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid period' });
    }

    // For revenue queries (joined tables), qualify created_at to avoid ambiguity
    const currentPeriodForRevenue = currentPeriodSQL.replace(/created_at/g, 'o.created_at');
    const previousPeriodForRevenue = previousPeriodSQL.replace(/created_at/g, 'o.created_at');

    // Current period queries (period-specific metrics)
    const totalUsers = await query(`SELECT COUNT(*) as count FROM users WHERE ${currentPeriodSQL}`);
    const totalProducts = await query(`SELECT COUNT(*) as count FROM products WHERE ${currentPeriodSQL}`);
    const totalOrders = await query(`SELECT COUNT(*) as count FROM orders WHERE ${currentPeriodSQL}`);
    const pendingOrders = await query(`SELECT COUNT(*) as count FROM orders WHERE status = "pending" AND ${currentPeriodSQL}`);
    const completedOrders = await query(`SELECT COUNT(*) as count FROM orders WHERE status = "completed" AND ${currentPeriodSQL}`);
    const totalRevenueQuery = await query(`
      SELECT SUM(oi.total_price) as revenue 
      FROM order_items oi 
      JOIN orders o ON oi.order_id = o.id 
      WHERE o.status = "completed" AND ${currentPeriodForRevenue}
    `);
    const totalMessages = await query(`SELECT COUNT(*) as count FROM contact_messages WHERE ${currentPeriodSQL}`);
    const unreadMessages = await query(`SELECT COUNT(*) as count FROM contact_messages WHERE status = "unread" AND ${currentPeriodSQL}`);
    const totalCategories = await query(`SELECT COUNT(*) as count FROM categories WHERE ${currentPeriodSQL}`);

    // Previous period queries for percentage changes
    const prevTotalUsers = await query(`SELECT COUNT(*) as count FROM users WHERE ${previousPeriodSQL}`);
    const prevTotalProducts = await query(`SELECT COUNT(*) as count FROM products WHERE ${previousPeriodSQL}`);
    const prevTotalOrders = await query(`SELECT COUNT(*) as count FROM orders WHERE ${previousPeriodSQL}`);
    const prevTotalRevenueQuery = await query(`
      SELECT SUM(oi.total_price) as revenue 
      FROM order_items oi 
      JOIN orders o ON oi.order_id = o.id 
      WHERE o.status = "completed" AND ${previousPeriodForRevenue}
    `);

    // Calculate percentage changes
    const userChange = calculatePercentageChange(totalUsers[0].count, prevTotalUsers[0].count);
    const productChange = calculatePercentageChange(totalProducts[0].count, prevTotalProducts[0].count);
    const orderChange = calculatePercentageChange(totalOrders[0].count, prevTotalOrders[0].count);
    const revenueChange = calculatePercentageChange(
      parseFloat(totalRevenueQuery[0]?.revenue || 0),
      parseFloat(prevTotalRevenueQuery[0]?.revenue || 0)
    );

    const stats = {
      totalUsers: totalUsers[0].count,
      totalProducts: totalProducts[0].count,
      totalOrders: totalOrders[0].count,
      pendingOrders: pendingOrders[0].count,
      completedOrders: completedOrders[0].count,
      totalMessages: totalMessages[0].count,
      unreadMessages: unreadMessages[0].count,
      totalRevenue: parseFloat(totalRevenueQuery[0]?.revenue || 0),
      totalCategories: totalCategories[0].count,
      userChange,
      productChange,
      orderChange,
      revenueChange,
    };

    console.log('Fetched admin stats:', stats);
    res.json(stats);
  } catch (error) {
    console.error('Admin stats error:', error.message, error.stack);
    // Graceful fallback to 0s for real-world robustness
    res.status(500).json({ 
      error: 'Failed to fetch stats', 
      details: error.message,
      fallback: { 
        totalUsers: 0, 
        totalProducts: 0, 
        totalOrders: 0, 
        totalRevenue: 0, 
        pendingOrders: 0, 
        completedOrders: 0, 
        totalMessages: 0, 
        unreadMessages: 0, 
        totalCategories: 0,
        userChange: 0,
        productChange: 0,
        orderChange: 0,
        revenueChange: 0
      }
    });
  }
});

// Sales over time (for chart)
router.get('/sales-over-time', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let groupBy;
    switch (period) {
      case 'day':
        groupBy = 'DATE(o.created_at)';
        break;
      case 'week':
        groupBy = 'YEARWEEK(o.created_at, 1)';
        break;
      case 'month':
        groupBy = 'CONCAT(MONTH(o.created_at), "-", YEAR(o.created_at))';
        break;
      case 'year':
        groupBy = 'YEAR(o.created_at)';
        break;
      default:
        return res.status(400).json({ error: 'Invalid period' });
    }

    const salesData = await query(`
      SELECT 
        ${groupBy} as period,
        COUNT(o.id) as orderCount,
        SUM(oi.total_price) as sales
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      WHERE o.status = "completed"
      GROUP BY ${groupBy}
      ORDER BY MIN(o.created_at) DESC
      LIMIT 12
    `);

    const formattedSalesData = salesData.map(item => ({
      period: item.period,
      orderCount: parseInt(item.orderCount) || 0,
      sales: parseFloat(item.sales) || 0,
    })).reverse(); // Reverse for chronological ascending order

    console.log('Fetched sales over time:', formattedSalesData);
    res.json(formattedSalesData);
  } catch (error) {
    console.error('Sales over time error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch sales data', details: error.message });
  }
});

// User growth over time (for chart)
router.get('/user-growth', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let groupBy;
    switch (period) {
      case 'day':
        groupBy = 'DATE(created_at)';
        break;
      case 'week':
        groupBy = 'YEARWEEK(created_at, 1)';
        break;
      case 'month':
        groupBy = 'CONCAT(MONTH(created_at), "-", YEAR(created_at))';
        break;
      case 'year':
        groupBy = 'YEAR(created_at)';
        break;
      default:
        return res.status(400).json({ error: 'Invalid period' });
    }

    const userGrowthData = await query(`
      SELECT 
        ${groupBy} as period,
        COUNT(id) as newUsers
      FROM users
      GROUP BY ${groupBy}
      ORDER BY MIN(created_at) DESC
      LIMIT 12
    `);

    const formattedUserGrowthData = userGrowthData.map(item => ({
      period: item.period,
      newUsers: parseInt(item.newUsers) || 0,
    })).reverse(); // Reverse for chronological ascending order

    console.log('Fetched user growth:', formattedUserGrowthData);
    res.json(formattedUserGrowthData);
  } catch (error) {
    console.error('User growth error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch user growth data', details: error.message });
  }
});

// Order growth over time (for chart)
router.get('/order-growth', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let groupBy;
    switch (period) {
      case 'day':
        groupBy = 'DATE(created_at)';
        break;
      case 'week':
        groupBy = 'YEARWEEK(created_at, 1)';
        break;
      case 'month':
        groupBy = 'CONCAT(MONTH(created_at), "-", YEAR(created_at))';
        break;
      case 'year':
        groupBy = 'YEAR(created_at)';
        break;
      default:
        return res.status(400).json({ error: 'Invalid period' });
    }

    const orderGrowthData = await query(`
      SELECT 
        ${groupBy} as period,
        COUNT(id) as newOrders
      FROM orders
      GROUP BY ${groupBy}
      ORDER BY MIN(created_at) DESC
      LIMIT 12
    `);

    const formattedOrderGrowthData = orderGrowthData.map(item => ({
      period: item.period,
      newOrders: parseInt(item.newOrders) || 0,
    })).reverse(); // Reverse for chronological ascending order

    console.log('Fetched order growth:', formattedOrderGrowthData);
    res.json(formattedOrderGrowthData);
  } catch (error) {
    console.error('Order growth error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch order growth data', details: error.message });
  }
});

// Top 10 popular products (sorted by orders)
router.get('/popular-products', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const popularProducts = await query(`
      SELECT p.id, p.name, SUM(oi.quantity) as totalQuantity, SUM(oi.total_price) as totalSales
      FROM products p
      JOIN order_items oi ON p.id = oi.product_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status = "completed"
      GROUP BY p.id, p.name
      ORDER BY totalSales DESC
      LIMIT 10
    `);

    const formattedPopularProducts = popularProducts.map(item => ({
      id: item.id,
      name: item.name,
      totalQuantity: parseInt(item.totalQuantity) || 0,
      totalSales: parseFloat(item.totalSales) || 0,
    }));

    console.log('Fetched popular products:', formattedPopularProducts);
    res.json(formattedPopularProducts);
  } catch (error) {
    console.error('Popular products error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch popular products', details: error.message });
  }
});

// Fetch contact messages
router.get('/contact-messages', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const messages = await query(`
      SELECT id, name, email, company, subject, message, status, created_at 
      FROM contact_messages 
      ORDER BY created_at DESC
    `);
    res.json(messages);
  } catch (error) {
    console.error('Fetch contact messages error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch contact messages', details: error.message });
  }
});

// Update contact message status
router.put('/contact-messages/:id/status', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['unread', 'read', 'responded'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await query('UPDATE contact_messages SET status = ? WHERE id = ?', [status, id]);
    res.json({ message: 'Message status updated' });
  } catch (error) {
    console.error('Update contact message status error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to update message status', details: error.message });
  }
});

module.exports = router;