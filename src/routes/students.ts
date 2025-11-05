import express, { Request } from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';
import bcrypt from 'bcryptjs';
import { CredentialGenerator } from '../utils/credentialGenerator';
import { EmailService } from '../services/emailService';
import { requireActiveSemester } from '../utils/semesterMiddleware';
import { SemesterEnrollmentModel } from '../models/Semester';

const router = express.Router();

async function getHostelIdForUser(userId: number, role: string): Promise<number | null> {
  if (role === 'hostel_admin') {
    const u = await UserModel.findById(userId);
    return u?.hostel_id || null;
  }
  if (role === 'custodian') {
    const res = await pool.query('SELECT hostel_id FROM custodians WHERE user_id = $1', [userId]);
    const fromCustodians = res.rows[0]?.hostel_id || null;
    if (fromCustodians) return fromCustodians;
    const u = await UserModel.findById(userId);
    return u?.hostel_id || null;
  }
  return null;
}

// List students for current hostel (custodian or hostel_admin)
router.get('/', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    // Pagination
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limitRaw = Math.max(1, parseInt((req.query.limit as string) || '20', 10));
    const limit = Math.min(100, limitRaw);
    const offset = (page - 1) * limit;

    // Optional semester filtering
    const semesterId = req.query.semester_id ? parseInt(req.query.semester_id as string) : null;
    
    let query, params;
    if (semesterId) {
      // If filtering by semester, join with semester_enrollments
      query = `
        SELECT DISTINCT u.id, u.email, u.name, u.role, u.created_at 
        FROM users u
        INNER JOIN semester_enrollments se ON se.user_id = u.id
        WHERE u.hostel_id = $1 AND u.role = 'user' AND se.semester_id = $2
        ORDER BY u.created_at DESC
        LIMIT $3 OFFSET $4
      `;
      params = [hostelId, semesterId, limit, offset];
    } else {
      query = `
        SELECT id, email, name, role, created_at FROM users 
        WHERE hostel_id = $1 AND role = 'user' ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
      params = [hostelId, limit, offset];
    }

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows, page, limit });
  } catch (e) {
    console.error('List students error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Create student for current hostel
router.post('/', async (req: Request, res) => {
  const client = await pool.connect();
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    // Check for active semester before allowing student creation
    const semesterCheck = await requireActiveSemester(currentUser.id, hostelId);
    if (!semesterCheck.success || !semesterCheck.semesterId) {
      return res.status(400).json({ success: false, message: semesterCheck.message });
    }

    const semesterId = semesterCheck.semesterId;

    const { 
      name, email,
      gender, date_of_birth, access_number,
      phone, whatsapp, emergency_contact,
      room_id, initial_payment_amount, currency
    } = req.body as any;
    if (!name || !email) return res.status(400).json({ success: false, message: 'Name and email are required' });
    if (!room_id) return res.status(400).json({ success: false, message: 'Room assignment is required' });
    if (!initial_payment_amount || parseFloat(initial_payment_amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Booking fee is required and must be greater than 0' });
    }

    // Check if user already exists by email
    await client.query('BEGIN');
    const existingRes = await client.query('SELECT * FROM users WHERE email = $1', [email]);
    let createdUser = existingRes.rows[0];
    if (!createdUser) {
      // Create new internal student user with random password (no credentials emailed)
      const randomPassword = CredentialGenerator.generatePatternPassword();
      const hashed = await bcrypt.hash(randomPassword, 10);
      const userRes = await client.query(
        `INSERT INTO users (email, name, password, role, hostel_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'user', $4, NOW(), NOW()) RETURNING id, email, name` ,
        [email, name, hashed, hostelId]
      );
      createdUser = userRes.rows[0];
    } else {
      // If existing user is a student, ensure they belong to this hostel; otherwise reject
      if (createdUser.role !== 'user') {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Email already exists for another account type' });
      }
      if (!createdUser.hostel_id) {
        await client.query('UPDATE users SET hostel_id = $1 WHERE id = $2', [hostelId, createdUser.id]);
      } else if (createdUser.hostel_id !== hostelId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Email already registered under a different hostel' });
      }
      // Optionally update name
      if (name && name !== createdUser.name) {
        await client.query('UPDATE users SET name = $1 WHERE id = $2', [name, createdUser.id]);
      }
    }

    // Create or update profile
    const existingProfile = await client.query('SELECT user_id FROM student_profiles WHERE user_id = $1', [createdUser.id]);
    if (existingProfile.rowCount === 0) {
      await client.query(
        `INSERT INTO student_profiles (user_id, gender, date_of_birth, access_number, phone, whatsapp, emergency_contact)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [createdUser.id, gender || null, date_of_birth || null, access_number || null, phone || null, whatsapp || null, emergency_contact || null]
      );
    } else {
      await client.query(
        `UPDATE student_profiles 
         SET gender = COALESCE($2, gender), date_of_birth = COALESCE($3, date_of_birth), 
             access_number = COALESCE($4, access_number), phone = COALESCE($5, phone),
             whatsapp = COALESCE($6, whatsapp), emergency_contact = COALESCE($7, emergency_contact),
             updated_at = NOW()
         WHERE user_id = $1`,
        [createdUser.id, gender || null, date_of_birth || null, access_number || null, phone || null, whatsapp || null, emergency_contact || null]
      );
    }

    // Store room metadata for email and enrollments
    let roomMeta: { room_number: string | null; price: number | null } = { room_number: null, price: null };
    
    // Assign room if provided
    if (room_id) {
      const roomCheck = await client.query(`
        SELECT r.id, r.price, r.room_number, r.capacity, r.status,
               COALESCE(COUNT(sra.id), 0) as current_occupants
        FROM rooms r
        LEFT JOIN student_room_assignments sra ON r.id = sra.room_id AND sra.status = 'active'
        WHERE r.id = $1 AND r.hostel_id = $2
        GROUP BY r.id
      `, [room_id, hostelId]);
      
      if (!roomCheck.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid room' });
      }
      
      const room = roomCheck.rows[0];
      const capacity = room.capacity || 1;
      const currentOccupants = parseInt(room.current_occupants) || 0;
      
      // Check if room has available capacity
      if (currentOccupants >= capacity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'This room is already at full capacity' });
      }
      
      roomMeta = { room_number: room.room_number, price: parseFloat(room.price) };
      
      // Check if student already has an active assignment for this semester
      const existingAssignment = await client.query(
        `SELECT id FROM student_room_assignments WHERE user_id = $1 AND semester_id = $2 AND status = 'active'`,
        [createdUser.id, semesterId]
      );
      
      if (existingAssignment.rowCount === 0) {
        // Create new room assignment
        await client.query(
          `INSERT INTO student_room_assignments (user_id, room_id, semester_id, status) VALUES ($1, $2, $3, 'active')`,
          [createdUser.id, room_id, semesterId]
        );
      } else {
        // Update existing assignment
        await client.query(
          `UPDATE student_room_assignments SET room_id = $1, updated_at = NOW() WHERE id = $2`,
          [room_id, existingAssignment.rows[0].id]
        );
      }
      
      // Mark room as occupied only if it's single occupancy (capacity = 1)
      if (room.status === 'available' && capacity === 1) {
        await client.query("UPDATE rooms SET status = 'occupied', updated_at = NOW() WHERE id = $1", [room_id]);
      }
    }

    // Create semester enrollment for this student
    await client.query(
      `INSERT INTO semester_enrollments (semester_id, user_id, room_id, enrollment_status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (semester_id, user_id) 
       DO UPDATE SET enrollment_status = 'active', updated_at = NOW()
       RETURNING *`,
      [semesterId, createdUser.id, room_id || null]
    );

    // Record initial payment if provided
    let initialPayment = 0;
    if (initial_payment_amount) {
      initialPayment = parseFloat(initial_payment_amount);
      await client.query(
        `INSERT INTO payments (user_id, hostel_id, semester_id, amount, currency, purpose) VALUES ($1, $2, $3, $4, $5, 'booking')`,
        [createdUser.id, hostelId, semesterId, initialPayment, currency || 'UGX']
      );
    }

    await client.query('COMMIT');

    // ALWAYS send a booking confirmation email with all details
    try {
      const totalPaid = initialPayment;
      const balanceAfter = roomMeta.price != null ? Math.max(0, roomMeta.price - totalPaid) : null;
      const hostelMeta = await pool.query('SELECT name FROM hostels WHERE id = $1', [hostelId]);
      const hostelName = hostelMeta.rows[0]?.name || undefined;
      
      // Send booking confirmation receipt
      const html = EmailService.generatePaymentReceiptEmail(
        name,
        email,
        initialPayment,
        currency || 'UGX',
        balanceAfter,
        roomMeta.room_number,
        null,
        new Date().toLocaleString(),
        hostelName,
        currentUser.name,
        'Registered by',
        access_number || null,
        roomMeta.price
      );
      await EmailService.sendEmail({ to: email, subject: `Booking Confirmation - ${hostelName || 'Hostel'}`, html });
      
      // If fully paid at registration, also send thank you & welcome email
      if (balanceAfter !== null && balanceAfter === 0 && initialPayment > 0) {
        const thankYouHtml = EmailService.generateThankYouWelcomeEmail(
          name,
          email,
          hostelName || 'Our Hostel',
          roomMeta.room_number,
          access_number || null,
          initialPayment,
          currency || 'UGX',
          totalPaid,
          roomMeta.price
        );
        await EmailService.sendEmail({ 
          to: email, 
          subject: `Thank You & Welcome to ${hostelName}! - All Balance Paid`, 
          html: thankYouHtml 
        });
      }
    } catch (e) {
      console.warn('Booking confirmation email failed:', e);
    }

    res.status(201).json({ success: true, message: 'Student registered successfully' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Create student error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get single student with profile (for editing)
router.get('/:id', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const { id } = req.params;
    const student = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.created_at,
              sp.gender, sp.date_of_birth, sp.access_number, sp.phone, sp.whatsapp, sp.emergency_contact
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1 AND u.hostel_id = $2 AND u.role = 'user'`,
      [id, hostelId]
    );
    
    if (!student.rows[0]) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const result = student.rows[0];
    res.json({
      success: true,
      data: {
        id: result.id,
        name: result.name,
        email: result.email,
        role: result.role,
        created_at: result.created_at,
        profile: {
          gender: result.gender,
          date_of_birth: result.date_of_birth,
          access_number: result.access_number,
          phone: result.phone,
          whatsapp: result.whatsapp,
          emergency_contact: result.emergency_contact
        }
      }
    });
  } catch (e) {
    console.error('Get student error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Update student (custodian/hostel_admin) - allows updating profile info
router.put('/:id', async (req: Request, res) => {
  const client = await pool.connect();
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const { id } = req.params;
    const { 
      name, email,
      gender, date_of_birth, access_number,
      phone, whatsapp, emergency_contact
    } = req.body as any;

    if (!name || !email) return res.status(400).json({ success: false, message: 'Name and email are required' });

    // Verify the student belongs to this hostel
    const student = await pool.query("SELECT id FROM users WHERE id = $1 AND hostel_id = $2 AND role = 'user'", [id, hostelId]);
    if (!student.rowCount) return res.status(404).json({ success: false, message: 'Student not found' });

    await client.query('BEGIN');

    // Check if email is already taken by another user
    if (email) {
      const emailCheck = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
      if (emailCheck.rowCount && emailCheck.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Email already in use by another student' });
      }
    }

    // Update user info
    if (name || email) {
      await client.query(
        'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), updated_at = NOW() WHERE id = $3',
        [name || null, email || null, id]
      );
    }

    // Update or create profile
    const existingProfile = await client.query('SELECT user_id FROM student_profiles WHERE user_id = $1', [id]);
    if (existingProfile.rowCount === 0) {
      await client.query(
        `INSERT INTO student_profiles (user_id, gender, date_of_birth, access_number, phone, whatsapp, emergency_contact)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, gender || null, date_of_birth || null, access_number || null, phone || null, whatsapp || null, emergency_contact || null]
      );
    } else {
      await client.query(
        `UPDATE student_profiles 
         SET gender = COALESCE($2, gender), date_of_birth = COALESCE($3, date_of_birth), 
             access_number = COALESCE($4, access_number), phone = COALESCE($5, phone),
             whatsapp = COALESCE($6, whatsapp), emergency_contact = COALESCE($7, emergency_contact),
             updated_at = NOW()
         WHERE user_id = $1`,
        [id, gender || null, date_of_birth || null, access_number || null, phone || null, whatsapp || null, emergency_contact || null]
      );
    }

    await client.query('COMMIT');

    res.json({ success: true, message: 'Student updated successfully' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Update student error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete student (custodian/hostel_admin) from their hostel
router.delete('/:id', async (req: Request, res) => {
  const client = await pool.connect();
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const hostelId = await (async () => {
      if (currentUser.role === 'hostel_admin') return currentUser.hostel_id || null;
      if (currentUser.role === 'custodian') {
        const r = await pool.query('SELECT hostel_id FROM custodians WHERE user_id = $1', [currentUser.id]);
        return r.rows[0]?.hostel_id || null;
      }
      return null;
    })();

    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const { id } = req.params;

    // Verify the student belongs to this hostel
    const s = await pool.query("SELECT id FROM users WHERE id = $1 AND hostel_id = $2 AND role = 'user'", [id, hostelId]);
    if (!s.rowCount) return res.status(404).json({ success: false, message: 'Student not found' });

    await client.query('BEGIN');
    // End any active room assignment
    await client.query("UPDATE student_room_assignments SET status = 'ended', ended_at = NOW() WHERE user_id = $1 AND status = 'active'", [id]);
    // Delete payments (optional): keep for audit; so we won't delete
    // Finally delete user
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await client.query('COMMIT');

    res.json({ success: true, message: 'Student deleted' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Delete student error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Send notification email to one student or all students in current hostel
router.post('/notify', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try { decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret'); } catch { return res.status(401).json({ success: false, message: 'Invalid token' }); }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser || (currentUser.role !== 'hostel_admin' && currentUser.role !== 'custodian')) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const { user_id, subject, message, semester_id } = req.body as any;
    if (!subject || !message) return res.status(400).json({ success: false, message: 'subject and message are required' });

    let recipients: Array<{ id: number; name: string; email: string }>; 
    if (user_id) {
      // Single student notification
      let query = "SELECT id, name, email FROM users WHERE id = $1 AND hostel_id = $2 AND role = 'user'";
      const params: any[] = [user_id, hostelId];
      
      // If semester_id is provided, filter by active semester enrollment
      if (semester_id) {
        query += ` AND EXISTS (
          SELECT 1 FROM semester_enrollments se 
          WHERE se.user_id = users.id 
          AND se.semester_id = $3 
          AND se.enrollment_status = 'active'
        )`;
        params.push(semester_id);
      }
      
      const r = await pool.query(query, params);
      recipients = r.rows;
    } else {
      // Broadcast notification - all students in hostel
      let query = "SELECT DISTINCT u.id, u.name, u.email FROM users u WHERE u.hostel_id = $1 AND u.role = 'user'";
      const params: any[] = [hostelId];
      
      // If semester_id is provided, filter by active semester enrollment
      if (semester_id) {
        query += ` AND EXISTS (
          SELECT 1 FROM semester_enrollments se 
          WHERE se.user_id = u.id 
          AND se.semester_id = $2 
          AND se.enrollment_status = 'active'
        )`;
        params.push(semester_id);
      }
      
      const r = await pool.query(query, params);
      recipients = r.rows;
    }

    const hostelMeta = await pool.query('SELECT name FROM hostels WHERE id = $1', [hostelId]);
    const hostelName = hostelMeta.rows[0]?.name || 'Your Hostel';
    let sent = 0;
    for (const rec of recipients) {
      try {
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #334155;">
            <div style="background: #4f46e5; color: #fff; padding: 16px 20px; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0; font-size: 18px;">${hostelName}</h2>
              <div style="opacity: 0.95; font-size: 13px;">Important notification</div>
            </div>
            <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
              <p>Dear ${rec.name || 'Student'},</p>
              <p>${message}</p>
              <p style="margin-top: 16px; font-size: 12px; color: #64748b;">This message was sent by ${hostelName}. Please do not reply to this email.</p>
            </div>
          </div>`;
        await EmailService.sendEmail({ to: rec.email, subject: `[${hostelName}] ${subject}`, html });
        sent++;
      } catch (e) {
        // log and continue
        console.error('Notify email failed for', rec.email, e);
      }
    }

    return res.json({ success: true, data: { requested: recipients.length, sent } });
  } catch (e) {
    console.error('Notify students error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;















