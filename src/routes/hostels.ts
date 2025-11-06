import express from 'express';
import bcrypt from 'bcryptjs';
import { HostelModel, CreateHostelWithAdminData } from '../models/Hostel';
import { UserModel } from '../models/User';
import { HostelSubscriptionModel } from '../models/SubscriptionPlan';
import { EmailService } from '../services/emailService';
import { CredentialGenerator } from '../utils/credentialGenerator';
import pool from '../config/database';
import { SimpleRateLimiter } from '../utils/rateLimiter';
import jwt from 'jsonwebtoken';

const router = express.Router();
const resendLimiter = new SimpleRateLimiter(3, 60 * 60 * 1000); // 3 per hour

// Helper function to verify token (handles local super admin bypass)
export async function verifyTokenAndGetUser(req: express.Request): Promise<{ user: any; userId: number; role: string } | null> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;

  // Handle local super admin bypass token
  if (token === 'local_super_admin_token') {
    // Return a mock super admin user object
    return {
      user: { id: 0, role: 'super_admin', email: 'superadmin@local', name: 'Super Admin' },
      userId: 0,
      role: 'super_admin'
    };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as any;
    const user = await UserModel.findById(decoded.userId);
    if (!user) return null;
    
    return {
      user,
      userId: user.id,
      role: user.role
    };
  } catch {
    return null;
  }
}

// Get all hostels
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limitRaw = Math.max(1, parseInt((req.query.limit as string) || '20', 10));
    const limit = Math.min(100, limitRaw);
    const offset = (page - 1) * limit;
    const sort = (req.query.sort as string) || 'name';
    const order = ((req.query.order as string) || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const search = (req.query.search as string) || '';
    const statusFilter = (req.query.status as string) || '';
    const sortable = new Set(['name','created_at','total_rooms']);
    const sortCol = sortable.has(sort) ? sort : 'name';

    // Build WHERE clause
    let whereClause = '';
    const params: any[] = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      whereClause += ` WHERE (h.name ILIKE $${paramCount} OR h.address ILIKE $${paramCount} OR u.name ILIKE $${paramCount} OR u.email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (statusFilter) {
      paramCount++;
      if (whereClause) {
        whereClause += ` AND hs.status = $${paramCount}`;
      } else {
        whereClause += ` WHERE hs.status = $${paramCount}`;
      }
      params.push(statusFilter);
    }

    const query = `
      SELECT 
        h.id, h.name, h.address, h.status, h.created_at, h.total_rooms,
        h.contact_phone, h.contact_email,
        u.name as admin_name, u.email as admin_email,
        hs.id as subscription_id, hs.status as subscription_status, hs.start_date, hs.end_date,
        hs.amount_paid, sp.name as plan_name, sp.total_price,
        EXTRACT(EPOCH FROM (hs.end_date - NOW())) / 86400 as days_until_expiry,
        (SELECT COUNT(*) FROM student_room_assignments sra JOIN rooms r ON sra.room_id = r.id WHERE r.hostel_id = h.id AND sra.status = 'active') as students_count,
        (h.total_rooms - COALESCE((SELECT COUNT(DISTINCT sra.id) FROM student_room_assignments sra JOIN rooms r ON sra.room_id = r.id WHERE r.hostel_id = h.id AND sra.status = 'active'), 0)) as available_rooms
      FROM hostels h
      LEFT JOIN users u ON h.id = u.hostel_id AND u.role = 'hostel_admin'
      LEFT JOIN hostel_subscriptions hs ON h.current_subscription_id = hs.id
      LEFT JOIN subscription_plans sp ON hs.plan_id = sp.id
      ${whereClause}
      ORDER BY h.${sortCol} ${order}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM hostels h
      LEFT JOIN users u ON h.id = u.hostel_id AND u.role = 'hostel_admin'
      LEFT JOIN hostel_subscriptions hs ON h.current_subscription_id = hs.id
      ${whereClause}
    `;

    const [list, totalRes] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, params)
    ]);

    // Transform the data
    const transformedData = list.rows.map(row => ({
      id: row.id,
      name: row.name,
      address: row.address,
      status: row.status,
      created_at: row.created_at,
      total_rooms: row.total_rooms,
      available_rooms: row.available_rooms,
      contact_phone: row.contact_phone,
      contact_email: row.contact_email,
      admin: row.admin_name ? {
        name: row.admin_name,
        email: row.admin_email
      } : null,
      subscription: row.subscription_id ? {
        id: row.subscription_id,
        plan_name: row.plan_name,
        status: row.subscription_status,
        start_date: row.start_date,
        end_date: row.end_date,
        amount_paid: row.amount_paid,
        days_until_expiry: row.days_until_expiry !== null ? Math.ceil(row.days_until_expiry) : null,
        total_price: row.total_price
      } : null,
      students_count: row.students_count
    }));

    res.json({ 
      success: true, 
      data: transformedData, 
      page, 
      limit, 
      total: totalRes.rows[0].total 
    });
  } catch (error) {
    console.error('Get hostels error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get hostel by ID
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get hostel with calculated available rooms and admin info
    const query = `
      SELECT 
        h.id, h.name, h.address, h.description, h.status, h.total_rooms,
        h.contact_phone, h.contact_email, h.university_id, h.created_at,
        h.is_published, h.latitude, h.longitude,
        u.name as admin_name, u.email as admin_email,
        hs.id as subscription_id, hs.status as subscription_status, hs.start_date, hs.end_date,
        hs.amount_paid, sp.name as plan_name,
        un.name as university_name,
        (SELECT COUNT(*) FROM student_room_assignments sra JOIN rooms r ON sra.room_id = r.id WHERE r.hostel_id = h.id AND sra.status = 'active') as students_count,
        (h.total_rooms - COALESCE((SELECT COUNT(DISTINCT sra.id) FROM student_room_assignments sra JOIN rooms r ON sra.room_id = r.id WHERE r.hostel_id = h.id AND sra.status = 'active'), 0)) as available_rooms
      FROM hostels h
      LEFT JOIN users u ON h.id = u.hostel_id AND u.role = 'hostel_admin'
      LEFT JOIN hostel_subscriptions hs ON h.current_subscription_id = hs.id
      LEFT JOIN subscription_plans sp ON hs.plan_id = sp.id
      LEFT JOIN universities un ON h.university_id = un.id
      WHERE h.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (!result.rows[0]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Hostel not found' 
      });
    }
    
    const row = result.rows[0];
    const hostel = {
      id: row.id,
      name: row.name,
      address: row.address,
      description: row.description,
      status: row.status,
      total_rooms: row.total_rooms,
      available_rooms: row.available_rooms,
      contact_phone: row.contact_phone,
      contact_email: row.contact_email,
      university_id: row.university_id,
      university_name: row.university_name,
      is_published: row.is_published || false,
      latitude: row.latitude,
      longitude: row.longitude,
      created_at: row.created_at,
      admin: row.admin_name ? {
        name: row.admin_name,
        email: row.admin_email
      } : null,
      subscription: row.subscription_id ? {
        id: row.subscription_id,
        plan_name: row.plan_name,
        status: row.subscription_status,
        start_date: row.start_date,
        end_date: row.end_date,
        amount_paid: row.amount_paid
      } : null
    };

    res.json({
      success: true,
      data: hostel
    });
  } catch (error) {
    console.error('Get hostel error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Create new hostel with admin
router.post('/', async (req, res) => {
  try {
    const {
      name,
      address,
      description,
      total_rooms,
      available_rooms,
      contact_phone,
      contact_email,
      status,
      university_id,
      occupancy_type,
      subscription_plan_id,
      admin_name,
      admin_email,
      admin_phone,
      admin_address
    }: CreateHostelWithAdminData = req.body;

    // Validate required fields
    if (!name || !address || !total_rooms || !admin_name || !admin_email || !admin_phone || !admin_address || !subscription_plan_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields including subscription plan' 
      });
    }

    // Generate temporary credentials
    const temporaryUsername = admin_email; // Use email as username
    const temporaryPassword = CredentialGenerator.generatePatternPassword(); // Generate memorable password

    // Check if admin email already exists
    const existingUser = await UserModel.findByEmail(admin_email);
    if (existingUser) {
      // If user exists and is already a hostel admin with a hostel_id, reject
      if (existingUser.role === 'hostel_admin' && existingUser.hostel_id) {
        return res.status(400).json({ 
          success: false, 
          message: 'This email is already assigned as admin to another hostel' 
        });
      }
      // If user exists with any other role, also reject (email must be unique)
      return res.status(400).json({ 
        success: false, 
        message: 'This email is already registered in the system. Please use a different email address.' 
      });
    }

    // Start transaction and hash password in parallel for better performance
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Hash password in parallel with other operations
      const [hostelData, hashedPassword] = await Promise.all([
        Promise.resolve({
          name,
          address,
          description,
          total_rooms,
          available_rooms: available_rooms || total_rooms,
          contact_phone,
          contact_email,
          status: status || 'active',
          university_id,
          occupancy_type
        }),
        bcrypt.hash(temporaryPassword, 10)
      ]);

      // Create hostel
      const hostel = await HostelModel.create(hostelData);

      // Create hostel admin user
      const adminData = {
        email: admin_email,
        name: admin_name,
        password: hashedPassword,
        role: 'hostel_admin' as const
      };

      const admin = await UserModel.create(adminData);

      // Update admin's hostel_id
      await client.query('UPDATE users SET hostel_id = $1 WHERE id = $2', [hostel.id, admin.id]);

      // Verify subscription plan exists
      const planId = parseInt(subscription_plan_id);
      if (isNaN(planId)) {
        throw new Error('Invalid subscription plan ID');
      }

      const planResult = await client.query('SELECT name, duration_months, total_price, price_per_month FROM subscription_plans WHERE id = $1 AND is_active = true', [planId]);
      if (planResult.rows.length === 0) {
        throw new Error('Subscription plan not found or inactive');
      }

      const plan = planResult.rows[0];
      const durationMonths = plan.duration_months;

      // Calculate end date based on plan duration
      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + durationMonths);

      // Create subscription for the hostel (using transaction client)
      const subscriptionResult = await client.query(
        `INSERT INTO hostel_subscriptions (hostel_id, plan_id, start_date, end_date, amount_paid, status, payment_method, payment_reference)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          hostel.id,
          planId,
          startDate,
          endDate,
          0, // amount_paid - will be updated when payment is recorded
          'active',
          'pending',
          `PENDING-${hostel.id}-${Date.now()}`
        ]
      );
      const subscription = subscriptionResult.rows[0];

      // Update hostel with current subscription
      await client.query('UPDATE hostels SET current_subscription_id = $1 WHERE id = $2', [subscription.id, hostel.id]);

      await client.query('COMMIT');

      // Send response immediately - don't wait for email
      res.status(201).json({
        success: true,
        message: 'Hostel and admin created successfully. Welcome email will be sent shortly.',
        data: {
          hostel,
          admin: {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            role: admin.role,
            hostel_id: hostel.id
          }
        }
      });

      // Prepare email data
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
      const emailHtml = EmailService.generateHostelAdminWelcomeEmail(
        admin_name,
        admin_email,
        temporaryUsername,
        temporaryPassword,
        hostel.name,
        loginUrl,
        {
          planName: plan.name,
          startDate: startDate,
          endDate: endDate,
          durationMonths: durationMonths,
          pricePerMonth: parseFloat(plan.price_per_month || 0),
          totalPrice: parseFloat(plan.total_price || 0),
          amountPaid: 0,
          paymentReference: subscription.payment_reference
        }
      );

      const emailOptions = {
        to: admin_email,
        subject: `Welcome to LTS Portal - Hostel Admin for ${hostel.name}`,
        html: emailHtml
      };

      // Send welcome email asynchronously (non-blocking)
      // This runs in the background and won't delay the API response
      (async () => {
        try {
          console.log(`\n📧 Attempting to send welcome email to ${admin_email}...`);
          console.log(`   Hostel: ${hostel.name}`);
          console.log(`   Admin: ${admin_name}`);
          
          // Ensure email service is initialized
          EmailService.initialize();
          
          const emailSent = await EmailService.sendEmail(emailOptions);
          
          if (emailSent) {
            console.log(`✅ Welcome email sent successfully to ${admin_email}`);
          } else {
            console.warn(`\n⚠️ Email sending returned false for ${admin_email}`);
            console.warn('   This usually means SMTP is not configured or email failed.');
            // Fallback: log credentials to console with explicit values
            console.log('\n' + '='.repeat(70));
            console.log('📋 FALLBACK: TEMPORARY LOGIN CREDENTIALS');
            console.log('='.repeat(70));
            console.log(`To: ${admin_email}`);
            console.log(`Hostel: ${hostel.name}`);
            console.log(`Admin Name: ${admin_name}`);
            console.log('─'.repeat(70));
            console.log('🔐 TEMPORARY CREDENTIALS:');
            console.log(`   Username/Email: ${temporaryUsername}`);
            console.log(`   Password: ${temporaryPassword}`);
            console.log('─'.repeat(70));
            console.log(`Login URL: ${loginUrl}`);
            console.log('='.repeat(70) + '\n');
            EmailService.logCredentialsToConsole(emailOptions);
          }
        } catch (emailError: any) {
          console.error('\n❌ Error sending welcome email:', emailError);
          console.error('   Error message:', emailError.message);
          console.error('   Error code:', emailError.code);
          if (emailError.stack) {
            console.error('   Stack:', emailError.stack);
          }
          // Always log credentials to console as fallback with explicit values
          console.log('\n' + '='.repeat(70));
          console.log('📋 FALLBACK: TEMPORARY LOGIN CREDENTIALS (Email Failed)');
          console.log('='.repeat(70));
          console.log(`To: ${admin_email}`);
          console.log(`Hostel: ${hostel.name}`);
          console.log(`Admin Name: ${admin_name}`);
          console.log('─'.repeat(70));
          console.log('🔐 TEMPORARY CREDENTIALS:');
          console.log(`   Username/Email: ${temporaryUsername}`);
          console.log(`   Password: ${temporaryPassword}`);
          console.log('─'.repeat(70));
          console.log(`Login URL: ${loginUrl}`);
          console.log('='.repeat(70) + '\n');
          EmailService.logCredentialsToConsole(emailOptions);
        }
      })();

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('Create hostel error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Internal server error';
    if (error.message) {
      errorMessage = error.message;
    } else if (error.code === '23503') {
      errorMessage = 'Invalid subscription plan or reference error';
    } else if (error.code === '23505') {
      errorMessage = 'Duplicate entry detected';
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Update hostel
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updateData = req.body;

    const hostel = await HostelModel.update(id, updateData);
    
    if (!hostel) {
      return res.status(404).json({ 
        success: false, 
        message: 'Hostel not found' 
      });
    }

    res.json({
      success: true,
      message: 'Hostel updated successfully',
      data: hostel
    });
  } catch (error) {
    console.error('Update hostel error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Delete hostel (super_admin only)
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const authResult = await verifyTokenAndGetUser(req);
    if (!authResult) {
      return res.status(401).json({ success: false, message: 'No token provided or invalid token' });
    }
    
    if (authResult.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    
    const currentUser = authResult.user;

    const id = parseInt(req.params.id);
    
    // Verify hostel exists
    const hostel = await HostelModel.findById(id);
    if (!hostel) {
      return res.status(404).json({ 
        success: false, 
        message: 'Hostel not found' 
      });
    }

    await client.query('BEGIN');

    // Get all custodians for this hostel
    const custodiansResult = await client.query(
      'SELECT user_id FROM custodians WHERE hostel_id = $1',
      [id]
    );

    // Delete custodian users (custodians table will be deleted via CASCADE when hostel is deleted)
    for (const row of custodiansResult.rows) {
      await client.query('DELETE FROM users WHERE id = $1', [row.user_id]);
    }

    // Delete hostel admin user (users with hostel_id and role = 'hostel_admin')
    const adminResult = await client.query(
      "SELECT id FROM users WHERE hostel_id = $1 AND role = 'hostel_admin'",
      [id]
    );
    for (const row of adminResult.rows) {
      await client.query('DELETE FROM users WHERE id = $1', [row.id]);
    }

    // Delete the hostel (this will CASCADE delete custodians, rooms, subscriptions, etc.)
    await client.query('DELETE FROM hostels WHERE id = $1', [id]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Hostel and all associated data (admin, custodians, and related records) deleted successfully'
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Delete hostel error:', error);
    // Surface FK constraint in a friendly way
    if (error.code === '23503') {
      return res.status(400).json({ success: false, message: 'Cannot delete hostel with related records. Remove dependencies first.' });
    }
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  } finally {
    client.release();
  }
});

// Get hostel statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const stats = await HostelModel.getHostelStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get hostel stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Resend credentials to hostel admin
// Resend credentials to hostel admin (super_admin only)
router.post('/:id/resend-credentials', async (req, res) => {
  try {
    const authResult = await verifyTokenAndGetUser(req);
    if (!authResult) {
      return res.status(401).json({ success: false, message: 'No token provided or invalid token' });
    }
    
    if (authResult.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    
    const currentUser = authResult.user;
    const hostelId = parseInt(req.params.id);

    // Rate limit per (requester, hostelId, action)
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const rl = resendLimiter.allow(['resend_admin_credentials', currentUser.id, hostelId, ip]);
    if (!rl.allowed) {
      return res.status(429).json({ success: false, message: `Too many requests. Try again in ${Math.ceil(rl.resetMs/1000)}s` });
    }
    
    // Get hostel details
    const hostel = await HostelModel.findById(hostelId);
    if (!hostel) {
      return res.status(404).json({
        success: false,
        message: 'Hostel not found'
      });
    }

    // Get the hostel admin by hostel_id
    const adminQuery = 'SELECT * FROM users WHERE hostel_id = $1 AND role = $2';
    const adminResult = await pool.query(adminQuery, [hostelId, 'hostel_admin']);
    const admin = adminResult.rows[0];
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Hostel admin not found'
      });
    }

    // Generate new temporary password
    const newTemporaryPassword = CredentialGenerator.generatePatternPassword();
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newTemporaryPassword, 10);
    
    // Update the admin's password
    await UserModel.update(admin.id, { password: hashedPassword });

    // Fetch subscription details if available
    let subscriptionDetails = null;
    if (hostel.current_subscription_id) {
      try {
        const subResult = await pool.query(
          `SELECT hs.*, sp.name, sp.price_per_month 
           FROM hostel_subscriptions hs 
           JOIN subscription_plans sp ON hs.plan_id = sp.id 
           WHERE hs.id = $1`,
          [hostel.current_subscription_id]
        );
        
        if (subResult.rows.length > 0) {
          const sub = subResult.rows[0];
          subscriptionDetails = {
            planName: sub.name,
            startDate: sub.start_date,
            endDate: sub.end_date,
            durationMonths: Math.ceil((new Date(sub.end_date).getTime() - new Date(sub.start_date).getTime()) / (1000 * 60 * 60 * 24 * 30)),
            pricePerMonth: parseFloat(sub.price_per_month || 0),
            totalPrice: sub.amount_paid || 0,
            amountPaid: sub.amount_paid || 0,
            paymentReference: sub.payment_reference
          };
        }
      } catch (subError) {
        console.error('Error fetching subscription details:', subError);
      }
    }

    // Send new credentials via email
    try {
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
      const emailHtml = EmailService.generateHostelAdminWelcomeEmail(
        admin.name,
        admin.email,
        admin.email, // Username is the email
        newTemporaryPassword,
        hostel.name,
        loginUrl,
        subscriptionDetails || undefined
      );

      const emailSent = await EmailService.sendEmail({
        to: admin.email,
        subject: `New Login Credentials - LTS Portal (${hostel.name})`,
        html: emailHtml
      });

      if (!emailSent) {
        console.warn('Failed to send new credentials email to hostel admin');
      }
    } catch (emailError) {
      console.error('Error sending new credentials email:', emailError);
      // Don't fail the request if email fails
    }

    // Audit log success
    await pool.query(
      `INSERT INTO audit_logs (action, requester_user_id, target_user_id, target_hostel_id, status, message, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      ['resend_admin_credentials', currentUser.id, admin.id, hostelId, 'success', 'Password rotated and email sent', ip, (req.headers['user-agent'] as string) || null]
    );

    res.json({ success: true, message: 'New credentials sent successfully' });

  } catch (error) {
    console.error('Resend credentials error:', error);
    try {
      // Best-effort audit failure
      const authResult = await verifyTokenAndGetUser(req);
      const requesterId = authResult?.userId || null;
      const hostelId = Number(req.params.id) || null;
      await pool.query(
        `INSERT INTO audit_logs (action, requester_user_id, target_user_id, target_hostel_id, status, message, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        ['resend_admin_credentials', requesterId, null, hostelId, 'failure', 'Internal server error', (req.headers['x-forwarded-for'] as string) || req.ip || '', (req.headers['user-agent'] as string) || null]
      );
    } catch {}
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;

// Admin summary for a hostel: primary admin and custodian count
router.get('/:id/admin-summary', async (req, res) => {
  try {
    const hostelId = Number(req.params.id);
    if (!Number.isFinite(hostelId)) return res.status(400).json({ success: false, message: 'Invalid hostel id' });

    const adminRes = await pool.query(
      `SELECT id, name, email, username, created_at FROM users WHERE hostel_id = $1 AND role = 'hostel_admin' ORDER BY created_at ASC LIMIT 1`,
      [hostelId]
    );
    const hostelRes = await pool.query(
      `SELECT name, address, contact_phone, contact_email FROM hostels WHERE id = $1`,
      [hostelId]
    );
    const custodianRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM custodians WHERE hostel_id = $1`,
      [hostelId]
    );

    const admin = adminRes.rows[0] || null;
    const hostel = hostelRes.rows[0] || null;
    return res.json({
      success: true,
      data: admin ? {
        admin_id: admin.id,
        admin_name: admin.name,
        admin_email: admin.email,
        admin_username: admin.username || null,
        admin_created_at: admin.created_at,
        custodian_count: custodianRes.rows[0]?.cnt || 0,
        contact_phone: hostel?.contact_phone || null,
        contact_email: hostel?.contact_email || null,
        address: hostel?.address || null
      } : {
        admin_id: null,
        admin_name: 'Unknown',
        admin_email: '-',
        admin_username: null,
        admin_created_at: null,
        custodian_count: custodianRes.rows[0]?.cnt || 0,
        contact_phone: hostel?.contact_phone || null,
        contact_email: hostel?.contact_email || null,
        address: hostel?.address || null
      }
    });
  } catch (e) {
    console.error('Admin summary error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

