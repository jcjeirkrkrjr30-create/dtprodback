const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { sanitizeInput } = require('./utils/auth');
const authRoutes = require('./routes/authRoutes');
const pagesRoutes = require('./routes/pages');
const productsRoutes = require('./routes/products');
const ordersRoutes = require('./routes/orders');
const usersRoutes = require('./routes/users');
const cartRoutes = require('./routes/cart');
const categoriesRoutes = require('./routes/categories');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contactRoutes');

const app = express();

// Trust proxy for Render deployment
app.set('trust proxy', 1);

// Enhanced CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    console.log('CORS request from origin:', origin);
    
    // Allow requests with no origin (like mobile apps, Postman, or curl requests)
    if (!origin) {
      console.log('CORS allowing request with no origin');
      return callback(null, true);
    }
    
    const allowedOrigins = [
      'https://dtprod.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
    ];
    
    // Allow all Vercel preview deployments
    const isVercelPreview = origin && origin.includes('.vercel.app') && origin.startsWith('https://');
    
    // Allow localhost with any port for development
    const isLocalhost = origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'));
    
    if (allowedOrigins.includes(origin) || isVercelPreview || isLocalhost) {
      console.log('CORS allowing origin:', origin);
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      // In production, be more strict, but for debugging allow all
      if (process.env.NODE_ENV === 'production') {
        callback(new Error('Not allowed by CORS'));
      } else {
        callback(null, true); // Allow all in development
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'X-File-Name',
  ],
  exposedHeaders: ['set-cookie'],
  optionsSuccessStatus: 200,
  maxAge: 86400, // 24 hours
};

// Apply CORS before other middleware
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enhanced rate limit: Increased to 1000 per 15 min globally for bursts; skip for admin/auth to prevent dashboard 429s
app.use(rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/admin') || req.path.startsWith('/api/auth'), // Bypass for low-risk authenticated routes
  message: 'Too many requests, please try again later.',
}));

// Enhanced debug middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.path}`);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Authorization:', req.headers.authorization ? 'Present' : 'Missing');
  next();
});

// Input sanitization
app.use(sanitizeInput);

// Routes
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/pages', pagesRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/contact', (req, res, next) => {
  console.log('Contact route accessed:', req.method, req.path);
  next();
}, contactRoutes);

// Catch-all for undefined API routes
app.use('/api', (req, res) => {
  console.log('404 - API endpoint not found:', req.method, req.originalUrl);
  console.log('Available routes: /admin, /auth, /pages, /products, /orders, /users, /cart, /categories, /contact');
  res.status(404).json({ 
    error: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler with enhanced logging
app.use((err, req, res, next) => {
  console.error('=== ERROR OCCURRED ===');
  console.error('Time:', new Date().toISOString());
  console.error('URL:', req.originalUrl);
  console.error('Method:', req.method);
  console.error('Headers:', JSON.stringify(req.headers, null, 2));
  console.error('Body:', JSON.stringify(req.body, null, 2));
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  console.error('=====================');
  
  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production') {
    res.status(500).json({ 
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(500).json({ 
      error: err.message, 
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'https://dtprod.vercel.app'}`);
  console.log(`📊 Backend URL: https://dtprodback.onrender.com`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  }
  process.exit(1);
});

// Keep server warm (for Render)
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    console.log('Keep-alive ping:', new Date().toISOString());
  }, 14 * 60 * 1000); // Every 14 minutes
}

module.exports = app;
