// Updated authRoutes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../utils/db');
const { config } = require('../config');
const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, email, password, address, phone } = req.body;

    // Validate required fields
    if (!username || !email || !password || !address || !phone) {
      return res.status(400).json({ error: 'All fields (username, email, password, address, phone) are required' });
    }

    // Check if email exists (keeping email unique)
    const [existing] = await query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing && existing.length > 0) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await query(
      'INSERT INTO users (username, email, password, role, address, phone) VALUES (?, ?, ?, ?, ?, ?)',
      [username, email, hashedPassword, 'client', address, phone]
    );
    res.status(201).json({ message: 'User registered' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [user] = await query('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });
    res.json({ token, user: { id: user.id, username: user.username, email, role: user.role } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).json({ error: 'Login failed' });
  }
});

module.exports = router;