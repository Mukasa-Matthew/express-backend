import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import morgan from 'morgan';
import cron from 'node-cron';
import authRoutes from './routes/auth';
import hostelRoutes from './routes/hostels';
import analyticsRoutes from './routes/analytics';
import multiTenantAnalyticsRoutes from './routes/multi-tenant-analytics';
import roomsRoutes from './routes/rooms';
import studentsRoutes from './routes/students';
import paymentsRoutes from './routes/payments';
import inventoryRoutes from './routes/inventory';
import expensesRoutes from './routes/expenses';
import universityRoutes from './routes/universities';
import authSettingsRoutes from './routes/auth-settings';
import custodiansRoutes from './routes/custodians';
import subscriptionPlansRoutes from './routes/subscription-plans';
import semestersRoutes from './routes/semesters';
import publicRoutes from './routes/public';
import hostelImagesRoutes from './routes/hostel-images';
import { SubscriptionNotificationService } from './services/subscriptionNotificationService';
import { SemesterService } from './services/semesterService';
import { EmailService } from './services/emailService';
import { initializeDatabase } from './database/initialize';
import path from 'path';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// Security: Helmet
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS Configuration: Support multiple frontend origins
const getCorsOrigins = (): string[] | string => {
  const allowedOrigins = process.env.FRONTEND_URLS;
  
  // If FRONTEND_URLS is set, parse it (comma-separated list)
  if (allowedOrigins) {
    const origins = allowedOrigins.split(',').map(url => url.trim()).filter(Boolean);
    if (origins.length > 0) {
      return origins;
    }
  }
  
  // Default: In development, allow localhost; in production, use environment variable
  if (process.env.NODE_ENV === 'production') {
    // In production, require FRONTEND_URLS to be set
    const productionUrl = process.env.FRONTEND_URL;
    if (productionUrl) {
      return [productionUrl];
    }
    // If not set, include production frontend as fallback
    // WARNING: For better security, set FRONTEND_URL or FRONTEND_URLS in .env
    return [
      'http://64.23.169.136',
      'http://64.23.169.136:3000',
      'http://64.23.169.136:80',
      'https://roomio-weapp.vercel.app',
    ];
  }
  
  // Development: Allow localhost on common ports and production frontend
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3030',
    'http://localhost:5173', // Vite default
    'http://localhost:5174',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3030',
    'https://roomio-weapp.vercel.app',
    'http://127.0.0.1:5173',
    'http://64.23.169.136', // Production frontend
    'http://64.23.169.136:3000', // Production frontend on port 3000
    'http://64.23.169.136:80', // Production frontend on port 80
  ];
};

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const allowedOrigins = getCorsOrigins();
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    // If wildcard is used, allow all origins
    if (allowedOrigins === '*') {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies and authorization headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
};

app.use(cors(corsOptions));

// Log CORS configuration on startup
const corsOrigins = getCorsOrigins();
console.log('🌐 CORS Configuration:');
if (Array.isArray(corsOrigins)) {
  console.log(`   Allowed origins: ${corsOrigins.join(', ')}`);
} else {
  console.log(`   Allowed origins: ${corsOrigins} (${corsOrigins === '*' ? 'ALL - Development mode' : 'configured'})`);
}
console.log(`   Credentials: enabled`);
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);

// Body parsers with sane limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Compression
app.use(compression());

// Request logging (skip tests/production if disabled)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.MORGAN_FORMAT || 'combined'));
}

// Rate limits: general and sensitive endpoints
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
const writeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 300 });
app.use(generalLimiter);

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/hostels', writeLimiter, hostelRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/multi-tenant', multiTenantAnalyticsRoutes);
app.use('/api/universities', writeLimiter, universityRoutes);
app.use('/api/auth-settings', writeLimiter, authSettingsRoutes);
app.use('/api/custodians', writeLimiter, custodiansRoutes);
app.use('/api/rooms', writeLimiter, roomsRoutes);
app.use('/api/students', writeLimiter, studentsRoutes);
app.use('/api/payments', writeLimiter, paymentsRoutes);
app.use('/api/inventory', writeLimiter, inventoryRoutes);
app.use('/api/expenses', writeLimiter, expensesRoutes);
app.use('/api/subscription-plans', writeLimiter, subscriptionPlansRoutes);
app.use('/api/semesters', writeLimiter, semestersRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/hostels', hostelImagesRoutes);

// Static uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'LTS Portal API is running',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Route not found' 
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error' 
  });
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database (create tables and setup super admin)
    // This will automatically create tables from SQL file if they don't exist
    await initializeDatabase();
  } catch (error: any) {
    console.error('❌ Database initialization failed:', error.message);
    console.error('❌ Server cannot start without database initialization');
    console.log('');
    console.log('🔧 Please check:');
    console.log('   1. PostgreSQL is running');
    console.log('   2. Database exists: lts_portal');
    console.log('   3. .env file has correct database credentials');
    console.log('');
    process.exit(1);
  }

  // Initialize email service (non-blocking)
  // Supports both Resend (for VPS) and Nodemailer (for local testing)
  const hasResend = !!process.env.RESEND_API_KEY;
  const hasNodemailer = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
  
  if (hasResend || hasNodemailer) {
    console.log('📧 Initializing email service...');
    if (hasResend && hasNodemailer) {
      console.log('   Both Resend and Nodemailer configured');
      console.log(`   Using: ${process.env.EMAIL_PROVIDER || 'Resend (priority)'}`);
    } else if (hasResend) {
      console.log('   Using: Resend');
    } else {
      console.log('   Using: Nodemailer (SMTP)');
    }
    EmailService.initialize(); // Initialize immediately for faster email sending
    // Verify connection in background (non-blocking)
    EmailService.verifyConnection().catch((err) => {
      console.warn('⚠️  Email service verification failed (will retry on first send):', err.message);
    });
  } else {
    console.log('⚠️  Email service not configured');
    console.log('   Set RESEND_API_KEY for Resend (VPS) or SMTP_USER/SMTP_PASS for Nodemailer (local)');
    console.log('   Emails will be logged to console instead');
  }

  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🔐 Auth endpoints: http://localhost:${PORT}/api/auth`);
  });
}

startServer();

// Schedule subscription notification checks
// Run daily at 9:00 AM
cron.schedule('0 9 * * *', async () => {
  console.log('⏰ Running scheduled subscription notifications check...');
  await SubscriptionNotificationService.checkAndNotifyExpiringSubscriptions();
  await SubscriptionNotificationService.notifySuperAdminAboutExpiringSubscriptions();
}, {
  timezone: 'UTC'
});

// Schedule semester management checks
// Run daily at 8:00 AM
cron.schedule('0 8 * * *', async () => {
  console.log('📅 Running scheduled semester management check...');
  await SemesterService.checkAndEndSemesters();
  await SemesterService.sendUpcomingSemesterReminders();
}, {
  timezone: 'UTC'
});

console.log('⏰ Subscription notification scheduler initialized (runs daily at 9:00 AM UTC)');
console.log('📅 Semester management scheduler initialized (runs daily at 8:00 AM UTC)');

export default app;
