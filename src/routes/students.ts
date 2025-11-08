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
    // Determine whether to use student_profiles or students table for profile data
    const tableExistsCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('student_profiles', 'students')
    `);
    const hasStudentProfilesTable = tableExistsCheck.rows.some(row => row.table_name === 'student_profiles');
    const hasStudentsTable = tableExistsCheck.rows.some(row => row.table_name === 'students');

    if (hasStudentProfilesTable) {
      const profileExists = await client.query('SELECT user_id FROM student_profiles WHERE user_id = $1', [createdUser.id]);
      if (profileExists.rowCount === 0) {
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
    } else if (hasStudentsTable) {
      const columnsRes = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'students'
      `);
      const studentColumns = new Set(columnsRes.rows.map((row) => row.column_name));

      const baseColumns = ['user_id'];
      const baseValues: any[] = [createdUser.id];
      const basePlaceholders = ['$1'];
      let paramIndex = 2;

      const addColumnIfExists = (column: string, value: any) => {
        if (studentColumns.has(column)) {
          baseColumns.push(column);
          baseValues.push(value);
          basePlaceholders.push(`$${paramIndex++}`);
        }
      };

      const valuesForUpdate: Record<string, any> = {};

      addColumnIfExists('registration_number', req.body.registration_number || `REG-${createdUser.id}`);
      valuesForUpdate['registration_number'] = req.body.registration_number || `REG-${createdUser.id}`;

      addColumnIfExists('gender', gender || null);
      valuesForUpdate['gender'] = gender || null;

      addColumnIfExists('date_of_birth', date_of_birth || null);
      valuesForUpdate['date_of_birth'] = date_of_birth || null;

      addColumnIfExists('access_number', access_number || null);
      valuesForUpdate['access_number'] = access_number || null;

      addColumnIfExists('phone_number', phone || null);
      valuesForUpdate['phone_number'] = phone || null;

      addColumnIfExists('phone', phone || null);
      valuesForUpdate['phone'] = phone || null;

      addColumnIfExists('whatsapp', whatsapp || null);
      valuesForUpdate['whatsapp'] = whatsapp || null;

      addColumnIfExists('emergency_contact', emergency_contact || null);
      valuesForUpdate['emergency_contact'] = emergency_contact || null;

      if (studentColumns.has('created_at')) {
        baseColumns.push('created_at');
        baseValues.push(new Date());
        basePlaceholders.push(`$${paramIndex++}`);
      }

      if (studentColumns.has('updated_at')) {
        baseColumns.push('updated_at');
        baseValues.push(new Date());
        basePlaceholders.push(`$${paramIndex++}`);
      }

      const studentExists = await client.query('SELECT user_id FROM students WHERE user_id = $1', [createdUser.id]);
      if (studentExists.rowCount === 0) {
        await client.query(
          `INSERT INTO students (${baseColumns.join(', ')})
           VALUES (${basePlaceholders.join(', ')})`,
          baseValues
        );
      } else {
        const updateAssignments: string[] = [];
        const updateValues: any[] = [createdUser.id];
        let updateParamIndex = 2;

        Object.entries(valuesForUpdate).forEach(([column, value]) => {
          if (studentColumns.has(column)) {
            updateAssignments.push(`${column} = COALESCE($${updateParamIndex}, ${column})`);
            updateValues.push(value);
            updateParamIndex++;
          }
        });

        if (studentColumns.has('updated_at')) {
          updateAssignments.push(`updated_at = NOW()`);
        }

        if (updateAssignments.length > 0) {
          await client.query(
            `UPDATE students 
             SET ${updateAssignments.join(', ')}
             WHERE user_id = $1`,
            updateValues
          );
        }
      }
    } else {
      console.warn('Neither student_profiles nor students table exists; skipping profile persistence.');
    }

    // Store room metadata for email and enrollments
    let roomMeta: { room_number: string | null; price: number | null } = { room_number: null, price: null };
    
    // Assign room if provided
    if (room_id) {
      const assignmentColumnsRes = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'student_room_assignments'
      `);
      const assignmentColumns = new Set<string>(assignmentColumnsRes.rows.map(row => row.column_name));
      const assignmentUserIdColumn = assignmentColumns.has('student_id')
        ? 'student_id'
        : assignmentColumns.has('user_id')
          ? 'user_id'
          : null;
      const assignmentStatusColumn = assignmentColumns.has('status') ? 'status' : null;
      const assignmentUpdatedAtColumn = assignmentColumns.has('updated_at') ? 'updated_at' : null;
      const assignmentSemesterColumn = assignmentColumns.has('semester_id') ? 'semester_id' : null;

      if (!assignmentUserIdColumn) {
        console.warn('[Students] student_room_assignments missing user identifier column; skipping room assignment');
      } else {
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
        const activeAssignmentConditions: string[] = [`${assignmentUserIdColumn} = $1`];
        const activeAssignmentParams: any[] = [createdUser.id];
        let assignmentParamIndex = 2;
        if (assignmentSemesterColumn) {
          activeAssignmentConditions.push(`${assignmentSemesterColumn} = $${assignmentParamIndex}`);
          activeAssignmentParams.push(semesterId);
          assignmentParamIndex++;
        }
        if (assignmentStatusColumn) {
          activeAssignmentConditions.push(`${assignmentStatusColumn} = 'active'`);
        }
        const existingAssignment = await client.query(
          `SELECT id FROM student_room_assignments WHERE ${activeAssignmentConditions.join(' AND ')}`,
          activeAssignmentParams
        );
      
        if (existingAssignment.rowCount === 0) {
          // Create new room assignment
          const assignmentInsertColumns: string[] = [assignmentUserIdColumn];
          const assignmentInsertPlaceholders: string[] = ['$1'];
          const assignmentInsertValues: any[] = [createdUser.id];
          let insertIndex = 2;

          if (assignmentColumns.has('room_id')) {
            assignmentInsertColumns.push('room_id');
            assignmentInsertPlaceholders.push(`$${insertIndex++}`);
            assignmentInsertValues.push(room_id);
          }
          if (assignmentSemesterColumn) {
            assignmentInsertColumns.push(assignmentSemesterColumn);
            assignmentInsertPlaceholders.push(`$${insertIndex++}`);
            assignmentInsertValues.push(semesterId);
          }
          if (assignmentStatusColumn) {
            assignmentInsertColumns.push(assignmentStatusColumn);
            assignmentInsertPlaceholders.push(`$${insertIndex++}`);
            assignmentInsertValues.push('active');
          }
          if (assignmentColumns.has('created_at')) {
            assignmentInsertColumns.push('created_at');
            assignmentInsertPlaceholders.push(`$${insertIndex++}`);
            assignmentInsertValues.push(new Date());
          }
          if (assignmentUpdatedAtColumn) {
            assignmentInsertColumns.push(assignmentUpdatedAtColumn);
            assignmentInsertPlaceholders.push(`$${insertIndex++}`);
            assignmentInsertValues.push(new Date());
          }

          await client.query(
            `INSERT INTO student_room_assignments (${assignmentInsertColumns.join(', ')})
             VALUES (${assignmentInsertPlaceholders.join(', ')})`,
            assignmentInsertValues
          );
        } else {
          // Update existing assignment
          const assignmentUpdateSets: string[] = [];
          const assignmentUpdateValues: any[] = [];
          let updateIndex = 1;

          if (assignmentColumns.has('room_id')) {
            assignmentUpdateSets.push(`room_id = $${updateIndex++}`);
            assignmentUpdateValues.push(room_id);
          }
          if (assignmentUpdatedAtColumn) {
            assignmentUpdateSets.push(`${assignmentUpdatedAtColumn} = NOW()`);
          }

          if (assignmentUpdateSets.length > 0) {
            assignmentUpdateValues.push(existingAssignment.rows[0].id);
            await client.query(
              `UPDATE student_room_assignments SET ${assignmentUpdateSets.join(', ')} WHERE id = $${updateIndex}`,
              assignmentUpdateValues
            );
          }
        }
      
        // Mark room as occupied only if it's single occupancy (capacity = 1)
        if (room.status === 'available' && capacity === 1) {
          await client.query("UPDATE rooms SET status = 'occupied', updated_at = NOW() WHERE id = $1", [room_id]);
        }
      }
    }

    // Create semester enrollment for this student
    const enrollmentColumnsRes = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'semester_enrollments'
    `);
    const enrollmentColumns = new Set<string>(enrollmentColumnsRes.rows.map(row => row.column_name));
    const enrollmentUserIdColumn = enrollmentColumns.has('student_id')
      ? 'student_id'
      : enrollmentColumns.has('user_id')
        ? 'user_id'
        : null;
    const enrollmentStatusColumn = enrollmentColumns.has('enrollment_status')
      ? 'enrollment_status'
      : enrollmentColumns.has('status')
        ? 'status'
        : null;
    const enrollmentRoomColumn = enrollmentColumns.has('room_id') ? 'room_id' : null;
    const enrollmentUpdatedAtColumn = enrollmentColumns.has('updated_at') ? 'updated_at' : null;
    const enrollmentCreatedAtColumn = enrollmentColumns.has('created_at') ? 'created_at' : null;

    if (!enrollmentUserIdColumn) {
      console.warn('[Students] semester_enrollments missing user identifier column; skipping enrollment creation');
    } else {
      const enrollmentInsertColumns: string[] = ['semester_id', enrollmentUserIdColumn];
      const enrollmentInsertPlaceholders: string[] = ['$1', '$2'];
      const enrollmentValues: any[] = [semesterId, createdUser.id];
      let enrollmentIndex = 3;

      if (enrollmentRoomColumn) {
        enrollmentInsertColumns.push(enrollmentRoomColumn);
        enrollmentInsertPlaceholders.push(`$${enrollmentIndex++}`);
        enrollmentValues.push(room_id || null);
      }
      if (enrollmentStatusColumn) {
        enrollmentInsertColumns.push(enrollmentStatusColumn);
        enrollmentInsertPlaceholders.push(`$${enrollmentIndex++}`);
        enrollmentValues.push('active');
      }
      if (enrollmentCreatedAtColumn) {
        enrollmentInsertColumns.push(enrollmentCreatedAtColumn);
        enrollmentInsertPlaceholders.push(`$${enrollmentIndex++}`);
        enrollmentValues.push(new Date());
      }
      if (enrollmentUpdatedAtColumn) {
        enrollmentInsertColumns.push(enrollmentUpdatedAtColumn);
        enrollmentInsertPlaceholders.push(`$${enrollmentIndex++}`);
        enrollmentValues.push(new Date());
      }

      const conflictColumnList = enrollmentColumns.has('semester_id')
        ? `semester_id, ${enrollmentUserIdColumn}`
        : `${enrollmentUserIdColumn}`;

      const updateAssignments: string[] = [];
      const updateValues: any[] = [];
      if (enrollmentStatusColumn) {
        updateAssignments.push(`${enrollmentStatusColumn} = 'active'`);
      }
      if (enrollmentRoomColumn) {
        updateAssignments.push(`${enrollmentRoomColumn} = EXCLUDED.${enrollmentRoomColumn}`);
      }
      if (enrollmentUpdatedAtColumn) {
        updateAssignments.push(`${enrollmentUpdatedAtColumn} = NOW()`);
      }

      const upsertQuery = updateAssignments.length > 0 && enrollmentColumns.has('semester_id')
        ? `
        INSERT INTO semester_enrollments (${enrollmentInsertColumns.join(', ')})
        VALUES (${enrollmentInsertPlaceholders.join(', ')})
        ON CONFLICT (${conflictColumnList})
        DO UPDATE SET ${updateAssignments.join(', ')}
        RETURNING *
      `
        : `
        INSERT INTO semester_enrollments (${enrollmentInsertColumns.join(', ')})
        VALUES (${enrollmentInsertPlaceholders.join(', ')})
        RETURNING *
      `;

      await client.query(upsertQuery, enrollmentValues.concat(updateValues));
    }

    // Record initial payment if provided
    let initialPayment = 0;
    if (initial_payment_amount) {
      initialPayment = parseFloat(initial_payment_amount);
      if (!Number.isFinite(initialPayment) || initialPayment <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Initial payment amount is invalid' });
      }

      const paymentsColumnsRes = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'payments'
      `);
      const paymentColumns = new Set<string>(paymentsColumnsRes.rows.map(row => row.column_name));

      const paymentUserIdColumn = paymentColumns.has('student_id')
        ? 'student_id'
        : paymentColumns.has('user_id')
          ? 'user_id'
          : null;

      if (!paymentUserIdColumn || !paymentColumns.has('amount')) {
        console.warn('[Students] Skipping initial payment insert; required columns missing on payments table');
      } else {
        const insertColumns: string[] = [];
        const placeholders: string[] = [];
        const values: any[] = [];
        let paymentParamIndex = 1;
        const pushColumn = (column: string, value: any) => {
          if (paymentColumns.has(column)) {
            insertColumns.push(column);
            placeholders.push(`$${paymentParamIndex++}`);
            values.push(value);
          }
        };

        pushColumn(paymentUserIdColumn, createdUser.id);
        pushColumn('hostel_id', hostelId);
        pushColumn('semester_id', semesterId);
        pushColumn('amount', initialPayment);

        const resolvedCurrency = currency || 'UGX';
        if (paymentColumns.has('currency')) {
          pushColumn('currency', resolvedCurrency);
        } else if (paymentColumns.has('currency_code')) {
          pushColumn('currency_code', resolvedCurrency);
        }

        if (paymentColumns.has('purpose')) {
          pushColumn('purpose', 'booking');
        } else if (paymentColumns.has('notes')) {
          pushColumn('notes', 'booking');
        }

        if (paymentColumns.has('status')) {
          pushColumn('status', 'completed');
        }
        if (paymentColumns.has('payment_method')) {
          pushColumn('payment_method', 'cash');
        }
        if (paymentColumns.has('created_at')) {
          pushColumn('created_at', new Date());
        }
        if (paymentColumns.has('updated_at')) {
          pushColumn('updated_at', new Date());
        }

        if (insertColumns.length >= 2) {
          await client.query(
            `INSERT INTO payments (${insertColumns.join(', ')})
             VALUES (${placeholders.join(', ')})`,
            values
          );
        } else {
          console.warn('[Students] Initial payment insert skipped; insufficient columns detected:', insertColumns);
        }
      }
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
    const assignmentColumnsRes = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'student_room_assignments'
    `);
    const assignmentColumns = new Set<string>(assignmentColumnsRes.rows.map(row => row.column_name));
    const assignmentUserIdColumn = assignmentColumns.has('student_id')
      ? 'student_id'
      : assignmentColumns.has('user_id')
        ? 'user_id'
        : null;
    const statusColumn = assignmentColumns.has('status')
      ? 'status'
      : assignmentColumns.has('stay_status')
        ? 'stay_status'
        : null;
    const isActiveColumn = assignmentColumns.has('is_active') ? 'is_active' : null;

    if (assignmentUserIdColumn) {
      const updateAssignments: string[] = [];
      const queryParams: any[] = [id];
      let nextParamIndex = 2;
      let activeValues: string[] | null = null;
      if (statusColumn) {
        const statusValuesRes = await client.query(
          `SELECT DISTINCT ${statusColumn} AS value
           FROM student_room_assignments
           WHERE ${statusColumn} IS NOT NULL
           LIMIT 25`
        );
        const rawValues = statusValuesRes.rows.map((row) => String(row.value));
        const lowerToRaw = new Map(rawValues.map((val) => [val.toLowerCase(), val]));

        let endedValue: string | null = null;
        if (lowerToRaw.has('ended')) {
          endedValue = lowerToRaw.get('ended') || null;
        } else if (lowerToRaw.has('inactive')) {
          endedValue = lowerToRaw.get('inactive') || null;
        } else if (lowerToRaw.has('completed')) {
          endedValue = lowerToRaw.get('completed') || null;
        } else if (lowerToRaw.size) {
          const firstValue = lowerToRaw.values().next().value;
          endedValue = typeof firstValue === 'string' ? firstValue : null;
        }

        if (endedValue) {
          updateAssignments.push(`${statusColumn} = $${nextParamIndex++}`);
          queryParams.push(endedValue);
        }

        const activeCandidates = rawValues.filter((val) =>
          /active|assigned|pending/i.test(String(val))
        );
        if (activeCandidates.length) {
          activeValues = Array.from(new Set(activeCandidates));
        }
      }
      if (isActiveColumn) {
        updateAssignments.push(`${isActiveColumn} = false`);
      }
      if (assignmentColumns.has('ended_at')) {
        updateAssignments.push(`ended_at = NOW()`);
      }
      if (assignmentColumns.has('updated_at')) {
        updateAssignments.push(`updated_at = NOW()`);
      }

      if (updateAssignments.length > 0) {
        const conditions: string[] = [`${assignmentUserIdColumn} = $1`];
        const conditionParams: any[] = [];
        if (statusColumn && activeValues && activeValues.length) {
          const activePlaceholders = activeValues
            .map((val) => {
              conditionParams.push(val);
              return `$${nextParamIndex++}`;
            })
            .join(', ');
          conditions.push(`${statusColumn} IN (${activePlaceholders})`);
        }
        if (isActiveColumn) {
          conditions.push(`${isActiveColumn} = true`);
        }

        const updateSql = `
          UPDATE student_room_assignments
          SET ${updateAssignments.join(', ')}
          WHERE ${conditions.join(' AND ')}
        `;

        await client.query(updateSql, [...queryParams, ...conditionParams]);
      }
    } else {
      console.warn('[Students] Unable to determine user column in student_room_assignments; skipping assignment cleanup.');
    }
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















