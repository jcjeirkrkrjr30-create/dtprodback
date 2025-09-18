const express = require('express');
const { query } = require('../utils/db');
const { authenticate, restrictTo } = require('../utils/auth');
const router = express.Router();

// Get page content (public)
router.get('/:pageName', async (req, res) => {
  try {
    const [page] = await query('SELECT content FROM page_contents WHERE page_name = ?', [req.params.pageName]);
    res.json({ content: page ? page.content : '<h1>Page not found</h1>' });
  } catch (error) {
    console.error('Page fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch page content' });
  }
});

// Get all pages (admin only)
router.get('/', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const pages = await query('SELECT * FROM page_contents ORDER BY page_name');
    res.json(pages);
  } catch (error) {
    console.error('Pages fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

// Update page content (admin only)
router.put('/:pageName', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const { content } = req.body;
    const [result] = await query('UPDATE page_contents SET content = ? WHERE page_name = ?', [content, req.params.pageName]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Page not found' });
    }
    res.json({ message: 'Page updated' });
  } catch (error) {
    console.error('Page update error:', error);
    res.status(500).json({ error: 'Failed to update page' });
  }
});

module.exports = router;