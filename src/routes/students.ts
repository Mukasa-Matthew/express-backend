import express, { Request } from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';
import bcrypt from 'bcryptjs';
import { CredentialGenerator } from '../utils/credentialGenerator';
import { EmailService } from '../services/emailService';
import { requireActiveSemester } from '../utils/semesterMiddleware';
import { SemesterEnrollmentModel } from '../models/Semester';

const router = express.Router();

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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

    // Check payment table structure to determine column name
    const paymentColumnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'payments'
    `);
    const paymentColumns = paymentColumnsRes.rows.map((r: any) => r.column_name);
    const paymentUserIdColumn = paymentColumns.includes('user_id')
      ? 'user_id'
      : paymentColumns.includes('student_id')
      ? 'student_id'
      : 'user_id';

    // Check if student_profiles table exists
    const studentProfilesCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'student_profiles'
      ) as exists
    `);
    const hasStudentProfiles = studentProfilesCheck.rows[0]?.exists || false;

    // Check what column student_room_assignments uses (student_id or user_id)
    const sraColumnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'student_room_assignments'
        AND column_name IN ('user_id', 'student_id')
    `);
    const sraUserIdColumn = sraColumnCheck.rows.find((r: any) => r.column_name === 'user_id') 
      ? 'user_id' 
      : sraColumnCheck.rows.find((r: any) => r.column_name === 'student_id')
      ? 'student_id'
      : 'user_id'; // fallback

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    // Optional semester filtering
    const semesterId = req.query.semester_id ? parseInt(req.query.semester_id as string) : null;
    
    // Only show students who are fully registered:
    // 1. Have a semester enrollment (balance can be NULL, 0, or any value) AND at least one payment
    // OR
    // 2. Have at least one payment recorded (from either payments or public_booking_payments tables)
    // Build query with proper column name substitution
    const paymentCol = paymentUserIdColumn;
    
    // Build student profile columns - use actual columns if table exists, otherwise NULL
    const studentProfileSelect = hasStudentProfiles
      ? 'sp.gender, sp.date_of_birth, sp.access_number, sp.phone, sp.whatsapp, sp.emergency_contact,'
      : 'NULL::text as gender, NULL::date as date_of_birth, NULL::text as access_number, NULL::text as phone, NULL::text as whatsapp, NULL::text as emergency_contact,';
    
    const studentProfileJoin = hasStudentProfiles
      ? 'LEFT JOIN student_profiles sp ON sp.user_id = u.id'
      : '';
    
    let query = `
      SELECT DISTINCT u.id, u.email, u.name, u.role, u.created_at,
             ${studentProfileSelect}
             se.total_amount, se.amount_paid, se.balance,
             (
               SELECT COUNT(*) 
               FROM payments p 
               WHERE p.` + paymentCol + ` = u.id 
               AND (se.id IS NULL OR p.semester_id = se.semester_id OR p.semester_id IS NULL)
             ) + (
               SELECT COUNT(*) 
               FROM public_booking_payments pbp
               INNER JOIN public_hostel_bookings phb ON phb.id = pbp.booking_id
               WHERE phb.student_email = u.email
               AND (se.id IS NULL OR phb.semester_id = se.semester_id OR phb.semester_id IS NULL)
               AND pbp.status = 'completed'
             ) as payment_count,
             (SELECT room_number FROM rooms r WHERE r.id = (SELECT room_id FROM student_room_assignments sra WHERE sra.${sraUserIdColumn} = u.id AND sra.status = 'active' LIMIT 1)) as room_number
      FROM users u
      ${studentProfileJoin}
      LEFT JOIN semester_enrollments se ON se.user_id = u.id
      WHERE u.hostel_id = $1 AND u.role = 'user'
        AND (
          -- Has payment in payments table
          EXISTS (
            SELECT 1 FROM payments p 
            WHERE p.` + paymentCol + ` = u.id
          )
          -- OR has payment in public_booking_payments table
          OR EXISTS (
            SELECT 1 FROM public_booking_payments pbp
            INNER JOIN public_hostel_bookings phb ON phb.id = pbp.booking_id
            WHERE phb.student_email = u.email
            AND phb.hostel_id = $1
            AND pbp.status = 'completed'
          )
        )
        -- If they have an enrollment, ensure it has balance (or allow NULL/0)
        AND (se.id IS NULL OR se.balance IS NOT NULL OR se.balance = 0)
    `;
    const params: any[] = [hostelId];

    if (semesterId) {
      // If filtering by semester, include students linked by enrollment OR payments OR online bookings
      const semesterParamIndex = params.length + 1;
      query += ` AND (
        se.semester_id = $${semesterParamIndex}
        OR EXISTS (
          SELECT 1 FROM payments p
          WHERE p.${paymentCol} = u.id
          AND p.semester_id = $${semesterParamIndex}
        )
        OR EXISTS (
          SELECT 1 FROM public_hostel_bookings b
          WHERE b.hostel_id = $1
            AND b.semester_id = $${semesterParamIndex}
            AND b.student_email IS NOT NULL
            AND LOWER(b.student_email) = LOWER(u.email)
        )
      )`;
      params.push(semesterId);
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    // Debug: Log the query to see what we're searching for
    console.log('Students query:', query.replace(/\s+/g, ' '));
    console.log('Query params:', params);

    const students = await pool.query(query, params);
    
    // Debug: Log results
    console.log(`Found ${students.rows.length} students`);

    // Get total count - only count registered students (with payment, enrollment optional)
    let countQuery = `
      SELECT COUNT(DISTINCT u.id)
      FROM users u
      LEFT JOIN semester_enrollments se ON se.user_id = u.id
      WHERE u.hostel_id = $1 AND u.role = $2
        AND (
          EXISTS (
            SELECT 1 FROM payments p 
            WHERE p.` + paymentCol + ` = u.id
          )
          OR EXISTS (
            SELECT 1 FROM public_booking_payments pbp
            INNER JOIN public_hostel_bookings phb ON phb.id = pbp.booking_id
            WHERE phb.student_email = u.email
            AND phb.hostel_id = $1
            AND pbp.status = 'completed'
          )
        )
        AND (se.id IS NULL OR se.balance IS NOT NULL OR se.balance = 0)
    `;
    const countParams: any[] = [hostelId, 'user'];
    if (semesterId) {
      countQuery += ` AND se.semester_id = $3`;
      countParams.push(semesterId);
    }
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: students.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (e) {
    console.error('List students error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Semester-level enrollment summary for current hostel
router.get('/summary/semesters', async (req, res) => {
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

    const attempt = async () => SemesterEnrollmentModel.getSemesterSummary(hostelId);

    try {
      const summary = await attempt();
      return res.json({ success: true, data: summary });
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      const isTransient =
        msg.includes('Connection terminated') ||
        msg.includes('timeout') ||
        msg.includes('ECONNRESET') ||
        msg.includes('terminat');

      if (isTransient) {
        console.warn('Semester summary transient error, retrying once...:', msg);
        await sleep(250);
        try {
          const summary = await attempt();
          return res.json({ success: true, data: summary });
        } catch (e2: any) {
          console.error('Semester summary retry failed:', e2?.message || e2);
          // Graceful fallback to avoid 500 on transient DB issues
          return res.json({ success: true, data: [] });
        }
      }

      // Non-transient error
      console.error('Semester summary error:', msg);
      return res.status(500).json({ success: false, message: 'Failed to load semester summary' });
    }
  } catch (e) {
    console.error('Semester summary error:', e);
    res.status(500).json({ success: false, message: 'Failed to load semester summary' });
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

    // Only custodians can create students (hostel_admin should not create students)
    if (currentUser.role !== 'custodian') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only custodians can register students. Hostel administrators can view students and reports.' 
      });
    }

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
      room_id, initial_payment_amount, currency,
      registration_number, course, guardian_name, guardian_phone
    } = req.body as any;
    if (!name || !email) return res.status(400).json({ success: false, message: 'Name and email are required' });
    if (!room_id) return res.status(400).json({ success: false, message: 'Room assignment is required' });
    if (!initial_payment_amount || parseFloat(initial_payment_amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Booking fee is required and must be greater than 0' });
    }

    // Use unified student registration service
    await client.query('BEGIN');
    
    const { StudentRegistrationService } = require('../utils/studentRegistration');
    
    try {
      const registrationResult = await StudentRegistrationService.registerStudent(
        {
          name,
          email,
          phone,
          gender,
          dateOfBirth: date_of_birth,
          registrationNumber: registration_number || (access_number ? undefined : `REG-${Date.now()}`),
          course: course || null,
          accessNumber: access_number || null,
          guardianName: guardian_name || null,
          guardianPhone: guardian_phone || null,
          emergencyContact: emergency_contact || null,
          hostelId,
          roomId: room_id,
          semesterId,
          initialPaymentAmount: parseFloat(initial_payment_amount),
          currency: currency || 'UGX',
        },
        currentUser.id,
        client
      );

      // Registration service handles everything - commit transaction
    await client.query('COMMIT');

      // Get room details for response
      const roomResult = await client.query(
        'SELECT room_number, price, capacity FROM rooms WHERE id = $1',
        [room_id]
      );
      const room = roomResult.rows[0];

      // Send student credentials email if a new user was created
      try {
        if (registrationResult.isNewUser && registrationResult.temporaryPassword) {
          const hostelMeta = await client.query('SELECT name FROM hostels WHERE id = $1', [hostelId]);
          const hostelName = hostelMeta.rows[0]?.name || 'Your Hostel';
          const loginBase = process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';
          const loginUrl = `${loginBase.replace(/\/$/, '')}/login`;

          const html = EmailService.generateStudentWelcomeEmail(
            name,
            email,
            email,
            registrationResult.temporaryPassword,
            hostelName,
            loginUrl
          );
          await EmailService.sendEmail({
            to: email,
            subject: `Welcome to ${hostelName} - Your Student Account`,
            html,
          });
        }
      } catch (emailErr) {
        console.warn('Student welcome email failed (non-blocking):', (emailErr as any)?.message || emailErr);
      }

      return res.status(201).json({
        success: true,
        message: registrationResult.isNewUser 
          ? 'Student registered successfully' 
          : 'Student updated successfully',
        data: {
          user: {
            id: registrationResult.userId,
          email,
            name,
          },
          enrollment_id: registrationResult.enrollmentId,
          assignment_id: registrationResult.assignmentId,
          payment_id: registrationResult.paymentId,
          room: {
            id: room_id,
            room_number: room?.room_number,
            capacity: room?.capacity,
          },
        },
      });
    } catch (registrationError: any) {
    await client.query('ROLLBACK');
      console.error('Student registration error:', registrationError);
      return res.status(400).json({
        success: false,
        message: registrationError.message || 'Failed to register student',
      });
  } finally {
    client.release();
    }
  } catch (error: any) {
    console.error('Student creation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
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
    // Check if student_profiles table exists
    const studentProfilesCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'student_profiles'
      ) as exists
    `);
    const hasStudentProfiles = studentProfilesCheck.rows[0]?.exists || false;
    
    const studentProfileSelect = hasStudentProfiles
      ? 'sp.gender, sp.date_of_birth, sp.access_number, sp.phone, sp.whatsapp, sp.emergency_contact'
      : 'NULL::text as gender, NULL::date as date_of_birth, NULL::text as access_number, NULL::text as phone, NULL::text as whatsapp, NULL::text as emergency_contact';
    
    const studentProfileJoin = hasStudentProfiles
      ? 'LEFT JOIN student_profiles sp ON sp.user_id = u.id'
      : '';

    const student = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.created_at,
              ${studentProfileSelect}
       FROM users u
       ${studentProfileJoin}
       WHERE u.id = $1 AND u.hostel_id = $2 AND u.role = 'user'`,
      [id, hostelId]
    );
    
    if (student.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    res.json({ success: true, data: student.rows[0] });
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
    const { name, email, gender, date_of_birth, access_number, phone, whatsapp, emergency_contact } = req.body as any;

    await client.query('BEGIN');

    // Verify the student belongs to this hostel
    const studentCheck = await client.query('SELECT id FROM users WHERE id = $1 AND hostel_id = $2 AND role = $3', [id, hostelId, 'user']);
    if (studentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Check if email is already taken by another user
    if (email) {
      const emailCheck = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
      if (emailCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
    }

    // Update user info
    if (name || email) {
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;
      if (name) {
        updateFields.push(`name = $${paramIndex++}`);
        updateValues.push(name);
      }
      if (email) {
        updateFields.push(`email = $${paramIndex++}`);
        updateValues.push(email);
      }
      updateValues.push(id);
      await client.query(`UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`, updateValues);
    }

    // Update or create profile
    const profileTableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('student_profiles', 'students')
    `);
    const hasStudentProfilesTable = profileTableCheck.rows.some((row: any) => row.table_name === 'student_profiles');
    const hasStudentsTable = profileTableCheck.rows.some((row: any) => row.table_name === 'students');

    if (hasStudentProfilesTable) {
      const profileExists = await client.query('SELECT user_id FROM student_profiles WHERE user_id = $1', [id]);
      if (profileExists.rowCount === 0) {
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
    } else if (hasStudentsTable) {
      const studentExists = await client.query('SELECT user_id FROM students WHERE user_id = $1', [id]);
      if (studentExists.rowCount === 0) {
        await client.query(
          `INSERT INTO students (user_id, registration_number, course, phone_number, emergency_contact, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          [id, access_number || `REG-${id}`, null, phone || null, emergency_contact || null]
        );
      } else {
        await client.query(
          `UPDATE students 
           SET registration_number = COALESCE($2, registration_number),
               phone_number = COALESCE($3, phone_number),
               emergency_contact = COALESCE($4, emergency_contact),
               updated_at = NOW()
           WHERE user_id = $1`,
          [id, access_number || null, phone || null, emergency_contact || null]
        );
      }
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

    // Only hostel_admin and super_admin can delete students (custodians cannot)
    if (currentUser.role !== 'hostel_admin' && currentUser.role !== 'super_admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only hostel administrators can delete students' 
      });
    }

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const { id } = req.params;

    await client.query('BEGIN');

    // Verify the student belongs to this hostel
    const studentCheck = await client.query('SELECT id FROM users WHERE id = $1 AND hostel_id = $2 AND role = $3', [id, hostelId, 'user']);
    if (studentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // End any active room assignment
    const assignmentColumnsRes = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'student_room_assignments'
    `);
    const assignmentColumns = new Set<string>(assignmentColumnsRes.rows.map((row: any) => row.column_name));
    const assignmentUserIdColumn = assignmentColumns.has('student_id')
      ? 'student_id'
      : assignmentColumns.has('user_id')
        ? 'user_id'
        : null;

    if (assignmentUserIdColumn) {
      // Update status to 'cancelled' (valid values are: 'active', 'completed', 'cancelled')
      // We use 'cancelled' since the student is being deleted, not completing their stay normally
      await client.query(
        `UPDATE student_room_assignments 
         SET status = 'cancelled', updated_at = NOW()
         WHERE ${assignmentUserIdColumn} = $1 AND status = 'active'`,
        [id]
      );
    }

    // Delete student profile if exists
    const profileTableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('student_profiles', 'students')
    `);
    const hasStudentProfilesTable = profileTableCheck.rows.some((row: any) => row.table_name === 'student_profiles');
    const hasStudentsTable = profileTableCheck.rows.some((row: any) => row.table_name === 'students');

    if (hasStudentProfilesTable) {
      await client.query('DELETE FROM student_profiles WHERE user_id = $1', [id]);
    } else if (hasStudentsTable) {
      await client.query('DELETE FROM students WHERE user_id = $1', [id]);
    }

    // Delete payments (optional): keep for audit; so we won't delete
    // Finally delete user
    await client.query('DELETE FROM users WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Student deleted successfully' });
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
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const { studentId, message, semesterId } = req.body as any;
    if (!message) return res.status(400).json({ success: false, message: 'Message is required' });

    const hostelResult = await pool.query('SELECT name FROM hostels WHERE id = $1', [hostelId]);
    const hostelName = hostelResult.rows[0]?.name || 'Hostel';

    let recipients: any[] = [];

    if (studentId) {
      // Single student notification
      const studentResult = await pool.query(
        'SELECT u.id, u.email, u.name FROM users u WHERE u.id = $1 AND u.hostel_id = $2 AND u.role = $3',
        [studentId, hostelId, 'user']
      );
      if (studentResult.rows.length > 0) {
        recipients = studentResult.rows;
      }
    } else {
      // Broadcast notification - all students in hostel
      let query = `
        SELECT DISTINCT u.id, u.email, u.name
        FROM users u
        WHERE u.hostel_id = $1 AND u.role = 'user'
      `;
      const params: any[] = [hostelId];
      
      // If semester_id is provided, filter by active semester enrollment
      if (semesterId) {
        query = `
          SELECT DISTINCT u.id, u.email, u.name
          FROM users u
          INNER JOIN semester_enrollments se ON se.user_id = u.id
          WHERE u.hostel_id = $1 AND u.role = 'user' AND se.semester_id = $2 AND se.enrollment_status = 'active'
        `;
        params.push(semesterId);
      }

      const allStudentsResult = await pool.query(query, params);
      recipients = allStudentsResult.rows;
    }

    if (recipients.length === 0) {
      return res.status(404).json({ success: false, message: 'No students found to notify' });
    }

    let sent = 0;
    for (const rec of recipients) {
      try {
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
            <div style="background-color: white; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <div style="border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 18px;">${hostelName}</h2>
              <div style="opacity: 0.95; font-size: 13px;">Important notification</div>
            </div>
              <div style="color: #374151;">
              <p>Dear ${rec.name || 'Student'},</p>
              <p>${message}</p>
              <p style="margin-top: 16px; font-size: 12px; color: #64748b;">This message was sent by ${hostelName}. Please do not reply to this email.</p>
              </div>
            </div>
          </div>`;
        await EmailService.sendEmail({
          to: rec.email,
          subject: `Notification from ${hostelName}`,
          html,
        });
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

// Resend mobile app credentials to a student (custodian/hostel_admin)
router.post('/resend-credentials', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (currentUser.role !== 'custodian' && currentUser.role !== 'hostel_admin' && currentUser.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (currentUser.role !== 'super_admin' && !hostelId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { studentId, email } = req.body as any;
    if (!studentId && !email) {
      return res.status(400).json({ success: false, message: 'studentId or email is required' });
    }

    // Load student by id/email and ensure belongs to this hostel
    const pool = require('../config/database').default || require('../config/database');
    const client = await pool.connect();
    try {
      let studentRow: any = null;
      if (studentId) {
        const res1 = await client.query(
          `SELECT id, email, name, hostel_id FROM users WHERE id = $1 AND role = 'user'`,
          [studentId],
        );
        studentRow = res1.rows[0] || null;
      } else if (email) {
        const res2 = await client.query(
          `SELECT id, email, name, hostel_id FROM users WHERE LOWER(email) = LOWER($1) AND role = 'user'`,
          [email],
        );
        studentRow = res2.rows[0] || null;
      }

      if (!studentRow) {
        return res.status(404).json({ success: false, message: 'Student not found' });
      }
      if (currentUser.role !== 'super_admin' && hostelId && studentRow.hostel_id !== hostelId) {
        return res.status(403).json({ success: false, message: 'Student not in your hostel' });
      }

      // Generate temp password and email credentials
      const bcrypt = require('bcryptjs');
      const { CredentialGenerator } = require('../utils/credentialGenerator');
      const { EmailService } = require('../services/emailService');

      const tempPassword = CredentialGenerator.generatePatternPassword();
      const hashed = await bcrypt.hash(tempPassword, 10);

      // Mark password as temp if supported
      const colCheck = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_is_temp'`,
      );
      if (colCheck.rows.length > 0) {
        await client.query(
          `UPDATE users SET password = $1, password_is_temp = true, updated_at = NOW() WHERE id = $2`,
          [hashed, studentRow.id],
        );
      } else {
        await client.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [
          hashed,
          studentRow.id,
        ]);
      }

      // Hostel name for email
      let hostelName = 'Hostel';
      if (studentRow.hostel_id) {
        const hRes = await client.query('SELECT name FROM hostels WHERE id = $1', [studentRow.hostel_id]);
        hostelName = hRes.rows[0]?.name || hostelName;
      }

      const loginBase = (process.env.FRONTEND_URL || '').trim() || 'http://localhost:3000';
      const loginUrl = `${loginBase.replace(/\/$/, '')}/login`;
      const html = EmailService.generateStudentWelcomeEmail(
        studentRow.name,
        studentRow.email,
        studentRow.email,
        tempPassword,
        hostelName,
        loginUrl,
      );
      await EmailService.sendEmail({
        to: studentRow.email,
        subject: `Your RooMio App Credentials - ${hostelName}`,
        html,
      });

      return res.json({ success: true, message: 'Credentials sent' });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Resend student credentials error:', e);
    return res.status(500).json({ success: false, message: 'Failed to send credentials' });
  }
});

// Issue credentials (generate + return temp password) for custodian/hostel_admin to share manually
router.post('/issue-credentials', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (currentUser.role !== 'custodian' && currentUser.role !== 'hostel_admin' && currentUser.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (currentUser.role !== 'super_admin' && !hostelId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { studentId, email } = req.body as any;
    if (!studentId && !email) {
      return res.status(400).json({ success: false, message: 'studentId or email is required' });
    }

    const pool = require('../config/database').default || require('../config/database');
    const client = await pool.connect();
    try {
      let studentRow: any = null;
      if (studentId) {
        const res1 = await client.query(
          `SELECT id, email, name, hostel_id FROM users WHERE id = $1 AND role = 'user'`,
          [studentId],
        );
        studentRow = res1.rows[0] || null;
      } else if (email) {
        const res2 = await client.query(
          `SELECT id, email, name, hostel_id FROM users WHERE LOWER(email) = LOWER($1) AND role = 'user'`,
          [email],
        );
        studentRow = res2.rows[0] || null;
      }

      if (!studentRow) {
        return res.status(404).json({ success: false, message: 'Student not found' });
      }
      if (currentUser.role !== 'super_admin' && hostelId && studentRow.hostel_id !== hostelId) {
        return res.status(403).json({ success: false, message: 'Student not in your hostel' });
      }

      const bcrypt = require('bcryptjs');
      const { CredentialGenerator } = require('../utils/credentialGenerator');
      const { EmailService } = require('../services/emailService');

      const tempPassword = CredentialGenerator.generatePatternPassword();
      const hashed = await bcrypt.hash(tempPassword, 10);

      const colCheck = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_is_temp'`,
      );
      if (colCheck.rows.length > 0) {
        await client.query(
          `UPDATE users SET password = $1, password_is_temp = true, updated_at = NOW() WHERE id = $2`,
          [hashed, studentRow.id],
        );
      } else {
        await client.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [
          hashed,
          studentRow.id,
        ]);
      }

      // Optional: send email in background as well
      try {
        let hostelName = 'Hostel';
        if (studentRow.hostel_id) {
          const hRes = await client.query('SELECT name FROM hostels WHERE id = $1', [studentRow.hostel_id]);
          hostelName = hRes.rows[0]?.name || hostelName;
        }
        const loginBase = (process.env.FRONTEND_URL || '').trim() || 'http://localhost:3000';
        const loginUrl = `${loginBase.replace(/\/$/, '')}/login`;
        const html = EmailService.generateStudentWelcomeEmail(
          studentRow.name,
          studentRow.email,
          studentRow.email,
          tempPassword,
          hostelName,
          loginUrl,
        );
        EmailService.sendEmailAsync({
          to: studentRow.email,
          subject: `Your RooMio App Credentials - ${hostelName}`,
          html,
        });
      } catch (e) {
        // ignore email failure for manual issuance
      }

      return res.json({
        success: true,
        data: {
          username: studentRow.email,
          email: studentRow.email,
          temporaryPassword: tempPassword,
        },
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Issue student credentials error:', e);
    return res.status(500).json({ success: false, message: 'Failed to issue credentials' });
  }
});

// Get student credentials (only if password is temporary - not changed by student)
router.get('/:id/credentials', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (currentUser.role !== 'custodian' && currentUser.role !== 'hostel_admin' && currentUser.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (currentUser.role !== 'super_admin' && !hostelId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { id } = req.params;
    const studentRes = await pool.query(
      `SELECT id, email, username, name, hostel_id, password_is_temp 
       FROM users 
       WHERE id = $1 AND role = 'user'`,
      [id]
    );

    if (studentRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const student = studentRes.rows[0];
    if (currentUser.role !== 'super_admin' && hostelId && student.hostel_id !== hostelId) {
      return res.status(403).json({ success: false, message: 'Student not in your hostel' });
    }

    // Only return credentials if password is temporary (not changed by student)
    if (!student.password_is_temp) {
      return res.json({
        success: true,
        data: {
          username: student.email,
          email: student.email,
          password: null,
          message: 'Password has been changed by student. Credentials are no longer visible.',
          passwordChangedByStudent: true,
        },
      });
    }

    // Try to retrieve stored temporary password
    const tempPasswordRes = await pool.query(
      `SELECT temporary_password, created_at 
       FROM temporary_password_storage 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [student.id]
    );

    if (tempPasswordRes.rows.length > 0) {
      return res.json({
        success: true,
        data: {
          username: student.email || student.username,
          email: student.email,
          password: tempPasswordRes.rows[0].temporary_password,
          message: 'Temporary password (not changed by student yet)',
          passwordChangedByStudent: false,
          canViewCredentials: true,
          createdAt: tempPasswordRes.rows[0].created_at,
        },
      });
    }

    // If no stored password found but password_is_temp is true, password was likely changed
    // but flag wasn't updated, or it's an old record
    return res.json({
      success: true,
      data: {
        username: student.email || student.username,
        email: student.email,
        password: null,
        message: 'Temporary password exists but not stored. Use "Reset Password" to generate new credentials.',
        passwordChangedByStudent: false,
        canViewCredentials: false,
      },
    });
  } catch (e) {
    console.error('Get student credentials error:', e);
    return res.status(500).json({ success: false, message: 'Failed to get credentials' });
  }
});

// Reset student password (generate new temp password)
router.post('/:id/reset-password', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (currentUser.role !== 'custodian' && currentUser.role !== 'hostel_admin' && currentUser.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const hostelId = await getHostelIdForUser(currentUser.id, currentUser.role);
    if (currentUser.role !== 'super_admin' && !hostelId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { id } = req.params;
    const studentRes = await pool.query(
      `SELECT id, email, name, hostel_id FROM users WHERE id = $1 AND role = 'user'`,
      [id]
    );

    if (studentRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const student = studentRes.rows[0];
    if (currentUser.role !== 'super_admin' && hostelId && student.hostel_id !== hostelId) {
      return res.status(403).json({ success: false, message: 'Student not in your hostel' });
    }

    // Generate new temporary password
    const tempPassword = CredentialGenerator.generatePatternPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);

    // Update password and mark as temporary
      const colCheck = await pool.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_is_temp'`,
      );
      if (colCheck.rows.length > 0) {
        await pool.query(
          `UPDATE users SET password = $1, password_is_temp = true, updated_at = NOW() WHERE id = $2`,
          [hashed, student.id],
        );
      } else {
        await pool.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [
          hashed,
          student.id,
        ]);
      }

      // Store temporary password for custodian viewing
      // Delete any existing entry first
      await pool.query(
        `DELETE FROM temporary_password_storage WHERE user_id = $1`,
        [student.id]
      );
      // Insert new temporary password
      await pool.query(
        `INSERT INTO temporary_password_storage (user_id, temporary_password, created_by) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (user_id) 
         DO UPDATE SET temporary_password = EXCLUDED.temporary_password, created_at = NOW(), created_by = EXCLUDED.created_by`,
        [student.id, tempPassword, currentUser.id]
      );

    // Get hostel name for email
    let hostelName = 'Hostel';
    if (student.hostel_id) {
      const hRes = await pool.query('SELECT name FROM hostels WHERE id = $1', [student.hostel_id]);
      hostelName = hRes.rows[0]?.name || hostelName;
    }

    // Send email notification (optional, in background)
    try {
      const loginBase = (process.env.FRONTEND_URL || '').trim() || 'http://localhost:3000';
      const loginUrl = `${loginBase.replace(/\/$/, '')}/login`;
      const html = EmailService.generateStudentWelcomeEmail(
        student.name,
        student.email,
        student.email,
        tempPassword,
        hostelName,
        loginUrl,
      );
      EmailService.sendEmailAsync({
        to: student.email,
        subject: `Your RooMio App Credentials Reset - ${hostelName}`,
        html,
      });
    } catch (e) {
      // Ignore email failure
      console.error('Failed to send reset email:', e);
    }

    return res.json({
      success: true,
      data: {
        username: student.email,
        email: student.email,
        temporaryPassword: tempPassword,
        message: 'Password reset successfully. New credentials generated.',
      },
    });
  } catch (e) {
    console.error('Reset student password error:', e);
    return res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

export default router;
