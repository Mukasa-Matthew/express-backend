import express from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { UserModel } from '../models/User';
import { EmailService } from '../services/emailService';
import fetch from 'node-fetch';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../config/database';
import SmsService from '../services/smsService';

const router = express.Router();

// Configure multer for profile picture uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/profile-pictures');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `profile-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed!'));
    }
  }
});

// Helper function to get user from token
function getToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

function verifyToken(token: string): any {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
  } catch {
    return null;
  }
}

async function verifyTurnstile(token: string | undefined, remoteip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (process.env.DISABLE_TURNSTILE === 'true') return true; // Explicitly disabled
  if (!secret) return true; // Skip if not configured
  if (!token) return false; // Token required if Turnstile is configured
  try {
    const form = new URLSearchParams();
    form.append('secret', secret);
    form.append('response', token);
    if (remoteip) form.append('remoteip', remoteip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    const data: any = await res.json();
    return !!data.success;
  } catch {
    return false;
  }
}

// Login endpoint (accepts email or username as identifier)
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, cf_turnstile_token } = req.body as any;
    if (!identifier || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

    // Turnstile check (if configured)
    // Only enforce Turnstile if it's explicitly configured and not disabled
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    const turnstileDisabled = process.env.DISABLE_TURNSTILE === 'true';
    if (turnstileSecret && !turnstileDisabled) {
      const ok = await verifyTurnstile(cf_turnstile_token, req.ip);
      if (!ok) return res.status(400).json({ success: false, message: 'Captcha verification failed' });
    }

    // Need to get user with password and password_is_temp field
    // Add retry logic for connection timeouts
    let userByEmail: any;
    let userByUsername: any;
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        userByEmail = await pool.query(
          'SELECT id, email, username, name, password, role, hostel_id, password_is_temp, profile_picture FROM users WHERE LOWER(email) = LOWER($1)',
          [identifier]
        );
        userByUsername = userByEmail.rows.length === 0 
          ? await pool.query(
              'SELECT id, email, username, name, password, role, hostel_id, password_is_temp, profile_picture FROM users WHERE LOWER(username) = LOWER($1)',
              [identifier]
            )
          : { rows: [] };
        break; // Success, exit retry loop
      } catch (dbError: any) {
        retryCount++;
        const isConnectionError = dbError.message?.includes('Connection terminated') || 
                                  dbError.message?.includes('timeout') ||
                                  dbError.code === 'ECONNRESET' ||
                                  dbError.code === 'ETIMEDOUT';
        
        if (isConnectionError && retryCount < maxRetries) {
          console.log(`[Login] Database connection error (attempt ${retryCount}/${maxRetries}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
          continue;
        }
        // If not a connection error or max retries reached, throw
        throw dbError;
      }
    }
    
    const userRow = userByEmail.rows[0] || userByUsername.rows[0];
    if (!userRow) {
      console.log(`[Login] User not found for identifier: ${identifier}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const user = {
      id: userRow.id,
      email: userRow.email,
      username: userRow.username,
      name: userRow.name,
      password: userRow.password,
      role: userRow.role,
      hostel_id: userRow.hostel_id,
      password_is_temp: userRow.password_is_temp || false,
      profile_picture: userRow.profile_picture || null,
    };

    if (!user.password) {
      console.error(`[Login] User ${user.id} (${user.email || user.username}) has no password set`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    console.log(`[Login] Attempting login for user: ${user.email || user.username} (ID: ${user.id})`);
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log(`[Login] Invalid password for user: ${user.email || user.username} (ID: ${user.id})`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    console.log(`[Login] Successful login for user: ${user.email || user.username} (ID: ${user.id})`);

    // For custodians, get hostel_id from custodians table if not in users table
    let hostelId = user.hostel_id || null;
    if (!hostelId && user.role === 'custodian') {
      const custodianResult = await pool.query('SELECT hostel_id FROM custodians WHERE user_id = $1', [user.id]);
      hostelId = custodianResult.rows[0]?.hostel_id || null;
    }

    let subscriptionWarningDays: number | null = null;

    if ((user.role === 'hostel_admin' || user.role === 'custodian') && hostelId) {
      const hostelStatusRes = await pool.query('SELECT status FROM hostels WHERE id = $1', [hostelId]);
      const hostelStatus = hostelStatusRes.rows[0]?.status || null;
      if (!hostelStatus) {
        return res.status(403).json({
          success: false,
          message: 'Hostel record not found. Please contact the Super Admin.',
          code: 'HOSTEL_NOT_FOUND',
        });
      }
      if (hostelStatus !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'This hostel account is currently disabled. Please contact the Super Admin for assistance.',
          code: 'HOSTEL_INACTIVE',
        });
      }

      // Fetch current or latest subscription for the user's hostel
      const subResult = await pool.query(
        `SELECT hs.id, hs.status, hs.end_date
         FROM hostels h
         LEFT JOIN hostel_subscriptions hs ON h.current_subscription_id = hs.id
         WHERE h.id = $1`,
        [hostelId]
      );

      let sub = subResult.rows[0];
      if (!sub) {
        // Fallback: latest subscription by end_date
        const fallback = await pool.query(
          `SELECT id, status, end_date
           FROM hostel_subscriptions
           WHERE hostel_id = $1
           ORDER BY end_date DESC
           LIMIT 1`,
          [hostelId]
        );
        sub = fallback.rows[0];
      }

      if (sub) {
        const endDate = sub.end_date ? new Date(sub.end_date) : null;
        const now = new Date();
        const msPerDay = 1000 * 60 * 60 * 24;
        const daysLeft = endDate ? Math.ceil((endDate.getTime() - now.getTime()) / msPerDay) : -1;

        // Block login if expired or status not active
        if (sub.status !== 'active' || !endDate || endDate < now) {
          return res.status(403).json({
            success: false,
            message: 'This hostel\'s subscription has expired. Please contact the Super Admin to renew your subscription.',
            code: 'SUBSCRIPTION_EXPIRED'
          });
        }

        // Warn if <= 30 days remain
        if (daysLeft <= 30) {
          subscriptionWarningDays = daysLeft;
        }
      } else {
        // No subscription found at all -> block login
        return res.status(403).json({
          success: false,
          message: 'This hostel has no active subscription. Please contact the Super Admin to subscribe.',
          code: 'SUBSCRIPTION_MISSING'
        });
      }
    }

    // For students (role='user'), check semester enrollment status
    if (user.role === 'user') {
      const now = new Date();
      
      // Check for active enrollment in current or upcoming semester
      const enrollmentCheck = await pool.query(
        `
        SELECT 
          se.id,
          se.semester_id,
          se.enrollment_status,
          s.id as semester_id,
          s.name as semester_name,
          s.start_date,
          s.end_date,
          s.status as semester_status,
          s.is_current,
          s.hostel_id,
          h.name as hostel_name
        FROM semester_enrollments se
        JOIN semesters s ON s.id = se.semester_id
        JOIN hostels h ON h.id = s.hostel_id
        WHERE se.user_id = $1
          AND se.enrollment_status = 'active'
          AND (s.status = 'active' OR s.status = 'upcoming')
          AND (s.is_current = true OR s.start_date >= $2)
        ORDER BY s.start_date DESC
        LIMIT 1
        `,
        [user.id, now]
      );

      // Check for active room reservation (rebooking for next semester)
      const reservationCheck = await pool.query(
        `
        SELECT 
          rr.id,
          rr.status,
          rr.reserved_for_semester_id,
          s.start_date,
          s.end_date,
          s.status as semester_status,
          h.id as hostel_id,
          h.name as hostel_name
        FROM room_reservations rr
        JOIN semesters s ON s.id = rr.reserved_for_semester_id
        JOIN rooms r ON r.id = rr.room_id
        JOIN hostels h ON h.id = r.hostel_id
        WHERE rr.user_id = $1
          AND rr.status IN ('active', 'confirmed')
          AND (s.status = 'active' OR s.status = 'upcoming')
        ORDER BY s.start_date DESC
        LIMIT 1
        `,
        [user.id]
      );

      const hasActiveEnrollment = enrollmentCheck.rows.length > 0;
      const hasActiveReservation = reservationCheck.rows.length > 0;

      if (!hasActiveEnrollment && !hasActiveReservation) {
        // Check if there's a past enrollment to provide helpful message
        const pastEnrollment = await pool.query(
          `
          SELECT 
            s.name as semester_name,
            s.end_date,
            h.name as hostel_name
          FROM semester_enrollments se
          JOIN semesters s ON s.id = se.semester_id
          JOIN hostels h ON h.id = s.hostel_id
          WHERE se.user_id = $1
            AND se.enrollment_status = 'active'
          ORDER BY s.end_date DESC
          LIMIT 1
          `,
          [user.id]
        );

        if (pastEnrollment.rows.length > 0) {
          const past = pastEnrollment.rows[0];
          const endDate = new Date(past.end_date);
          if (endDate < now) {
            return res.status(403).json({
              success: false,
              message: `Your enrollment for ${past.semester_name} at ${past.hostel_name} has ended. Please rebook your room for the next semester or contact your hostel administrator.`,
              code: 'SEMESTER_ENDED',
              requiresRebooking: true
            });
          }
        }

        return res.status(403).json({
          success: false,
          message: 'You do not have an active enrollment or reservation. Please contact your hostel administrator to register for the current semester.',
          code: 'NO_ACTIVE_ENROLLMENT'
        });
      }

      // Update hostel_id from active enrollment or reservation
      if (hasActiveEnrollment) {
        hostelId = enrollmentCheck.rows[0].hostel_id;
      } else if (hasActiveReservation) {
        hostelId = reservationCheck.rows[0].hostel_id;
      }
    }

    // Generate token (needed for both normal login and temporary password cases)
    const token = jwt.sign({ userId: user.id, role: user.role, hostel_id: hostelId || null }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '12h' });

    // Check if password is temporary - enforce password change on first login
    const passwordIsTemp = user.password_is_temp || false;
    if (passwordIsTemp) {
      // Return response with token so user can change password, but flag that password change is required
      return res.status(200).json({
        success: true,
        token, // Include token so user can authenticate and change password
        requiresPasswordChange: true,
        message: 'Please change your temporary password to continue',
        code: 'PASSWORD_CHANGE_REQUIRED',
        user: { id: user.id, email: user.email, name: user.name, role: user.role, hostel_id: hostelId || null, profile_picture: user.profile_picture },
      });
    }

    // Normal login response
    res.json({ success: true, token, user: { id: user.id, email: user.email, name: user.name, role: user.role, hostel_id: hostelId || null, profile_picture: user.profile_picture },
      warning: subscriptionWarningDays !== null ? { type: 'subscription_expiring', daysLeft: subscriptionWarningDays } : undefined
    });
  } catch (e) {
    console.error('Login error:', e);
    console.error('Login error details:', JSON.stringify(e, null, 2));
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});
// Change username
router.post('/change-username', async (req, res) => {
  try {
    const { newUsername } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    if (!newUsername || newUsername.length < 3 || newUsername.length > 30) {
      return res.status(400).json({ success: false, message: 'Username must be 3-30 characters' });
    }

    // Verify token and get user
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as any;

    // Check uniqueness (case-insensitive)
    const existing = await UserModel.findByUsername(newUsername);
    if (existing && existing.id !== decoded.userId) {
      return res.status(400).json({ success: false, message: 'Username already taken' });
    }

    const updated = await UserModel.update(decoded.userId, { username: newUsername });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Username changed successfully', data: { username: updated.username } });
  } catch (error) {
    console.error('Change username error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get current user endpoint
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided' 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as any;
    
    // Get user data
    const user = await UserModel.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // For custodians, get hostel_id from custodians table if not in users table
    let hostelId = user.hostel_id || null;
    if (!hostelId && user.role === 'custodian') {
      const custodianResult = await pool.query('SELECT hostel_id FROM custodians WHERE user_id = $1', [user.id]);
      hostelId = custodianResult.rows[0]?.hostel_id || null;
    }

    const responseUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      hostel_id: hostelId,
      profile_picture: user.profile_picture
    };
    console.log('/auth/me - Returning user:', responseUser);
    res.json({
      success: true,
      data: {
        user: responseUser
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
});

// Logout endpoint (client-side token removal)
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

// Change password
router.post('/change-password', async (req, res) => {
  try {
    // Accept both camelCase and snake_case from various clients
    const currentPassword = req.body.currentPassword ?? req.body.current_password;
    const newPassword = req.body.newPassword ?? req.body.new_password;
    const isTemporaryPassword = req.body.isTemporaryPassword ?? req.body.is_temporary_password;
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    // Verify token and get user
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const user = await UserModel.findByIdWithPassword(decoded.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user has temporary password
    const userWithTempCheck = await pool.query(
      'SELECT password_is_temp FROM users WHERE id = $1',
      [decoded.userId]
    );
    const hasTemporaryPassword = userWithTempCheck.rows[0]?.password_is_temp || false;

    // If changing from temporary password, skip current password verification
    if (!hasTemporaryPassword && !isTemporaryPassword) {
      // Verify current password for permanent passwords
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is required'
        });
      }

      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    console.log(`[Change Password] Updating password for user ID: ${decoded.userId}`);

    // Update password using the dedicated method that properly handles password updates
    await UserModel.updatePassword(decoded.userId, hashedNewPassword);
    console.log(`[Change Password] Password update completed for user ID: ${decoded.userId}`);
    
    // Verify the password was updated by fetching the user again
    const updatedUser = await UserModel.findByIdWithPassword(decoded.userId);
    if (!updatedUser) {
      console.error('[Change Password] Failed to verify password update - user not found:', decoded.userId);
      return res.status(500).json({
        success: false,
        message: 'Password update verification failed'
      });
    }
    
    // Verify the new password matches (sanity check)
    const verifyNewPassword = await bcrypt.compare(newPassword, updatedUser.password);
    if (!verifyNewPassword) {
      console.error('[Change Password] Password update verification failed - new password does not match hash');
      console.error('[Change Password] User email:', user.email);
      return res.status(500).json({
        success: false,
        message: 'Password update verification failed'
      });
    }
    
    console.log(`[Change Password] Password successfully updated and verified for user: ${user.email} (ID: ${decoded.userId})`);

    // Mark password as permanent and clear any stored temporary credentials
    await pool.query('UPDATE users SET password_is_temp = FALSE WHERE id = $1', [decoded.userId]);
    // Delete stored temporary password so custodians can no longer view it
    await pool.query('DELETE FROM temporary_password_storage WHERE user_id = $1', [decoded.userId]);
    
    // Log password change
    const { AuditLogger } = require('../utils/auditLogger');
    await AuditLogger.logPasswordChange(
      decoded.userId,
      req.ip,
      req.get('user-agent') || undefined
    );
    if (user.role === 'custodian') {
      try {
        await pool.query(`ALTER TABLE custodians ADD COLUMN IF NOT EXISTS original_username TEXT`);
        await pool.query(`ALTER TABLE custodians ADD COLUMN IF NOT EXISTS original_password TEXT`);
        await pool.query(`ALTER TABLE custodians ADD COLUMN IF NOT EXISTS credentials_invalidated BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE custodians ADD COLUMN IF NOT EXISTS credentials_invalidated_at TIMESTAMPTZ`);
      } catch (alterErr) {
        console.warn('Failed to ensure custodian credential columns during password change:', alterErr);
      }

      await pool.query(
        `UPDATE custodians
            SET original_password = NULL,
                credentials_invalidated = TRUE,
                credentials_invalidated_at = NOW()
         WHERE user_id = $1`,
        [decoded.userId]
      );
    }

    // Send confirmation email asynchronously (don't block response)
    const emailHtml = EmailService.generatePasswordChangeConfirmationEmail(
      user.name,
      user.email,
      new Date().toLocaleString()
    );
    EmailService.sendEmailAsync({
      to: user.email,
      subject: 'Password Changed - LTS Portal',
      html: emailHtml
    });

    res.json({
      success: true,
      message: 'Password changed successfully. A confirmation email has been sent to your registered email address.'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Upload profile picture endpoint
router.post('/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Update user profile picture path in database
    const profilePicturePath = `/uploads/profile-pictures/${req.file.filename}`;
    await UserModel.update(decoded.userId, { profile_picture: profilePicturePath });

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      profilePicture: profilePicturePath
    });
  } catch (error) {
    console.error('Profile picture upload error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload profile picture' });
  }
});

// Get user profile endpoint
router.get('/profile', async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const user = await UserModel.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // For custodians, get hostel_id from custodians table if not in users table
    let hostelId = user.hostel_id || null;
    if (!hostelId && user.role === 'custodian') {
      const custodianResult = await pool.query('SELECT hostel_id FROM custodians WHERE user_id = $1', [user.id]);
      hostelId = custodianResult.rows[0]?.hostel_id || null;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        hostel_id: hostelId,
        profile_picture: user.profile_picture
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

// Update user profile endpoint
router.put('/profile', async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const { name, username } = req.body;
    
    // Only super admin can change email
    const updateData: any = { name };
    if (username !== undefined) {
      updateData.username = username;
    }

    // If user is not super admin, don't allow email changes
    if (decoded.role !== 'super_admin' && req.body.email) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only super admin can change email address' 
      });
    }

    // If user is super admin and email is provided, allow it
    if (decoded.role === 'super_admin' && req.body.email) {
      updateData.email = req.body.email;
    }

    const updatedUser = await UserModel.update(decoded.userId, updateData);
    
    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        hostel_id: updatedUser.hostel_id,
        profile_picture: updatedUser.profile_picture
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

// Delete profile picture endpoint
router.delete('/profile-picture', async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const user = await UserModel.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Delete the file if it exists
    if (user.profile_picture) {
      const filePath = path.join(__dirname, '../../', user.profile_picture);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Update database to remove profile picture
    await UserModel.update(decoded.userId, { profile_picture: null });

    res.json({
      success: true,
      message: 'Profile picture deleted successfully'
    });
  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete profile picture' });
  }
});

// Helper function to generate OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Forgot password - request OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Find user by email
    const user = await UserModel.findByEmail(email);
    
    // Always return success for security reasons (don't reveal if email exists)
    if (!user) {
      return res.json({ 
        success: true, 
        message: 'If the email exists, an OTP has been sent' 
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

    // Delete any existing tokens for this user
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

    // Create new token with OTP in payload
    const token = jwt.sign({ 
      userId: user.id, 
      email: user.email,
      otp: otp // Store OTP in token payload
    }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '15m' });
    
    // Check if otp column exists in password_reset_tokens table
    const hasOtpColumn = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'password_reset_tokens' AND column_name = 'otp'
    `);
    
    if (hasOtpColumn.rows.length > 0) {
      // Table has otp column, use it
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, otp, expires_at) VALUES ($1, $2, $3, $4)',
      [user.id, token, otp, expiresAt]
    );
    } else {
      // Table doesn't have otp column, store without it (OTP is in token payload)
      await pool.query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, token, expiresAt]
      );
    }

    // Launch OTP notifications without blocking the response
    const notificationTasks: Promise<unknown>[] = [];

    notificationTasks.push(
      (async () => {
        try {
          const emailHtml = EmailService.generatePasswordResetOTPEmail(
            user.name,
            otp
          );

          await EmailService.sendEmail({
            to: user.email,
            subject: 'Password Reset OTP - LTS Portal',
            html: emailHtml,
          });
        } catch (emailError) {
          console.error('Error sending password reset OTP email:', emailError);
        }
      })()
    );

    notificationTasks.push(
      SmsService.sendPasswordResetOtp(user, otp).catch((err) => {
        console.error('Error sending password reset OTP SMS:', err);
      })
    );

    void Promise.allSettled(notificationTasks);

    res.json({ 
      success: true, 
      message: 'If the email exists, an OTP has been sent',
      token: token // Send token to client
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { token, otp } = req.body;

    if (!token || !otp) {
      return res.status(400).json({ success: false, message: 'Token and OTP are required' });
    }

    // Find token in database
    const result = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    const resetToken = result.rows[0];

    // Verify OTP - check both token payload and database column (if exists)
    let isValidOtp = false;
    
    // First, try to verify from JWT token payload
    try {
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
      if (decoded.otp === otp) {
        isValidOtp = true;
      }
    } catch (jwtError) {
      // Token invalid or expired
    }
    
    // If OTP column exists in database, also check there
    if (!isValidOtp && resetToken.otp) {
      if (resetToken.otp === otp) {
        isValidOtp = true;
      }
    }
    
    if (!isValidOtp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    res.json({ 
      success: true, 
      message: 'OTP verified successfully',
      verifiedToken: token
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Reset password with OTP
router.post('/reset-password', async (req, res) => {
  try {
    const { verifiedToken, otp, newPassword } = req.body;

    if (!verifiedToken || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token, OTP, and new password are required' });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long' });
    }

    // Find and verify token
    const result = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [verifiedToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    const resetToken = result.rows[0];

    // Verify OTP - check both token payload and database column (if exists)
    let isValidOtp = false;
    
    // First, try to verify from JWT token payload
    try {
      const decoded: any = jwt.verify(verifiedToken, process.env.JWT_SECRET || 'fallback_secret');
      if (decoded.otp === otp) {
        isValidOtp = true;
      }
    } catch (jwtError) {
      // Token invalid or expired
    }
    
    // If OTP column exists in database, also check there
    if (!isValidOtp && resetToken.otp) {
      if (resetToken.otp === otp) {
        isValidOtp = true;
      }
    }
    
    if (!isValidOtp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await UserModel.updatePassword(resetToken.user_id, hashedPassword);

    // Mark token as used
    await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [resetToken.id]);

    // Get user to send confirmation email
    const user = await UserModel.findById(resetToken.user_id);

    // Send confirmation email
    try {
      const emailHtml = EmailService.generatePasswordResetConfirmationEmail(user!.name, new Date().toLocaleString());
      
      await EmailService.sendEmail({
        to: user!.email,
        subject: 'Password Reset Successfully - LTS Portal',
        html: emailHtml
      });
    } catch (emailError) {
      console.error('Error sending password reset confirmation email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({ 
      success: true, 
      message: 'Password reset successfully. Please login with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
