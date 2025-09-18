const express = require('express');
const { query } = require('../utils/db');
const router = express.Router();

// Submit contact form
router.post('/submit', async (req, res) => {
  try {
    const { name, email, company, subject, message } = req.body;

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Name, email, subject, and message are required' });
    }

    // Insert message into contact_messages table
    await query(
      'INSERT INTO contact_messages (name, email, company, subject, message) VALUES (?, ?, ?, ?, ?)',
      [name, email, company || null, subject, message]
    );

    res.status(201).json({ message: 'Message submitted successfully' });
  } catch (error) {
    console.error('Contact form submission error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to submit message', details: error.message });
  }
});

// Get all contact messages (for admin)
router.get('/messages', async (req, res) => {
  try {
    const messages = await query('SELECT * FROM contact_messages ORDER BY created_at DESC');
    res.json(messages);
  } catch (error) {
    console.error('Fetch contact messages error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
  }
});

// Update message status
router.put('/messages/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['unread', 'read', 'responded'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await query('UPDATE contact_messages SET status = ? WHERE id = ?', [status, id]);
    res.json({ message: 'Message status updated' });
  } catch (error) {
    console.error('Update message status error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to update message status', details: error.message });
  }
});

module.exports = router;