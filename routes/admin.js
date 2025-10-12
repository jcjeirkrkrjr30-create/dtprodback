const express = require('express');
const { query } = require('../utils/db');
const { authenticate, restrictTo } = require('../utils/auth');
const router = express.Router();

// Helper function to calculate percentage change
const calculatePercentageChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

// Admin stats overview - FIXED to show period-specific data
router.get('/stats', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    let currentPeriodSQL, previousPeriodSQL, timeRangeSQL;
    
    // Define SQL filters for current period, previous period, and time range
    switch (period) {
      case 'day':
        currentPeriodSQL = `DATE(created_at) = CURDATE()`;
        previousPeriodSQL = `DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`;
        timeRangeSQL = `created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`;
        break;
      case 'week':
        currentPeriodSQL = `YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)`;
        previousPeriodSQL = `YEARWEEK(created_at, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 1 WEEK), 1)`;
        timeRangeSQL = `created_at >= DATE_SUB(CURDATE(), INTERVAL 26 WEEK)`;
        break;
      case 'month':
        currentPeriodSQL = `DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`;
        previousPeriodSQL = `DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m')`;
        timeRangeSQL = `created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)`;
        break;
      case 'year':
        currentPeriodSQL = `YEAR(created_at) = YEAR(CURDATE())`;
        previousPeriodSQL = `YEAR(created_at) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 YEAR))`;
        timeRangeSQL = `created_at >= DATE_SUB(CURDATE(), INTERVAL 10 YEAR)`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid period' });
    }

    // For revenue queries with orders table alias
    const currentPeriodForRevenue = currentPeriodSQL.replace(/created_at/g, 'o.created_at');
    const previousPeriodForRevenue = previousPeriodSQL.replace(/created_at/g, 'o.created_at');
    const timeRangeForRevenue = timeRangeSQL.replace(/created_at/g, 'o.created_at');

    console.log(`Fetching stats for period: ${period}`);
    console.log(`Current period SQL: ${currentPeriodSQL}`);
    console.log(`Time range SQL: ${timeRangeSQL}`);

    // === CURRENT PERIOD STATS (what shows in the cards) ===
    
    // Users in current period
    const [currentUsers] = await query(`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE role = 'client' AND ${currentPeriodSQL}
    `);
    
    const [prevUsers] = await query(`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE role = 'client' AND ${previousPeriodSQL}
    `);
    
    // Products in current period
    const [currentProducts] = await query(`
      SELECT COUNT(*) as count 
      FROM products 
      WHERE is_deleted = 0 AND ${currentPeriodSQL}
    `);
    
    const [prevProducts] = await query(`
      SELECT COUNT(*) as count 
      FROM products 
      WHERE is_deleted = 0 AND ${previousPeriodSQL}
    `);
    
    // Orders in current period
    const [currentOrders] = await query(`
      SELECT COUNT(*) as count 
      FROM orders 
      WHERE ${currentPeriodSQL}
    `);
    
    const [prevOrders] = await query(`
      SELECT COUNT(*) as count 
      FROM orders 
      WHERE ${previousPeriodSQL}
    `);
    
    // Order statuses in current period
    const [currentPending] = await query(`
      SELECT COUNT(*) as count 
      FROM orders 
      WHERE status = 'pending' AND ${currentPeriodSQL}
    `);
    
    const [currentCompleted] = await query(`
      SELECT COUNT(*) as count 
      FROM orders 
      WHERE status = 'completed' AND ${currentPeriodSQL}
    `);
    
    const [currentApproved] = await query(`
      SELECT COUNT(*) as count 
      FROM orders 
      WHERE status = 'approved' AND ${currentPeriodSQL}
    `);
    
    const [currentCancelled] = await query(`
      SELECT COUNT(*) as count 
      FROM orders 
      WHERE status = 'cancelled' AND ${currentPeriodSQL}
    `);
    
    // Revenue for current period
    const [currentRevenueRow] = await query(`
      SELECT COALESCE(SUM(oi.total_price), 0) as revenue 
      FROM order_items oi 
      JOIN orders o ON oi.order_id = o.id 
      WHERE o.status IN ('approved', 'completed') AND ${currentPeriodForRevenue}
    `);
    
    // Revenue for previous period
    const [prevRevenueRow] = await query(`
      SELECT COALESCE(SUM(oi.total_price), 0) as revenue 
      FROM order_items oi 
      JOIN orders o ON oi.order_id = o.id 
      WHERE o.status IN ('approved', 'completed') AND ${previousPeriodForRevenue}
    `);

    // === LIFETIME TOTALS (for reference) ===
    const [lifetimeUsers] = await query(`SELECT COUNT(*) as count FROM users WHERE role = 'client'`);
    const [lifetimeProducts] = await query(`SELECT COUNT(*) as count FROM products WHERE is_deleted = 0`);
    const [lifetimeOrders] = await query(`SELECT COUNT(*) as count FROM orders`);
    const [totalCategories] = await query(`SELECT COUNT(*) as count FROM categories`);
    
    const [lifetimeRevenueRow] = await query(`
      SELECT COALESCE(SUM(oi.total_price), 0) as revenue 
      FROM order_items oi 
      JOIN orders o ON oi.order_id = o.id 
      WHERE o.status IN ('approved', 'completed')
    `);

    // Calculate percentage changes
    const userChange = calculatePercentageChange(
      currentUsers?.count || 0, 
      prevUsers?.count || 0
    );
    
    const productChange = calculatePercentageChange(
      currentProducts?.count || 0, 
      prevProducts?.count || 0
    );
    
    const orderChange = calculatePercentageChange(
      currentOrders?.count || 0, 
      prevOrders?.count || 0
    );
    
    const revenueChange = calculatePercentageChange(
      parseFloat(currentRevenueRow?.revenue || 0),
      parseFloat(prevRevenueRow?.revenue || 0)
    );

    console.log('Period stats:', {
      currentUsers: currentUsers?.count,
      prevUsers: prevUsers?.count,
      currentOrders: currentOrders?.count,
      prevOrders: prevOrders?.count,
      currentRevenue: currentRevenueRow?.revenue,
      prevRevenue: prevRevenueRow?.revenue
    });

    const stats = {
      // Current period stats (changes with filter)
      totalUsers: currentUsers?.count || 0,
      totalProducts: currentProducts?.count || 0,
      totalOrders: currentOrders?.count || 0,
      pendingOrders: currentPending?.count || 0,
      completedOrders: currentCompleted?.count || 0,
      approvedOrders: currentApproved?.count || 0,
      cancelledOrders: currentCancelled?.count || 0,
      totalRevenue: parseFloat(currentRevenueRow?.revenue || 0),
      
      // Previous period (for comparison)
      previousPeriodRevenue: parseFloat(prevRevenueRow?.revenue || 0),
      
      // Percentage changes
      userChange: parseFloat(userChange.toFixed(2)),
      productChange: parseFloat(productChange.toFixed(2)),
      orderChange: parseFloat(orderChange.toFixed(2)),
      revenueChange: parseFloat(revenueChange.toFixed(2)),
      
      // Lifetime totals (for context)
      lifetimeUsers: lifetimeUsers?.count || 0,
      lifetimeProducts: lifetimeProducts?.count || 0,
      lifetimeOrders: lifetimeOrders?.count || 0,
      lifetimeRevenue: parseFloat(lifetimeRevenueRow?.revenue || 0),
      totalCategories: totalCategories?.count || 0,
      
      period
    };

    console.log('Stats response:', stats);
    res.json(stats);
  } catch (error) {
    console.error('Admin stats error:', error.message, error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch stats', 
      details: error.message
    });
  }
});

// Sales over time
router.get('/sales-over-time', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let groupBy, timeFilter, dateFormat;
    
    switch (period) {
      case 'day':
        groupBy = 'DATE(o.created_at)';
        dateFormat = 'DATE_FORMAT(o.created_at, "%Y-%m-%d")';
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`;
        break;
      case 'week':
        groupBy = 'YEARWEEK(o.created_at, 1)';
        dateFormat = 'DATE_FORMAT(DATE_SUB(o.created_at, INTERVAL WEEKDAY(o.created_at) DAY), "%Y-%m-%d")';
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 26 WEEK)`;
        break;
      case 'month':
        groupBy = 'DATE_FORMAT(o.created_at, "%Y-%m")';
        dateFormat = 'DATE_FORMAT(o.created_at, "%Y-%m")';
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)`;
        break;
      case 'year':
        groupBy = 'YEAR(o.created_at)';
        dateFormat = 'CAST(YEAR(o.created_at) AS CHAR)';
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 10 YEAR)`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid period' });
    }

    const salesData = await query(`
      SELECT 
        ${dateFormat} as period,
        COUNT(DISTINCT o.id) as orderCount,
        COALESCE(SUM(oi.total_price), 0) as sales,
        COALESCE(AVG(oi.total_price), 0) as avgOrderValue
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.status IN ('approved', 'completed') AND ${timeFilter}
      GROUP BY ${groupBy}
      ORDER BY MIN(o.created_at) ASC
    `);

    console.log('Sales data query result length:', salesData.length);

    const formattedSalesData = salesData.map(item => ({
      period: String(item.period || ''),
      orderCount: parseInt(item.orderCount) || 0,
      sales: parseFloat(item.sales) || 0,
      avgOrderValue: parseFloat(item.avgOrderValue) || 0
    }));

    res.json(formattedSalesData);
  } catch (error) {
    console.error('Sales over time error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch sales data', details: error.message });
  }
});

// User growth over time
router.get('/user-growth', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let groupBy, timeFilter, dateFormat;
    
    switch (period) {
      case 'day':
        groupBy = 'DATE(created_at)';
        dateFormat = 'DATE_FORMAT(created_at, "%Y-%m-%d")';
        timeFilter = `created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`;
        break;
      case 'week':
        groupBy = 'YEARWEEK(created_at, 1)';
        dateFormat = 'DATE_FORMAT(DATE_SUB(created_at, INTERVAL WEEKDAY(created_at) DAY), "%Y-%m-%d")';
        timeFilter = `created_at >= DATE_SUB(CURDATE(), INTERVAL 26 WEEK)`;
        break;
      case 'month':
        groupBy = 'DATE_FORMAT(created_at, "%Y-%m")';
        dateFormat = 'DATE_FORMAT(created_at, "%Y-%m")';
        timeFilter = `created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)`;
        break;
      case 'year':
        groupBy = 'YEAR(created_at)';
        dateFormat = 'CAST(YEAR(created_at) AS CHAR)';
        timeFilter = `created_at >= DATE_SUB(CURDATE(), INTERVAL 10 YEAR)`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid period' });
    }

    const userGrowthData = await query(`
      SELECT 
        ${dateFormat} as period,
        COUNT(id) as newUsers
      FROM users
      WHERE role = 'client' AND ${timeFilter}
      GROUP BY ${groupBy}
      ORDER BY MIN(created_at) ASC
    `);

    console.log('User growth data query result length:', userGrowthData.length);

    const formattedUserGrowthData = userGrowthData.map(item => ({
      period: String(item.period || ''),
      newUsers: parseInt(item.newUsers) || 0
    }));

    res.json(formattedUserGrowthData);
  } catch (error) {
    console.error('User growth error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch user growth data', details: error.message });
  }
});

// Order growth over time
router.get('/order-growth', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let groupBy, timeFilter, dateFormat;
    
    switch (period) {
      case 'day':
        groupBy = 'DATE(created_at)';
        dateFormat = 'DATE_FORMAT(created_at, "%Y-%m-%d")';
        timeFilter = `created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`;
        break;
      case 'week':
        groupBy = 'YEARWEEK(created_at, 1)';
        dateFormat = 'DATE_FORMAT(DATE_SUB(created_at, INTERVAL WEEKDAY(created_at) DAY), "%Y-%m-%d")';
        timeFilter = `created_at >= DATE_SUB(CURDATE(), INTERVAL 26 WEEK)`;
        break;
      case 'month':
        groupBy = 'DATE_FORMAT(created_at, "%Y-%m")';
        dateFormat = 'DATE_FORMAT(created_at, "%Y-%m")';
        timeFilter = `created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)`;
        break;
      case 'year':
        groupBy = 'YEAR(created_at)';
        dateFormat = 'CAST(YEAR(created_at) AS CHAR)';
        timeFilter = `created_at >= DATE_SUB(CURDATE(), INTERVAL 10 YEAR)`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid period' });
    }

    const orderGrowthData = await query(`
      SELECT 
        ${dateFormat} as period,
        COUNT(id) as newOrders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingOrders,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedOrders,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedOrders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledOrders
      FROM orders
      WHERE ${timeFilter}
      GROUP BY ${groupBy}
      ORDER BY MIN(created_at) ASC
    `);

    console.log('Order growth data query result length:', orderGrowthData.length);

    const formattedOrderGrowthData = orderGrowthData.map(item => ({
      period: String(item.period || ''),
      newOrders: parseInt(item.newOrders) || 0,
      pendingOrders: parseInt(item.pendingOrders) || 0,
      approvedOrders: parseInt(item.approvedOrders) || 0,
      completedOrders: parseInt(item.completedOrders) || 0,
      cancelledOrders: parseInt(item.cancelledOrders) || 0
    }));

    res.json(formattedOrderGrowthData);
  } catch (error) {
    console.error('Order growth error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch order growth data', details: error.message });
  }
});

// Top 10 popular products
router.get('/popular-products', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let timeFilter;
    
    switch (period) {
      case 'day':
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`;
        break;
      case 'week':
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 26 WEEK)`;
        break;
      case 'month':
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)`;
        break;
      case 'year':
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 10 YEAR)`;
        break;
      default:
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)`;
    }

    const popularProducts = await query(`
      SELECT 
        p.id, 
        p.name,
        p.price_per_day,
        COUNT(DISTINCT o.id) as orderCount,
        SUM(oi.quantity) as totalQuantity, 
        COALESCE(SUM(oi.total_price), 0) as totalSales,
        COALESCE(AVG(oi.total_price), 0) as avgSaleValue
      FROM products p
      JOIN order_items oi ON p.id = oi.product_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status IN ('approved', 'completed') 
        AND ${timeFilter} 
        AND p.is_deleted = 0
      GROUP BY p.id, p.name, p.price_per_day
      ORDER BY totalSales DESC
      LIMIT 10
    `);

    console.log('Popular products query result length:', popularProducts.length);

    const formattedPopularProducts = popularProducts.map(item => ({
      id: item.id,
      name: item.name,
      pricePerDay: parseFloat(item.price_per_day) || 0,
      orderCount: parseInt(item.orderCount) || 0,
      totalQuantity: parseInt(item.totalQuantity) || 0,
      totalSales: parseFloat(item.totalSales) || 0,
      avgSaleValue: parseFloat(item.avgSaleValue) || 0
    }));

    res.json(formattedPopularProducts);
  } catch (error) {
    console.error('Popular products error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch popular products', details: error.message });
  }
});

// Revenue breakdown by status
router.get('/revenue-breakdown', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const revenueBreakdown = await query(`
      SELECT 
        o.status,
        COUNT(DISTINCT o.id) as orderCount,
        COALESCE(SUM(oi.total_price), 0) as totalRevenue
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.status
      ORDER BY totalRevenue DESC
    `);

    const formattedBreakdown = revenueBreakdown.map(item => ({
      status: item.status,
      orderCount: parseInt(item.orderCount) || 0,
      totalRevenue: parseFloat(item.totalRevenue) || 0
    }));

    res.json(formattedBreakdown);
  } catch (error) {
    console.error('Revenue breakdown error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch revenue breakdown', details: error.message });
  }
});

// Category performance analytics
router.get('/category-performance', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let timeFilter;
    
    switch (period) {
      case 'day':
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`;
        break;
      case 'week':
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 26 WEEK)`;
        break;
      case 'month':
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)`;
        break;
      case 'year':
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 10 YEAR)`;
        break;
      default:
        timeFilter = `o.created_at >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)`;
    }

    const categoryPerformance = await query(`
      SELECT 
        COALESCE(c.name, 'Uncategorized') as categoryName,
        COALESCE(c.id, 0) as categoryId,
        COUNT(DISTINCT p.id) as productCount,
        COUNT(DISTINCT o.id) as orderCount,
        SUM(oi.quantity) as totalQuantityRented,
        COALESCE(SUM(oi.total_price), 0) as totalRevenue
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      JOIN order_items oi ON p.id = oi.product_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status IN ('approved', 'completed') 
        AND ${timeFilter} 
        AND p.is_deleted = 0
      GROUP BY c.id, c.name
      ORDER BY totalRevenue DESC
    `);

    const formattedCategoryPerformance = categoryPerformance.map(item => ({
      categoryId: parseInt(item.categoryId) || 0,
      categoryName: item.categoryName,
      productCount: parseInt(item.productCount) || 0,
      orderCount: parseInt(item.orderCount) || 0,
      totalQuantityRented: parseInt(item.totalQuantityRented) || 0,
      totalRevenue: parseFloat(item.totalRevenue) || 0
    }));

    res.json(formattedCategoryPerformance);
  } catch (error) {
    console.error('Category performance error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch category performance', details: error.message });
  }
});

module.exports = router;
