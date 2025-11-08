import express, { Request } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { UserModel } from '../models/User';
import pool from '../config/database';
import { EmailService } from '../services/emailService';
import { CredentialGenerator } from '../utils/credentialGenerator';
import { SimpleRateLimiter } from '../utils/rateLimiter';

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'backend', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => cb(null, uploadsDir),
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

// List custodians for a hostel
router.get('/', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    // Simple decode: we trust auth middleware in real apps; here we query via join on current user
    // Get user via token
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Determine target hostel id
    let targetHostelId: number | null = null;
    if (currentUser.role === 'hostel_admin') {
      targetHostelId = currentUser.hostel_id || null;
      if (!targetHostelId) {
        console.error(`[Custodians] Hostel admin ${currentUser.id} has no hostel_id assigned`);
        return res.status(403).json({ success: false, message: 'Forbidden: no hostel assigned' });
      }
    } else if (currentUser.role === 'super_admin') {
      const q = req.query.hostel_id as string | undefined;
      targetHostelId = q ? parseInt(q) : null;
      // Super admin can fetch all custodians if no hostel_id is provided
    } else {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    
    // Log for debugging
    console.log(`[Custodians] Fetching custodians for hostel_id: ${targetHostelId}, currentUser: ${currentUser.role} (${currentUser.id})`);

    // Check if phone column exists in custodians table
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'phone'
    `);
    
    const hasPhoneColumn = columnCheck.rows.length > 0;
    const hasLocationColumn = (await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'location'
    `)).rows.length > 0;
    const hasNationalIdColumn = (await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'national_id_image_path'
    `)).rows.length > 0;
    
    // Build query with available columns
    let selectColumns = ['c.id', 'u.name', 'u.email', 'c.status', 'c.created_at', 'c.hostel_id'];
    if (hasPhoneColumn) selectColumns.push('c.phone');
    if (hasLocationColumn) selectColumns.push('c.location');
    if (hasNationalIdColumn) selectColumns.push('c.national_id_image_path');
    
    let query = `SELECT ${selectColumns.join(', ')}
       FROM custodians c
       JOIN users u ON u.id = c.user_id`;
    const params: any[] = [];
    
    if (targetHostelId) {
      query += ' WHERE c.hostel_id = $1';
      params.push(targetHostelId);
    }
    
    query += ' ORDER BY c.created_at DESC';
    
    const result = await pool.query(query, params);
    
    // Log the raw query result for debugging
    console.log('Raw custodians query result:', result.rows);
    
    // Map results to ensure all expected fields exist
    const mappedRows = result.rows.map(row => {
      const mapped = {
        id: row.id,
        name: row.name || 'Unknown',
        email: row.email || null, // Ensure email is included
        phone: row.phone || null,
        location: row.location || null,
        national_id_image_path: row.national_id_image_path || null,
        status: row.status || 'active',
        created_at: row.created_at,
        hostel_id: row.hostel_id
      };
      console.log('Mapped custodian:', mapped);
      return mapped;
    });
    
    res.json({ success: true, data: mappedRows });
  } catch (e) {
    console.error('List custodians error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get current custodian's hostel information (must be before /:id routes)
router.get('/my-hostel', async (req: Request, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Only custodians can access this endpoint
    if (currentUser.role !== 'custodian') {
      return res.status(403).json({ success: false, message: 'Forbidden: This endpoint is for custodians only' });
    }

    // Get custodian's hostel_id
    const custodianResult = await pool.query(
      'SELECT c.hostel_id, h.name as hostel_name, h.address, h.contact_phone, h.contact_email FROM custodians c LEFT JOIN hostels h ON h.id = c.hostel_id WHERE c.user_id = $1',
      [currentUser.id]
    );

    if (custodianResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Custodian record not found' });
    }

    const row = custodianResult.rows[0];
    
    if (!row.hostel_id) {
      return res.status(404).json({ success: false, message: 'No hostel assigned to this custodian' });
    }

    res.json({
      success: true,
      data: {
        hostel_id: row.hostel_id,
        hostel_name: row.hostel_name,
        address: row.address,
        contact_phone: row.contact_phone,
        contact_email: row.contact_email
      }
    });
  } catch (e) {
    console.error('Get custodian hostel error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Create custodian with optional national ID image upload
router.post('/', upload.single('national_id_image'), async (req: Request, res) => {
  const client = await pool.connect();
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Determine target hostel id
    let targetHostelId: number | null = null;
    if (currentUser.role === 'hostel_admin' && currentUser.hostel_id) {
      targetHostelId = currentUser.hostel_id;
    } else if (currentUser.role === 'super_admin') {
      const q = (req.body as any).hostel_id || (req.query.hostel_id as string | undefined);
      targetHostelId = q ? parseInt(q) : null;
    }
    if (!targetHostelId) {
      return res.status(403).json({ success: false, message: 'Forbidden: missing hostel context' });
    }

    const { name, email, phone, location } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Missing required fields: name and email are required' });
    }
    
    // Ensure optional columns exist for legacy databases
    await pool
      .query(`ALTER TABLE custodians ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`)
      .catch((err) => console.warn('Failed ensuring custodians.phone column:', err?.message || err));
    await pool
      .query(`ALTER TABLE custodians ADD COLUMN IF NOT EXISTS location TEXT`)
      .catch((err) => console.warn('Failed ensuring custodians.location column:', err?.message || err));
    await pool
      .query(`ALTER TABLE custodians ADD COLUMN IF NOT EXISTS national_id_image_path TEXT`)
      .catch((err) => console.warn('Failed ensuring custodians.national_id_image_path column:', err?.message || err));

    // Check which columns exist in custodians table (do this once and reuse)
    const phoneCheckResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'phone'
    `);
    const locationCheckResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'location'
    `);
    const nationalIdCheckResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'national_id_image_path'
    `);
    
    const hasPhoneColumn = phoneCheckResult.rows.length > 0;
    const hasLocationColumn = locationCheckResult.rows.length > 0;
    const hasNationalIdColumn = nationalIdCheckResult.rows.length > 0;
    
    // Only validate phone/location if the columns exist
    if (hasPhoneColumn && !phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    if (hasLocationColumn && !location) {
      return res.status(400).json({ success: false, message: 'Location is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    // Check if email already exists before attempting to create (case-insensitive)
    const existingUserResult = await pool.query(
      'SELECT id, name, email, role, hostel_id FROM users WHERE LOWER(email) = LOWER($1)', 
      [email]
    );

    const nationalIdPath = (req as any).file ? `/uploads/${(req as any).file.filename}` : null;

    await client.query('BEGIN');

    const tempPassword = CredentialGenerator.generatePatternPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);

    let userId: number;
    let userNameForResponse = name;
    let userEmailForResponse = email;
    const usingExistingAccount = existingUserResult.rows.length > 0;

    if (usingExistingAccount) {
      const existingUserRow = existingUserResult.rows[0];
      const existingRole = existingUserRow.role || 'unknown';
      const existingName = existingUserRow.name || name;

      // Restrict deleting/re-using privileged accounts
      if (existingRole === 'super_admin') {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'This email belongs to the super admin and cannot be reused.',
          existingUser: {
            name: existingName,
            email: existingUserRow.email,
            role: existingRole
          }
        });
      }

      if (existingRole === 'hostel_admin' && existingUserRow.hostel_id && existingUserRow.hostel_id !== targetHostelId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'This email is already registered as a hostel admin for another hostel. Please use a different email.',
          existingUser: {
            name: existingName,
            email: existingUserRow.email,
            role: existingRole
          }
        });
      }

      if (existingRole === 'custodian') {
        const custodianCheck = await pool.query(
          'SELECT hostel_id FROM custodians WHERE user_id = $1',
          [existingUserRow.id]
        );
        if (custodianCheck.rows.length > 0) {
          const existingHostelId = custodianCheck.rows[0].hostel_id;
          if (existingHostelId === targetHostelId) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'This email is already registered as a custodian for your hostel.',
              existingUser: {
                name: existingName,
                email: existingUserRow.email,
                role: existingRole
              }
            });
          }

          await client.query('ROLLBACK');
          return res.status(403).json({
            success: false,
            message: 'This email is already registered as a custodian for another hostel. Please use a different email.',
            existingUser: {
              name: existingName,
              email: existingUserRow.email,
              role: existingRole
            }
          });
        }
      }

      // Re-use existing account: update role/hostel and rotate password
      userId = existingUserRow.id;
      userNameForResponse = existingName;
      userEmailForResponse = existingUserRow.email;

      await client.query(
        `UPDATE users 
           SET name = $1, role = $2, hostel_id = $3, password = $4, updated_at = NOW()
         WHERE id = $5`,
        [name || existingName, 'custodian', targetHostelId, hashed, userId]
      );

      // Remove any stale custodian profile for this user so we can recreate it cleanly
      await client.query('DELETE FROM custodians WHERE user_id = $1', [userId]);
    } else {
      // Create fresh user record within the transaction
      const insertUserResult = await client.query(
        `INSERT INTO users (email, name, password, role, hostel_id) 
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email`,
        [email, name, hashed, 'custodian', targetHostelId]
      );

      const insertedUser = insertUserResult.rows[0];
      userId = insertedUser.id;
      userNameForResponse = insertedUser.name || name;
      userEmailForResponse = insertedUser.email || email;
    }
    
    // Build dynamic INSERT query based on available columns
    const insertColumns = ['user_id', 'hostel_id'];
    const insertValues: any[] = [userId, targetHostelId];
    
    if (hasPhoneColumn) {
      insertColumns.push('phone');
      insertValues.push(phone);
    }
    if (hasLocationColumn) {
      insertColumns.push('location');
      insertValues.push(location);
    }
    if (hasNationalIdColumn) {
      insertColumns.push('national_id_image_path');
      insertValues.push(nationalIdPath);
    }

    // Insert custodian profile
    const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ');
    const custodianInsert = await client.query(
      `INSERT INTO custodians (${insertColumns.join(', ')})
       VALUES (${placeholders})
       RETURNING id`,
      insertValues
    );

    const custodianId = custodianInsert.rows[0]?.id || null;

    await client.query('COMMIT');

    // Fetch hostel name for email
    let hostelName = 'Your Hostel';
    try {
      const hostelResult = await pool.query('SELECT name FROM hostels WHERE id = $1', [targetHostelId]);
      if (hostelResult.rows.length > 0) {
        hostelName = hostelResult.rows[0].name;
      }
    } catch (e) {
      console.warn('Failed to fetch hostel name for email:', e);
    }

    // Send welcome email asynchronously so slow email providers don't block the response
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
    const html = EmailService.generateCustodianWelcomeEmail(
      name || userNameForResponse,
      userEmailForResponse,
      userEmailForResponse,
      tempPassword,
      hostelName,
      loginUrl
    );
    EmailService.sendEmailAsync({
      to: userEmailForResponse,
      subject: `Your Custodian Account - ${hostelName} - LTS Portal`,
      html
    });

    // Return credentials in response so hostel admin can view/copy them
    res.status(201).json({ 
      success: true, 
      message: 'Custodian created successfully. Welcome email will be sent shortly.',
      data: {
        custodian: {
          id: custodianId || userId,
          email: userEmailForResponse,
          name: name || userNameForResponse,
          role: 'custodian'
        },
        credentials: {
          username: userEmailForResponse,
          password: tempPassword,
          loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
        }
      }
    });
  } catch (e: any) {
    try {
    await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Ignore rollback errors
    }
    
    console.error('Create custodian error:', {
      code: e.code,
      message: e.message,
      meta: e.meta,
      stack: e.stack
    });
    
    // Handle Prisma unique constraint violation (P2002)
    if (e.code === 'P2002') {
      const target = Array.isArray(e.meta?.target) ? e.meta.target : [];
      if (target.includes('email') || e.message?.includes('email')) {
        return res.status(400).json({ 
          success: false, 
          message: 'A user with this email address already exists. Please use a different email.' 
        });
      }
      return res.status(400).json({ 
        success: false, 
        message: 'Duplicate entry detected. This record already exists.' 
      });
    }
    
    // Handle PostgreSQL unique constraint violation (23505)
    if (e.code === '23505') {
      return res.status(400).json({ 
        success: false, 
        message: 'A user with this email address already exists. Please use a different email.' 
      });
    }
    
    // Handle Prisma errors that might be wrapped
    if (e.message && (e.message.includes('Unique constraint') || e.message.includes('duplicate') || e.message.includes('already exists'))) {
      if (e.message.toLowerCase().includes('email')) {
        return res.status(400).json({ 
          success: false, 
          message: 'A user with this email address already exists. Please use a different email.' 
        });
      }
      return res.status(400).json({ 
        success: false, 
        message: 'This record already exists. Please check your input and try again.' 
      });
    }
    
    // Handle other validation errors
    if (e.message && e.message.includes('email')) {
      return res.status(400).json({ 
        success: false, 
        message: e.message 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? e.message : undefined
    });
  } finally {
    client.release();
  }
});

// Update custodian (name, phone, location, status)
router.put('/:id', async (req: Request, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { id } = req.params;
    const { name, phone, location, status } = req.body as any;

    // Ensure the custodian belongs to this hostel
    const check = await pool.query(
      `SELECT c.id FROM custodians c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1 AND c.hostel_id = COALESCE($2, c.hostel_id)`,
      [parseInt(id), currentUser.hostel_id || null]
    );
    if (!check.rowCount && currentUser.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    if (name) await pool.query('UPDATE users SET name = $1 WHERE id = (SELECT user_id FROM custodians WHERE id = $2)', [name, id]);

    // Ensure optional columns exist for legacy databases
    await pool
      .query(`ALTER TABLE custodians ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`)
      .catch((err) => console.warn('Failed ensuring custodians.phone column:', err?.message || err));
    await pool
      .query(`ALTER TABLE custodians ADD COLUMN IF NOT EXISTS location TEXT`)
      .catch((err) => console.warn('Failed ensuring custodians.location column:', err?.message || err));

    // Check which columns exist before updating
    const phoneCheckUpdate = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'phone'
    `);
    const locationCheckUpdate = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'location'
    `);
    
    const hasPhoneCol = phoneCheckUpdate.rows.length > 0;
    const hasLocationCol = locationCheckUpdate.rows.length > 0;
    
    // Build dynamic UPDATE query
    const updateParts: string[] = [];
    const updateValues: any[] = [];
    
    if (hasPhoneCol && phone !== undefined) {
      updateParts.push('phone = $' + (updateValues.length + 1));
      updateValues.push(phone);
    }
    if (hasLocationCol && location !== undefined) {
      updateParts.push('location = $' + (updateValues.length + 1));
      updateValues.push(location);
    }
    if (status !== undefined) {
      updateParts.push('status = $' + (updateValues.length + 1));
      updateValues.push(status);
    }
    
    if (updateParts.length > 0) {
      updateValues.push(id);
    await pool.query(
        `UPDATE custodians SET ${updateParts.join(', ')} WHERE id = $${updateValues.length}`,
        updateValues
    );
    }

    res.json({ success: true, message: 'Custodian updated successfully' });
  } catch (e) {
    console.error('Update custodian error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Delete user by email (for cases where user exists but isn't a custodian yet)
router.delete('/by-email/:email', async (req: Request, res) => {
  const client = await pool.connect();
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Only allow hostel_admin and super_admin
    if (currentUser.role !== 'hostel_admin' && currentUser.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const email = decodeURIComponent(req.params.email);
    
    // Find user by email
    const userResult = await pool.query('SELECT id, role, hostel_id, name FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found with this email' });
    }

    const userToDelete = userResult.rows[0];
    
    // If hostel_admin, ensure the user belongs to their hostel (unless it's a user/student)
    if (currentUser.role === 'hostel_admin') {
      if (userToDelete.role === 'custodian') {
        // Check if custodian belongs to this hostel
        const custodianCheck = await pool.query(
          'SELECT id FROM custodians WHERE user_id = $1 AND hostel_id = $2',
          [userToDelete.id, currentUser.hostel_id]
        );
        if (custodianCheck.rows.length === 0) {
          return res.status(403).json({ 
            success: false, 
            message: 'This user does not belong to your hostel' 
          });
        }
      } else if (userToDelete.hostel_id && userToDelete.hostel_id !== currentUser.hostel_id) {
        return res.status(403).json({ 
          success: false, 
          message: 'This user does not belong to your hostel' 
        });
      }
    }

    // Prevent deleting super_admin
    if (userToDelete.role === 'super_admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot delete super admin account' 
      });
    }

    await client.query('BEGIN');

    // Delete from custodians table if exists (CASCADE should handle this, but being explicit)
    await client.query('DELETE FROM custodians WHERE user_id = $1', [userToDelete.id]);
    
    // Delete from users table (this will CASCADE delete related records)
    await client.query('DELETE FROM users WHERE id = $1', [userToDelete.id]);
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: `User ${userToDelete.name} (${email}) deleted successfully` 
    });
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Delete user by email error:', e);
    
    // Handle foreign key constraint errors
    if (e.code === '23503') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete user: user has associated records (payments, assignments, etc.)' 
      });
    }
    
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete custodian
router.delete('/:id', async (req: Request, res) => {
  const client = await pool.connect();
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { id } = req.params;

    // Ensure the custodian belongs to this hostel
    const check = await pool.query(
      `SELECT c.user_id FROM custodians c
       WHERE c.id = $1 AND c.hostel_id = COALESCE($2, c.hostel_id)`,
      [parseInt(id), currentUser.hostel_id || null]
    );
    if (!check.rowCount && currentUser.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const userId = check.rows[0]?.user_id;
    await client.query('BEGIN');
    await client.query('DELETE FROM custodians WHERE id = $1', [id]);
    if (userId) {
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await client.query('COMMIT');
    res.json({ success: true, message: 'Custodian deleted successfully' });
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('Delete custodian error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
});

const custodianResendLimiter = new SimpleRateLimiter(3, 60 * 60 * 1000);

// Resend credentials to a custodian (super_admin only or hostel_admin of same hostel)
router.post('/:id/resend-credentials', async (req: Request, res) => {
  const client = await pool.connect();
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { id } = req.params;

    // Fetch custodian with hostel name and ensure access
    const custodianRes = await pool.query(
      `SELECT c.id, c.user_id, c.hostel_id, u.email, u.name, h.name AS hostel_name
       FROM custodians c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN hostels h ON h.id = c.hostel_id
       WHERE c.id = $1`,
      [parseInt(id)]
    );
    if (!custodianRes.rowCount) return res.status(404).json({ success: false, message: 'Custodian not found' });
    const row = custodianRes.rows[0];

    if (currentUser.role !== 'super_admin' && (!currentUser.hostel_id || currentUser.hostel_id !== row.hostel_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    // Rate limit per (requester, custodianId, action)
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const rl = custodianResendLimiter.allow(['resend_custodian_credentials', currentUser.id, id, ip]);
    if (!rl.allowed) {
      return res.status(429).json({ success: false, message: `Too many requests. Try again in ${Math.ceil(rl.resetMs/1000)}s` });
    }

    const tempPassword = CredentialGenerator.generatePatternPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);

    await client.query('BEGIN');
    await client.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, row.user_id]);
    await client.query('COMMIT');

    // Email credentials
    try {
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
      const hostelName = row.hostel_name || 'Your Hostel';
      const html = EmailService.generateCustodianWelcomeEmail(
        row.name || 'Custodian',
        row.email,
        row.email,
        tempPassword,
        hostelName,
        loginUrl
      );
      await EmailService.sendEmail({ 
        to: row.email, 
        subject: `New Login Credentials - Custodian - ${hostelName} - LTS Portal`, 
        html 
      });
    } catch (e) {
      console.error('Email send error:', e);
    }

    // Audit success
    await pool.query(
      `INSERT INTO audit_logs (action, requester_user_id, target_user_id, target_hostel_id, status, message, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      ['resend_custodian_credentials', currentUser.id, row.user_id, row.hostel_id, 'success', 'Password rotated and email sent', ip, (req.headers['user-agent'] as string) || null]
    );

    // Return credentials in response so hostel admin can view/copy them
    res.json({ 
      success: true, 
      message: 'New credentials generated and sent successfully',
      data: {
        credentials: {
          username: row.email,
          password: tempPassword,
          loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
        },
        custodian: {
          id: row.id,
          user_id: row.user_id,
          email: row.email,
          name: row.name
        }
      }
    });
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('Resend custodian credentials error:', e);
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const decoded: any = token ? require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret') : null;
      const requesterId = decoded?.userId || null;
      const { id } = req.params;
      await pool.query(
        `INSERT INTO audit_logs (action, requester_user_id, target_user_id, target_hostel_id, status, message, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        ['resend_custodian_credentials', requesterId, null, null, 'failure', 'Internal server error', (req.headers['x-forwarded-for'] as string) || req.ip || '', (req.headers['user-agent'] as string) || null]
      );
    } catch {}
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// View/generate credentials for a custodian (hostel_admin or super_admin)
// Since passwords are hashed, this endpoint generates new credentials and returns them
router.get('/:id/view-credentials', async (req: Request, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { id } = req.params;
    const generateNew = req.query.generate !== 'false'; // Default: generate new credentials

    // Fetch custodian and ensure access
    const custodianRes = await pool.query(
      `SELECT c.id, c.user_id, c.hostel_id, u.email, u.name
       FROM custodians c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [parseInt(id)]
    );
    if (!custodianRes.rowCount) return res.status(404).json({ success: false, message: 'Custodian not found' });
    const row = custodianRes.rows[0];

    // Check permissions: super_admin or hostel_admin of same hostel
    if (currentUser.role !== 'super_admin' && (!currentUser.hostel_id || currentUser.hostel_id !== row.hostel_id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    if (!generateNew) {
      // Just return custodian info without generating new password
      return res.json({
        success: true,
        message: 'Custodian information retrieved. Passwords are hashed and cannot be retrieved.',
        data: {
          custodian: {
            id: row.id,
            user_id: row.user_id,
            email: row.email,
            name: row.name,
            username: row.email
          },
          note: 'Passwords are securely hashed and cannot be retrieved. Use ?generate=true or the resend-credentials endpoint to generate new credentials.'
        }
      });
    }

    // Generate new temporary password and update it
    const tempPassword = CredentialGenerator.generatePatternPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);

    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, row.user_id]);

    res.json({
      success: true,
      message: 'New credentials generated successfully',
      data: {
        credentials: {
          username: row.email,
          password: tempPassword,
          loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
        },
        custodian: {
          id: row.id,
          user_id: row.user_id,
          email: row.email,
          name: row.name
        }
      }
    });

  } catch (error: any) {
    console.error('View custodian credentials error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;




















