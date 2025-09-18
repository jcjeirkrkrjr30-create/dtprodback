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

// Enhanced debug middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.path}`);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Authorization:', req.headers.authorization ? 'Present' : 'Missing');
  
  // Log body for POST/PUT requests (but limit size)
  if ((req.method === 'POST' || req.method === 'PUT') && req.body) {
    const bodyStr = JSON.stringify(req.body);
    console.log('Body:', bodyStr.length > 200 ? bodyStr.substring(0, 200) + '...' : bodyStr);
  }
  
  next();
});

// Rate limiting with adjusted settings for production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 300 : 1000, // More generous limits
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks and specific paths
    const skipPaths = ['/health', '/', '/api/health'];
    return skipPaths.includes(req.path);
  },
});

app.use(limiter);
app.use(sanitizeInput);

// Health check endpoints
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({ 
    message: 'DTProd API is running', 
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// API Routes - with enhanced logging
app.use('/api/admin', (req, res, next) => {
  console.log('Admin route accessed:', req.method, req.path);
  next();
}, adminRoutes);

app.use('/api/auth', (req, res, next) => {
  console.log('Auth route accessed:', req.method, req.path);
  next();
}, authRoutes);

app.use('/api/pages', (req, res, next) => {
  console.log('Pages route accessed:', req.method, req.path);
  next();
}, pagesRoutes);

app.use('/api/products', (req, res, next) => {
  console.log('Products route accessed:', req.method, req.path);
  next();
}, productsRoutes);

app.use('/api/orders', (req, res, next) => {
  console.log('Orders route accessed:', req.method, req.path);
  next();
}, ordersRoutes);

app.use('/api/users', (req, res, next) => {
  console.log('Users route accessed:', req.method, req.path);
  next();
}, usersRoutes);

app.use('/api/cart', (req, res, next) => {
  console.log('Cart route accessed:', req.method, req.path);
  next();
}, cartRoutes);

app.use('/api/categories', (req, res, next) => {
  console.log('Categories route accessed:', req.method, req.path);
  next();
}, categoriesRoutes);

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
