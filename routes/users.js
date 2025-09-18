const express = require('express');
const { query } = require('../utils/db');
const { authenticate, restrictTo } = require('../utils/auth');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Get profile (logged-in only)
router.get('/profile', authenticate, async (req, res) => {
  try {
    const [user] = await query('SELECT id, username, email, role, address, phone FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update profile (logged-in only)
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { username, email, address, phone } = req.body;

    // Validate email uniqueness
    const [existing] = await query(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [email, req.user.id]
    );
    if (existing && existing.length > 0) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    await query(
      'UPDATE users SET username = ?, email = ?, address = ?, phone = ? WHERE id = ?',
      [username, email, address || null, phone || null, req.user.id]
    );
    res.json({ message: 'Profile updated' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password (logged-in only)
router.put('/password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    // Fetch current user password
    const [user] = await query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify old password
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect old password' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Get all users (admin only)
router.get('/', authenticate, restrictTo('admin'), async (req, res) => {
  try {
    const users = await query('SELECT id, username, email, role, created_at, address, phone FROM users');
    res.json(users);
  } catch (error) {
    console.error('Users fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

module.exports = router;