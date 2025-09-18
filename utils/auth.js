const jwt = require('jsonwebtoken');
const xss = require('xss');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { config } = require('../config');
const { query } = require('../utils/db');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  let guestSessionId = (req.body && req.body.guest_session_id) || (req.query && req.query.guestSessionId) || req.cookies?.guestSessionId;
  console.log('Authenticate middleware - Authorization header:', authHeader, 'Guest Session ID:', guestSessionId);

  // Allow guest users with a guestSessionId
  if (!authHeader && guestSessionId) {
    req.guestSessionId = guestSessionId;
    req.user = null; // No user for guest
    console.log('Authenticate middleware - Guest user with guestSessionId:', guestSessionId);
    return next();
  }

  // Generate new guestSessionId if none exists
  if (!authHeader && !guestSessionId) {
    guestSessionId = crypto.randomUUID();
    res.cookie('guestSessionId', guestSessionId, { 
      httpOnly: true, 
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: process.env.NODE_ENV === 'production', // Secure in production
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' // Handle cross-site requests
    });
    req.guestSessionId = guestSessionId;
    req.user = null;
    console.log('Authenticate middleware - Generated new Guest Session ID:', guestSessionId);
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('Authenticate middleware - No or invalid Authorization header');
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    console.log('Authenticate middleware - Verifying token with JWT_SECRET:', config.jwt.secret);
    const decoded = jwt.verify(token, config.jwt.secret);
    console.log('Authenticate middleware - Decoded JWT:', decoded);
    if (!decoded.id) {
      console.error('Authenticate middleware - Token missing id field');
      return res.status(401).json({ error: 'Invalid token: missing user ID' });
    }
    req.user = decoded;
    req.guestSessionId = null; // Clear guestSessionId for authenticated users
    res.clearCookie('guestSessionId');
    next();
  } catch (error) {
    console.error('Authenticate middleware - JWT verification error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      token
    });
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired, please log in again' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: `Invalid token: ${error.message}` });
    }
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

const restrictTo = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(401).json({ error: 'Access denied' });
  }
  next();
};

const sanitizeInput = (req, res, next) => {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key]);
      }
    }
  }
  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = xss(req.query[key]);
      }
    }
  }
  next();
};

const register = async (req, res) => {
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

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert user with role forced to 'client'
    await query(
      'INSERT INTO users (username, email, password, role, address, phone) VALUES (?, ?, ?, ?, ?, ?)',
      [username, email, hashedPassword, 'client', address, phone]
    );

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

module.exports = { authenticate, restrictTo, sanitizeInput, register };