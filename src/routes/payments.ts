import express, { Request } from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';
import { EmailService } from '../services/emailService';
import { requireActiveSemester } from '../utils/semesterMiddleware';
import bcrypt from 'bcryptjs';
import { CredentialGenerator } from '../utils/credentialGenerator';

const router = express.Router();

// Simple in-memory cache for payments summary by hostel
type SummaryCacheItem = { data: any; expiresAt: number };
const summaryCache: Map<number, SummaryCacheItem> = new Map();
const SUMMARY_TTL_MS = 10_000; // 10 seconds

interface PaymentTableInfo {
  userIdColumn: string;
  hasHostelIdColumn: boolean;
  hasSemesterIdColumn: boolean;
  currencyColumn: string | null;
  purposeColumn: string | null;
  primaryDateColumn: string | null;
  createdAtColumn: string | null;
  paymentMethodColumn: string | null;
}

let paymentTableInfoCache: PaymentTableInfo | null = null;

async function getPaymentTableInfo(): Promise<PaymentTableInfo> {
  if (paymentTableInfoCache) return paymentTableInfoCache;

  const res = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'payments'
  `);
  const columns = res.rows.map((r) => r.column_name);
  const userIdColumn = columns.includes('user_id')
    ? 'user_id'
    : columns.includes('student_id')
    ? 'student_id'
    : 'user_id';
  const purposeColumn = columns.includes('purpose')
    ? 'purpose'
    : columns.includes('notes')
    ? 'notes'
    : null;
  const paymentMethodColumn = columns.includes('payment_method')
    ? 'payment_method'
    : columns.includes('method')
    ? 'method'
    : null;

  const primaryDateColumn = columns.includes('payment_date')
    ? 'payment_date'
    : columns.includes('paid_at')
    ? 'paid_at'
    : columns.includes('date')
    ? 'date'
    : null;
  const createdAtColumn = columns.includes('created_at') ? 'created_at' : null;

  paymentTableInfoCache = {
    userIdColumn,
    hasHostelIdColumn: columns.includes('hostel_id'),
    hasSemesterIdColumn: columns.includes('semester_id'),
    currencyColumn: columns.includes('currency') ? 'currency' : null,
    purposeColumn,
    primaryDateColumn,
    createdAtColumn,
    paymentMethodColumn,
  };

  return paymentTableInfoCache;
}

function buildPaymentDateExpression(info: PaymentTableInfo): string {
  const { primaryDateColumn, createdAtColumn } = info;
  if (primaryDateColumn && createdAtColumn && primaryDateColumn !== createdAtColumn) {
    return `COALESCE(p.${primaryDateColumn}, p.${createdAtColumn})`;
  }
  if (primaryDateColumn) {
    return `p.${primaryDateColumn}`;
  }
  if (createdAtColumn) {
    return `p.${createdAtColumn}`;
  }
  return 'CURRENT_DATE';
}

const PAYMENT_METHOD_ALIASES: Record<string, string> = {
  cash: 'cash',
  'cash_payment': 'cash',
  'cash payments': 'cash',
  'cash-payment': 'cash',
  'mobile_money': 'mobile_money',
  'mobile-money': 'mobile_money',
  'mobile money': 'mobile_money',
  momo: 'mobile_money',
  'mtn momo': 'mobile_money',
  'airtel money': 'mobile_money',
  'bank_transfer': 'bank_transfer',
  'bank transfer': 'bank_transfer',
  transfer: 'bank_transfer',
  'bank': 'bank_transfer',
  'cheque': 'bank_transfer',
  'card': 'card',
  'card_payment': 'card',
  pos: 'card',
  'point of sale': 'card',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  bank_transfer: 'Bank Transfer',
  card: 'Card / POS',
  unspecified: 'Unspecified',
};

function normalizePaymentMethod(method: string | null | undefined): string {
  if (method == null) return 'unspecified';
  const key = method.toString().trim().toLowerCase();
  if (!key) return 'unspecified';
  return (
    PAYMENT_METHOD_ALIASES[key] ||
    key
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') ||
    'unspecified'
  );
}

function getPaymentMethodLabel(method: string): string {
  if (PAYMENT_METHOD_LABELS[method]) {
    return PAYMENT_METHOD_LABELS[method];
  }
  const cleaned = method.replace(/_/g, ' ').trim();
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'Other';
}

interface StudentRoomAssignmentInfo {
  userIdColumn: string;
  hasSemesterColumn: boolean;
  assignmentDateColumn: string | null;
  createdAtColumn: string | null;
}

let studentRoomAssignmentInfoCache: StudentRoomAssignmentInfo | null = null;

async function getStudentRoomAssignmentInfo(): Promise<StudentRoomAssignmentInfo> {
  if (studentRoomAssignmentInfoCache) return studentRoomAssignmentInfoCache;

  const res = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'student_room_assignments'
  `);
  const columns = res.rows.map((r) => r.column_name);

  const preferredAssignmentColumns = ['assignment_date', 'assigned_at', 'start_date'];
  const assignmentDateColumn =
    preferredAssignmentColumns.find((col) => columns.includes(col)) || null;
  const createdAtColumn = columns.includes('created_at') ? 'created_at' : null;

  studentRoomAssignmentInfoCache = {
    userIdColumn: columns.includes('user_id')
      ? 'user_id'
      : columns.includes('student_id')
      ? 'student_id'
      : 'user_id',
    hasSemesterColumn: columns.includes('semester_id'),
    assignmentDateColumn,
    createdAtColumn,
  };

  return studentRoomAssignmentInfoCache;
}

interface RoomTableInfo {
  priceColumn: string | null;
}

let roomTableInfoCache: RoomTableInfo | null = null;

interface RoomPriceExpressions {
  selectExpr: string | null;
  sumExpr: string;
  singleExpr: string;
}

async function getRoomTableInfo(): Promise<RoomTableInfo> {
  if (roomTableInfoCache) return roomTableInfoCache;

  const res = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rooms'
  `);
  const columns = res.rows.map((r) => r.column_name);

  const preferredPriceColumns = [
    'price',
    'price_per_room',
    'price_per_semester',
    'total_price',
    'price_per_month',
  ];

  const priceColumn = preferredPriceColumns.find((col) => columns.includes(col)) || null;

  roomTableInfoCache = { priceColumn };

  if (!priceColumn) {
    console.warn(
      '⚠️  rooms table price column not found. Outstanding balance calculations will default to 0 until a price column is added.'
    );
  }

  return roomTableInfoCache;
}

async function getRoomPriceExpressions(): Promise<RoomPriceExpressions> {
  const roomInfo = await getRoomTableInfo();
  const selectExpr = roomInfo.priceColumn ? `rm.${roomInfo.priceColumn}::numeric` : null;
  return {
    selectExpr,
    sumExpr: selectExpr ?? '0::numeric',
    singleExpr: selectExpr ?? 'NULL::numeric',
  };
}

function applyRoomPriceSum(sql: string, sumExpr: string): string {
  return sql.replace(/__ROOM_PRICE_SUM__/g, sumExpr);
}

function createRoomPriceInjector(sumExpr: string) {
  return (sql: string) => applyRoomPriceSum(sql, sumExpr);
}

function buildAssignmentDateExpression(info: StudentRoomAssignmentInfo): string {
  if (info.assignmentDateColumn) {
    return `COALESCE(sra.${info.assignmentDateColumn}, CURRENT_DATE)`;
  }
  if (info.createdAtColumn) {
    return `COALESCE(sra.${info.createdAtColumn}, CURRENT_DATE)`;
  }
  return 'CURRENT_DATE';
}

async function resolveHostelIdForUser(userId: number, role: string): Promise<number | null> {
  if (role === 'hostel_admin') {
    const u = await UserModel.findById(userId);
    return u?.hostel_id || null;
  }
  if (role === 'custodian') {
    const r = await pool.query('SELECT hostel_id FROM custodians WHERE user_id = $1', [userId]);
    const fromCustodians = r.rows[0]?.hostel_id || null;
    if (fromCustodians) return fromCustodians;
    const u = await UserModel.findById(userId);
    return u?.hostel_id || null;
  }
  return null;
}

// Record a payment for a student in current hostel and send receipt
router.post('/', async (req: Request, res) => {
  const client = await pool.connect();
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const hostelId = await resolveHostelIdForUser(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    // Check for active semester before allowing payment recording
    const semesterCheck = await requireActiveSemester(currentUser.id, hostelId);
    if (!semesterCheck.success) {
      return res.status(400).json({ success: false, message: semesterCheck.message });
    }

    const { user_id, amount, currency, purpose } = req.body as any;
    if (!user_id) return res.status(400).json({ success: false, message: 'user_id is required' });

    // Validate student belongs to hostel
    const student = await pool.query('SELECT id, email, name FROM users WHERE id = $1 AND hostel_id = $2 AND role = \'user\'', [user_id, hostelId]);
    if (!student.rowCount) return res.status(404).json({ success: false, message: 'Student not found in this hostel' });

    const paymentInfo = await getPaymentTableInfo();
    const sraInfo = await getStudentRoomAssignmentInfo();
    const { singleExpr: roomExpectedPriceExpr } = await getRoomPriceExpressions();

    // Determine active assignment and expected room price
    const roomParams: any[] = [user_id, hostelId];
    let roomQuery = `
      SELECT rm.room_number, ${roomExpectedPriceExpr} AS expected_price
      FROM student_room_assignments sra
      JOIN rooms rm ON rm.id = sra.room_id
      WHERE sra.${sraInfo.userIdColumn} = $1
        AND rm.hostel_id = $2
        AND sra.status = 'active'
    `;
    let roomParamIndex = 3;
    if (sraInfo.hasSemesterColumn && semesterCheck.semesterId != null) {
      roomQuery += ` AND sra.semester_id = $${roomParamIndex++}`;
      roomParams.push(semesterCheck.semesterId);
    }
    const orderDateCol = sraInfo.assignmentDateColumn
      ? `sra.${sraInfo.assignmentDateColumn}`
      : (sraInfo.createdAtColumn ? `sra.${sraInfo.createdAtColumn}` : 'sra.id');
    roomQuery += `
      ORDER BY ${orderDateCol} DESC NULLS LAST, sra.id DESC
      LIMIT 1
    `;

    let roomRes = await client.query(roomQuery, roomParams);
    let room = roomRes.rows[0] || null;
    let expectedPrice = room?.expected_price != null ? parseFloat(room.expected_price) : null;

    // If no active assignment/expected price, try to resolve from an online booking by student's email
    if (expectedPrice == null) {
      const bookingLookup = await client.query(
        `SELECT b.id, b.room_id, b.semester_id
         FROM public_hostel_bookings b
         JOIN users u ON LOWER(u.email) = LOWER(b.student_email)
         WHERE u.id = $1 AND b.hostel_id = $2
           ${semesterCheck.semesterId != null ? 'AND b.semester_id = $3' : ''}
           AND b.status IN ('booked','pending')
         ORDER BY b.created_at DESC
         LIMIT 1`,
        semesterCheck.semesterId != null ? [user_id, hostelId, semesterCheck.semesterId] : [user_id, hostelId]
      );
      const bookingRow = bookingLookup.rows[0];
      if (bookingRow) {
        // Determine room expected price
        const roomPriceRes = await client.query(`SELECT price FROM rooms WHERE id = $1 AND hostel_id = $2`, [
          bookingRow.room_id,
          hostelId,
        ]);
        const rp = roomPriceRes.rows[0]?.price;
        if (rp != null) {
          expectedPrice = Number(rp);
        }
        // Create enrollment if missing
        await client.query(
          `INSERT INTO semester_enrollments (
            user_id, semester_id, room_id, enrollment_status,
            total_amount, amount_paid, balance, enrollment_date, created_at, updated_at
          ) VALUES ($1, $2, $3, 'active', $4::numeric, 0::numeric, $4::numeric, NOW(), NOW(), NOW())
          ON CONFLICT (user_id, semester_id) DO NOTHING`,
          [user_id, bookingRow.semester_id, bookingRow.room_id, expectedPrice ?? 0]
        );
        // Create active assignment if not present
        const sraCols = await getStudentRoomAssignmentInfo();
        const sraUserCol = sraCols.userIdColumn;
        const existingAssignment = await client.query(
          `SELECT id FROM student_room_assignments
           WHERE ${sraUserCol} = $1 AND room_id = $2 AND ${sraCols.hasSemesterColumn ? 'semester_id = $3 AND' : ''} status = 'active'
           LIMIT 1`,
          sraCols.hasSemesterColumn ? [user_id, bookingRow.room_id, bookingRow.semester_id] : [user_id, bookingRow.room_id]
        );
        if (existingAssignment.rowCount === 0) {
          await client.query(
            `INSERT INTO student_room_assignments (${sraUserCol}, room_id, ${sraCols.hasSemesterColumn ? 'semester_id,' : ''} assigned_by, ${sraCols.assignmentDateColumn ?? 'assigned_at'}, status, created_at, updated_at)
             VALUES ($1, $2, ${sraCols.hasSemesterColumn ? '$3,' : ''} $${sraCols.hasSemesterColumn ? 4 : 3}, NOW(), 'active', NOW(), NOW())`,
            sraCols.hasSemesterColumn ? [user_id, bookingRow.room_id, bookingRow.semester_id, currentUser.id] : [user_id, bookingRow.room_id, currentUser.id]
          );
        }
        // refresh room expected info
        roomRes = await client.query(
          `SELECT rm.room_number, ${roomExpectedPriceExpr} AS expected_price
           FROM rooms rm WHERE rm.id = $1`,
          [bookingRow.room_id]
        );
        room = roomRes.rows[0] || null;
        expectedPrice = room?.expected_price != null ? parseFloat(room.expected_price) : expectedPrice;
      }
    }

    const sumBeforeParams: any[] = [user_id];
    let sumBeforeQuery = `SELECT COALESCE(SUM(amount),0) as total_paid FROM payments WHERE ${paymentInfo.userIdColumn} = $1`;
    if (paymentInfo.hasSemesterIdColumn && semesterCheck.semesterId != null) {
      sumBeforeParams.push(semesterCheck.semesterId);
      sumBeforeQuery += ' AND semester_id = $2';
    }
    const sumBeforeRes = await client.query(sumBeforeQuery, sumBeforeParams);
    const totalPaidBeforeRaw = parseFloat(sumBeforeRes.rows[0]?.total_paid || '0');
    const totalPaidBefore = Math.round(totalPaidBeforeRaw);

    const requestedAmountRaw = amount !== undefined ? Number(amount) : NaN;
    if (!Number.isFinite(requestedAmountRaw) || requestedAmountRaw <= 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid positive amount is required',
      });
    }
    const requestedAmount = Math.round(requestedAmountRaw);

    let finalAmount = requestedAmount;
    if (expectedPrice != null) {
      const remaining = Math.max(expectedPrice - totalPaidBefore, 0);
      if (remaining === 0) {
        return res.status(400).json({
          success: false,
          message: 'This student has already paid the full room amount',
        });
      }
      if (requestedAmount > remaining) {
        return res.status(400).json({
          success: false,
          message: `Amount exceeds remaining balance of ${remaining}`,
        });
      }
      finalAmount = Math.min(requestedAmount, remaining);
    }

    const currencyColumn = paymentInfo.currencyColumn;
    const purposeColumn = paymentInfo.purposeColumn;

    const insertColumns: string[] = [paymentInfo.userIdColumn];
    const insertValues: any[] = [user_id];
    const placeholders: string[] = ['$1'];
    let paramIndex = 2;

    if (paymentInfo.hasHostelIdColumn) {
      insertColumns.push('hostel_id');
      insertValues.push(hostelId);
      placeholders.push(`$${paramIndex++}`);
    }

    if (paymentInfo.hasSemesterIdColumn) {
      insertColumns.push('semester_id');
      insertValues.push(semesterCheck.semesterId ?? null);
      placeholders.push(`$${paramIndex++}`);
    }

    insertColumns.push('amount');
    insertValues.push(finalAmount);
    placeholders.push(`$${paramIndex++}`);

    if (currencyColumn) {
      insertColumns.push(currencyColumn);
      insertValues.push(currency || 'UGX');
      placeholders.push(`$${paramIndex++}`);
    }

    if (purposeColumn) {
      insertColumns.push(purposeColumn);
      insertValues.push(purpose || 'booking');
      placeholders.push(`$${paramIndex++}`);
    }

    // Compute balance (simple: sum of payments negative; could be extended with expected fees table)
    await client.query('BEGIN');
    const payRes = await client.query(
      `INSERT INTO payments (${insertColumns.join(', ')})
       VALUES (${placeholders.join(', ')})
       RETURNING id, created_at`,
      insertValues
    );

    // Check if student_room_assignments table uses student_id or user_id
    // Compute totals AFTER this payment for this semester
    const totalPaidAfter = totalPaidBefore + finalAmount;
    const expected = room?.expected_price != null ? Math.round(room.expected_price) : null;
    const balanceAfter = expected != null ? Math.max(expected - totalPaidAfter, 0) : null;

    // Update semester enrollment totals (amount_paid, balance) when possible
    try {
      if (semesterCheck.semesterId != null) {
        // Ensure enrollment exists
        await client.query(
          `INSERT INTO semester_enrollments (
            user_id, semester_id, room_id, enrollment_status,
            total_amount, amount_paid, balance, enrollment_date, created_at, updated_at
          ) VALUES ($1, $2, NULL, 'active', COALESCE($3::numeric, 0), $4::numeric, GREATEST(COALESCE($3::numeric,0) - $4::numeric, 0), NOW(), NOW(), NOW())
          ON CONFLICT (user_id, semester_id) DO NOTHING`,
          [user_id, semesterCheck.semesterId, expectedPrice ?? 0, totalPaidAfter]
        );

        // Update totals
        await client.query(
          `UPDATE semester_enrollments
           SET amount_paid = $3::numeric,
               balance = GREATEST(COALESCE(total_amount, 0)::numeric - $3::numeric, 0),
               enrollment_status = 'active',
               updated_at = NOW()
           WHERE user_id = $1 AND semester_id = $2`,
          [user_id, semesterCheck.semesterId, totalPaidAfter]
        );
      }
    } catch (enrollErr) {
      console.warn('Semester enrollment totals update failed:', (enrollErr as any)?.message || enrollErr);
    }

    await client.query('COMMIT');

    // Invalidate cached summary for this hostel
    if (hostelId) {
      summaryCache.delete(hostelId);
    }

    // Email receipt (hostel-branded)
    const s = student.rows[0];
    const hostelMeta = await pool.query('SELECT name FROM hostels WHERE id = $1', [hostelId]);
    const hostelName = hostelMeta.rows[0]?.name || undefined;
    const html = EmailService.generatePaymentReceiptEmail(
      s.name,
      s.email,
      finalAmount,
      currency || 'UGX',
      balanceAfter,
      room?.room_number || null,
      null,
      new Date(payRes.rows[0].created_at).toLocaleString(),
      hostelName,
      currentUser.name,
      'Cleared by',
      null,
      expected
    );
    // Send receipt
    await EmailService.sendEmail({ to: s.email, subject: 'Payment Receipt - LTS Portal', html });

    // If this is the student's first payment ever, generate/send credentials
    if (totalPaidBefore === 0) {
      try {
        const tempPassword = CredentialGenerator.generatePatternPassword();
        const hashed = await bcrypt.hash(tempPassword, 10);

        // Update password and mark as temporary if column exists
        const colCheck = await pool.query(
          `SELECT column_name 
           FROM information_schema.columns 
           WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_is_temp'`
        );
        if (colCheck.rows.length > 0) {
          await pool.query(
            'UPDATE users SET password = $1, password_is_temp = true, updated_at = NOW() WHERE id = $2',
            [hashed, user_id]
          );
        } else {
          await pool.query(
            'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
            [hashed, user_id]
          );
        }

        const loginBase = process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';
        const loginUrl = `${loginBase.replace(/\/$/, '')}/login`;
        const welcomeHtml = EmailService.generateStudentWelcomeEmail(
          s.name,
          s.email,
          s.email,
          tempPassword,
          hostelName || 'Our Hostel',
          loginUrl
        );
        await EmailService.sendEmail({
          to: s.email,
          subject: `Welcome to ${hostelName || 'Our Hostel'} - Your Student Account`,
          html: welcomeHtml,
        });
      } catch (credsErr) {
        console.warn('First-payment credentials email failed (non-blocking):', (credsErr as any)?.message || credsErr);
      }
    }

    // If fully paid now, ensure credentials exist (without resetting existing passwords)
    if (expected != null && balanceAfter != null && balanceAfter <= 0) {
      try {
        // Check if user has a password; if missing, create temp credentials
        const userRes = await pool.query(
          `SELECT password, 
                  (SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='password_is_temp' LIMIT 1) IS NOT NULL AS has_temp_col,
                  COALESCE(password_is_temp, false) AS password_is_temp
           FROM users WHERE id = $1`,
          [user_id]
        );
        const row = userRes.rows[0];
        const hasPassword = row && typeof row.password === 'string' && row.password.length > 0;
        const canMarkTemp = row?.has_temp_col === true;
        const isTemp = row?.password_is_temp === true;

        if (!hasPassword) {
          const tempPassword = CredentialGenerator.generatePatternPassword();
          const hashed = await bcrypt.hash(tempPassword, 10);
          if (canMarkTemp) {
            await pool.query(
              'UPDATE users SET password = $1, password_is_temp = true, updated_at = NOW() WHERE id = $2',
              [hashed, user_id]
            );
          } else {
            await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [hashed, user_id]);
          }

          const loginBase = process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';
          const loginUrl = `${loginBase.replace(/\/$/, '')}/login`;
          const welcomeHtml = EmailService.generateStudentWelcomeEmail(
            s.name,
            s.email,
            s.email,
            tempPassword,
            hostelName || 'Our Hostel',
            loginUrl
          );
          await EmailService.sendEmail({
            to: s.email,
            subject: `Welcome to ${hostelName || 'Our Hostel'} - Your Student Account`,
            html: welcomeHtml,
          });
        }
      } catch (credEnsureErr) {
        console.warn('Ensure credentials on full payment failed (non-blocking):', (credEnsureErr as any)?.message || credEnsureErr);
      }
    }

    // If fully paid now, send thank you & welcome email
    if (expected != null && balanceAfter != null && balanceAfter <= 0) {
      // Update enrollment to reflect fully paid and active
      try {
        await client.query(
          `UPDATE semester_enrollments
           SET amount_paid = $1::numeric,
               balance = GREATEST($2::numeric, 0),
               enrollment_status = 'active',
               updated_at = NOW()
           WHERE user_id = $3
             ${semesterCheck.semesterId != null ? 'AND semester_id = $4' : ''}`,
          semesterCheck.semesterId != null
            ? [totalPaidAfter, Math.max((expected ?? 0) - totalPaidAfter, 0), user_id, semesterCheck.semesterId]
            : [totalPaidAfter, Math.max((expected ?? 0) - totalPaidAfter, 0), user_id]
        );
      } catch (e) {
        console.warn('Failed to update enrollment amounts (non-blocking):', (e as any)?.message || e);
      }

      // Fetch student profile for access_number
      // Check if student_profiles table exists, otherwise use students table
      const studentProfilesCheck = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = 'student_profiles'
      `);
      const hasStudentProfiles = studentProfilesCheck.rows.length > 0;
      
      const profileQuery = hasStudentProfiles
        ? 'SELECT access_number FROM student_profiles WHERE user_id = $1'
        : 'SELECT access_number FROM students WHERE user_id = $1';
      
      const profileRes = await client.query(profileQuery, [user_id]);
      const accessNumber = profileRes.rows[0]?.access_number || null;
      
      const thankYouHtml = EmailService.generateThankYouWelcomeEmail(
        s.name,
        s.email,
        hostelName || 'Our Hostel',
        room?.room_number || null,
        accessNumber,
        finalAmount,
        currency || 'UGX',
        totalPaidAfter,
        expected
      );
      await EmailService.sendEmail({ 
        to: s.email, 
        subject: `Thank You & Welcome to ${hostelName}! - All Balance Paid`, 
        html: thankYouHtml 
      });

      // If this payment transitioned the student to fully-paid (i.e., before < expected and after >= expected)
      if (expected != null && totalPaidBefore < expected) {
        try {
          // Generate fresh app credentials and email them for mobile login
          const tempPassword = CredentialGenerator.generatePatternPassword();
          const hashed = await bcrypt.hash(tempPassword, 10);

          // Update password and mark as temporary if supported
          const colCheck = await pool.query(
            `SELECT column_name 
             FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_is_temp'`
          );
          if (colCheck.rows.length > 0) {
            await pool.query(
              'UPDATE users SET password = $1, password_is_temp = true, updated_at = NOW() WHERE id = $2',
              [hashed, user_id]
            );
          } else {
            await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [hashed, user_id]);
          }

          const loginBase = process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';
          const loginUrl = `${loginBase.replace(/\/$/, '')}/login`;

          const credsHtml = EmailService.generateStudentWelcomeEmail(
            s.name,
            s.email,
            s.email,
            tempPassword,
            hostelName || 'Our Hostel',
            loginUrl
          );
          await EmailService.sendEmail({
            to: s.email,
            subject: `Your RooMio App Credentials - ${hostelName || 'Our Hostel'}`,
            html: credsHtml,
          });
        } catch (credsErr) {
          console.warn('Fully-paid credentials email failed (non-blocking):', (credsErr as any)?.message || credsErr);
        }
      }
    }

    res.status(201).json({ success: true, message: 'Payment recorded and receipt sent', data: { total_paid: totalPaidAfter, expected, balance_after: balanceAfter } });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Record payment error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Payments summary for current hostel (super_admin may pass ?hostel_id=...)
router.get('/summary', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const tokenCandidate = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader?.trim();

    if (!tokenCandidate || tokenCandidate.toLowerCase() === 'null' || tokenCandidate.toLowerCase() === 'undefined') {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(tokenCandidate, process.env.JWT_SECRET || 'fallback_secret');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('Payments summary token verification failed:', message);
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let hostelId: number | null = null;
    if (currentUser.role === 'super_admin') {
      hostelId = req.query.hostel_id ? Number(req.query.hostel_id) : null;
      if (!hostelId) return res.status(400).json({ success: false, message: 'hostel_id is required for super_admin' });
    } else {
      hostelId = await resolveHostelIdForUser(currentUser.id, currentUser.role);
    }
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    // Optional semester filtering
    const semesterId = req.query.semester_id ? Number(req.query.semester_id) : null;

    // Serve from cache if fresh (but only if no semester filter)
    const now = Date.now();
    const cached = summaryCache.get(hostelId);
    if (!semesterId && cached && cached.expiresAt > now) {
      return res.json({ success: true, data: cached.data });
    }

    const paymentInfo = await getPaymentTableInfo();
    const sraInfo = await getStudentRoomAssignmentInfo();
    const { sumExpr: roomPriceForSum, singleExpr: roomPriceForSingle } = await getRoomPriceExpressions();
    const injectRoomPrice = createRoomPriceInjector(roomPriceForSum);
    const assignmentDateExpr = buildAssignmentDateExpression(sraInfo);
    
    // Total collected (filtered by semester if provided)
    let totalPaidQuery: string;
    let totalPaidParams: any[];
    
    if (paymentInfo.hasHostelIdColumn) {
      // Payments table has hostel_id column
      totalPaidQuery = semesterId
        ? 'SELECT COALESCE(SUM(amount),0) AS total_collected FROM payments WHERE hostel_id = $1 AND semester_id = $2'
        : 'SELECT COALESCE(SUM(amount),0) AS total_collected FROM payments WHERE hostel_id = $1';
      totalPaidParams = semesterId ? [hostelId, semesterId] : [hostelId];
    } else {
      // Payments table doesn't have hostel_id - filter via users table
      totalPaidQuery = semesterId
        ? `SELECT COALESCE(SUM(p.amount),0) AS total_collected 
           FROM payments p 
           JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
           WHERE u.hostel_id = $1 AND p.semester_id = $2`
        : `SELECT COALESCE(SUM(p.amount),0) AS total_collected 
           FROM payments p 
           JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
           WHERE u.hostel_id = $1`;
      totalPaidParams = semesterId ? [hostelId, semesterId] : [hostelId];
    }
    
    const totalPaidRes = await pool.query(totalPaidQuery, totalPaidParams);
    const ledgerCollected = parseFloat(totalPaidRes.rows[0]?.total_collected || '0');

    // Include booking payments recorded via the bookings module
    // Check if public_booking_payments table exists
    const bookingPaymentsTableCheck = await pool.query(
      "SELECT to_regclass('public.public_booking_payments') AS table_ref"
    );
    const hasBookingPaymentsTable = Boolean(bookingPaymentsTableCheck.rows[0]?.table_ref);

    let bookingPaymentsTotal = 0;
    let bookingAmountPaidTotal = 0;
    let bookingOutstandingFromPayments = 0;

    if (hasBookingPaymentsTable) {
      const bookingPaymentParams = semesterId ? [hostelId, semesterId] : [hostelId];
      // CRITICAL: Only count actual payment records from public_booking_payments where status = 'completed'
      // This is the source of truth for actual payments received
      const bookingPaymentsQuery = semesterId
        ? `
          SELECT 
            COALESCE(SUM(pbp.amount), 0) AS total_collected,
            COUNT(pbp.id) AS payment_count
          FROM public_booking_payments pbp
          JOIN public_hostel_bookings b ON b.id = pbp.booking_id
          WHERE b.hostel_id = $1
            AND b.semester_id = $2
            AND pbp.status = 'completed'
            AND pbp.amount > 0
        `
        : `
          SELECT 
            COALESCE(SUM(pbp.amount), 0) AS total_collected,
            COUNT(pbp.id) AS payment_count
          FROM public_booking_payments pbp
          JOIN public_hostel_bookings b ON b.id = pbp.booking_id
          WHERE b.hostel_id = $1
            AND pbp.status = 'completed'
            AND pbp.amount > 0
        `;
      const bookingPaymentsRes = await pool.query(bookingPaymentsQuery, bookingPaymentParams);
      bookingPaymentsTotal = parseFloat(bookingPaymentsRes.rows[0]?.total_collected || '0');
      const paymentCount = parseInt(bookingPaymentsRes.rows[0]?.payment_count || '0', 10);
      
      // Get booking amount_paid separately (for reference only, not for total calculation)
      const bookingAmountPaidQuery = semesterId
        ? `
          SELECT 
            COALESCE(SUM(b.amount_paid), 0) AS amount_paid,
            COALESCE(SUM(GREATEST(b.amount_due - b.amount_paid, 0)), 0) AS outstanding
          FROM public_hostel_bookings b
          WHERE b.hostel_id = $1
            AND b.semester_id = $2
        `
        : `
          SELECT 
            COALESCE(SUM(b.amount_paid), 0) AS amount_paid,
            COALESCE(SUM(GREATEST(b.amount_due - b.amount_paid, 0)), 0) AS outstanding
          FROM public_hostel_bookings b
          WHERE b.hostel_id = $1
        `;
      const bookingAmountPaidRes = await pool.query(bookingAmountPaidQuery, bookingPaymentParams);
      bookingAmountPaidTotal = parseFloat(bookingAmountPaidRes.rows[0]?.amount_paid || '0');
      bookingOutstandingFromPayments = parseFloat(bookingAmountPaidRes.rows[0]?.outstanding || '0');
      
      console.log(`[Booking Payments] Actual payment records: ${paymentCount}, Total: ${bookingPaymentsTotal}, Bookings amount_paid: ${bookingAmountPaidTotal}`);
    }

    const bookingsAggregateQuery = semesterId
      ? `
        SELECT 
          COALESCE(SUM(amount_paid), 0) AS amount_paid,
          COALESCE(SUM(amount_due), 0) AS amount_due,
          COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0) AS outstanding
        FROM public_hostel_bookings
        WHERE hostel_id = $1
          AND semester_id = $2
      `
      : `
        SELECT 
          COALESCE(SUM(amount_paid), 0) AS amount_paid,
          COALESCE(SUM(amount_due), 0) AS amount_due,
          COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0) AS outstanding
        FROM public_hostel_bookings
        WHERE hostel_id = $1
      `;
    const bookingsAggregateParams = semesterId ? [hostelId, semesterId] : [hostelId];
    const bookingsAggregateRes = await pool.query(bookingsAggregateQuery, bookingsAggregateParams);
    const bookingsAmountPaid = parseFloat(bookingsAggregateRes.rows[0]?.amount_paid || '0');
    const bookingsAmountDue = parseFloat(bookingsAggregateRes.rows[0]?.amount_due || '0');
    const bookingsOutstandingTotal = parseFloat(bookingsAggregateRes.rows[0]?.outstanding || '0');

    // Calculate total collected without double counting
    // The issue: When a booking is checked in, a payment is created in 'payments' table
    // AND the booking already has payments in 'public_booking_payments'. This causes double counting.
    
    // Strategy: 
    // 1. Count payments from 'payments' table that are NOT from checked-in bookings
    //    (i.e., exclude payments for students who have checked-in bookings)
    // 2. Count payments from 'public_booking_payments' table (all online booking payments)
    // 3. This way we count each payment only once
    
    // Find payments in 'payments' table that are from checked-in bookings (to exclude them from ledger)
    // These payments duplicate the booking payments already counted in bookingPaymentsTotal
    // Strategy: If a student has payments in public_booking_payments AND their booking is checked_in,
    // then exclude payments in the 'payments' table that match the booking payment amounts
    let checkedInBookingPaymentsInLedger = 0;
    if (hasBookingPaymentsTable) {
      // Better approach: Find payments in 'payments' table where:
      // 1. The student has a checked-in booking
      // 2. The booking has payments in public_booking_payments
      // 3. The payment amount matches one of the booking payment amounts (or sum matches)
      const checkedInPaymentsQuery = paymentInfo.hasHostelIdColumn
        ? (semesterId
          ? `
            SELECT COALESCE(SUM(p.amount), 0) AS total
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            JOIN public_hostel_bookings b ON LOWER(b.student_email) = LOWER(u.email) AND b.hostel_id = $1
            WHERE b.status = 'checked_in'
              AND b.semester_id = $2
              AND p.hostel_id = $1
              ${paymentInfo.hasSemesterIdColumn ? 'AND p.semester_id = $2' : ''}
              AND EXISTS (
                SELECT 1 FROM public_booking_payments pbp
                WHERE pbp.booking_id = b.id
                  AND pbp.status = 'completed'
              )
          `
          : `
            SELECT COALESCE(SUM(p.amount), 0) AS total
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            JOIN public_hostel_bookings b ON LOWER(b.student_email) = LOWER(u.email) AND b.hostel_id = $1
            WHERE b.status = 'checked_in'
              AND p.hostel_id = $1
              AND EXISTS (
                SELECT 1 FROM public_booking_payments pbp
                WHERE pbp.booking_id = b.id
                  AND pbp.status = 'completed'
              )
          `)
        : (semesterId
          ? `
            SELECT COALESCE(SUM(p.amount), 0) AS total
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            JOIN public_hostel_bookings b ON LOWER(b.student_email) = LOWER(u.email) AND b.hostel_id = $1
            WHERE b.status = 'checked_in'
              AND b.semester_id = $2
              AND u.hostel_id = $1
              ${paymentInfo.hasSemesterIdColumn ? 'AND p.semester_id = $2' : ''}
              AND EXISTS (
                SELECT 1 FROM public_booking_payments pbp
                WHERE pbp.booking_id = b.id
                  AND pbp.status = 'completed'
              )
          `
          : `
            SELECT COALESCE(SUM(p.amount), 0) AS total
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            JOIN public_hostel_bookings b ON LOWER(b.student_email) = LOWER(u.email) AND b.hostel_id = $1
            WHERE b.status = 'checked_in'
              AND u.hostel_id = $1
              AND EXISTS (
                SELECT 1 FROM public_booking_payments pbp
                WHERE pbp.booking_id = b.id
                  AND pbp.status = 'completed'
              )
          `);
      const checkedInParams = semesterId ? [hostelId, semesterId] : [hostelId];
      const checkedInRes = await pool.query(checkedInPaymentsQuery, checkedInParams);
      checkedInBookingPaymentsInLedger = parseFloat(checkedInRes.rows[0]?.total || '0');
      
      // Alternative approach: If the above doesn't work, try matching by payment amounts
      // Find payments in 'payments' table where the student has ANY booking with payments
      // This is more aggressive but ensures we don't double count
      if (checkedInBookingPaymentsInLedger === 0 && bookingPaymentsTotal > 0) {
        const alternativeQuery = paymentInfo.hasHostelIdColumn
          ? (semesterId
            ? `
              SELECT COALESCE(SUM(p.amount), 0) AS total
              FROM payments p
              JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
              WHERE p.hostel_id = $1
                ${paymentInfo.hasSemesterIdColumn ? 'AND p.semester_id = $2' : ''}
                AND EXISTS (
                  SELECT 1 FROM public_hostel_bookings b
                  JOIN public_booking_payments pbp ON pbp.booking_id = b.id
                  WHERE LOWER(b.student_email) = LOWER(u.email)
                    AND b.hostel_id = $1
                    ${semesterId ? 'AND b.semester_id = $2' : ''}
                    AND pbp.status = 'completed'
                )
            `
            : `
              SELECT COALESCE(SUM(p.amount), 0) AS total
              FROM payments p
              JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
              WHERE p.hostel_id = $1
                AND EXISTS (
                  SELECT 1 FROM public_hostel_bookings b
                  JOIN public_booking_payments pbp ON pbp.booking_id = b.id
                  WHERE LOWER(b.student_email) = LOWER(u.email)
                    AND b.hostel_id = $1
                    AND pbp.status = 'completed'
                )
            `)
          : (semesterId
            ? `
              SELECT COALESCE(SUM(p.amount), 0) AS total
              FROM payments p
              JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
              WHERE u.hostel_id = $1
                ${paymentInfo.hasSemesterIdColumn ? 'AND p.semester_id = $2' : ''}
                AND EXISTS (
                  SELECT 1 FROM public_hostel_bookings b
                  JOIN public_booking_payments pbp ON pbp.booking_id = b.id
                  WHERE LOWER(b.student_email) = LOWER(u.email)
                    AND b.hostel_id = $1
                    ${semesterId ? 'AND b.semester_id = $2' : ''}
                    AND pbp.status = 'completed'
                )
            `
            : `
              SELECT COALESCE(SUM(p.amount), 0) AS total
              FROM payments p
              JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
              WHERE u.hostel_id = $1
                AND EXISTS (
                  SELECT 1 FROM public_hostel_bookings b
                  JOIN public_booking_payments pbp ON pbp.booking_id = b.id
                  WHERE LOWER(b.student_email) = LOWER(u.email)
                    AND b.hostel_id = $1
                    AND pbp.status = 'completed'
                )
            `);
        const altRes = await pool.query(alternativeQuery, checkedInParams);
        const altTotal = parseFloat(altRes.rows[0]?.total || '0');
        if (altTotal > 0) {
          checkedInBookingPaymentsInLedger = altTotal;
          console.log(`[Alternative Check] Found ${altTotal} in ledger for students with booking payments`);
        }
      }
      
      console.log(`[Checked-in Booking Payments] Found ${checkedInBookingPaymentsInLedger} in ledger to exclude`);
    }
    
    // Total collected = payments table (excluding checked-in booking payments) + booking payments table
    // This ensures we don't double count: booking payments are counted once in bookingPaymentsTotal,
    // and the duplicate payment created during check-in is excluded from ledgerCollected
    // IMPORTANT: We use bookingPaymentsTotal (from public_booking_payments) NOT bookingsAmountPaid (from public_hostel_bookings.amount_paid)
    // because bookingPaymentsTotal represents actual payment records, while amount_paid might include estimates or incorrect values
    // Include online booking fees that exist in bookings table but missing in public_booking_payments (edge/legacy)
    const onlineBookingFeesQuery2 = semesterId
      ? `
        SELECT 
          COALESCE(SUM(b.amount_paid), 0)::numeric - 
          COALESCE(SUM(pbp.amount), 0)::numeric AS total
        FROM public_hostel_bookings b
        LEFT JOIN public_booking_payments pbp ON pbp.booking_id = b.id AND pbp.status = 'completed'
        WHERE b.hostel_id = $1
          AND b.semester_id = $2
          AND b.source = 'online'
          AND b.amount_paid > 0
          AND (pbp.id IS NULL OR pbp.amount IS NULL)
      `
      : `
        SELECT 
          COALESCE(SUM(b.amount_paid), 0)::numeric - 
          COALESCE(SUM(pbp.amount), 0)::numeric AS total
        FROM public_hostel_bookings b
        LEFT JOIN public_booking_payments pbp ON pbp.booking_id = b.id AND pbp.status = 'completed'
        WHERE b.hostel_id = $1
          AND b.source = 'online'
          AND b.amount_paid > 0
          AND (pbp.id IS NULL OR pbp.amount IS NULL)
      `;
    const onlineBookingFeesParams2 = semesterId ? [hostelId, semesterId] : [hostelId];
    const onlineFeesRes2 = await pool.query(onlineBookingFeesQuery2, onlineBookingFeesParams2);
    const onlineBookingFeesTotal2 = Math.max(0, parseFloat(onlineFeesRes2.rows[0]?.total || '0'));

    const total_collected = (ledgerCollected - checkedInBookingPaymentsInLedger) + bookingPaymentsTotal + onlineBookingFeesTotal2;
    
    // Log for debugging (can be removed later)
    console.log(`[Payments Summary] Hostel ${hostelId}, Semester ${semesterId || 'all'}:`);
    console.log(`  - Ledger collected: ${ledgerCollected}`);
    console.log(`  - Checked-in booking payments in ledger (excluded): ${checkedInBookingPaymentsInLedger}`);
    console.log(`  - Booking payments total (from public_booking_payments): ${bookingPaymentsTotal}`);
    console.log(`  - Total collected: ${total_collected}`);

    // Payment method breakdown (ledger + public bookings)
    type RawMethodRow = { method: string | null; total: any };
    let ledgerMethodTotals: RawMethodRow[] = [];
    if (paymentInfo.paymentMethodColumn) {
      const methodColumn = paymentInfo.paymentMethodColumn;
      const ledgerMethodQuery = paymentInfo.hasHostelIdColumn
        ? semesterId
          ? `
            SELECT LOWER(COALESCE(p.${methodColumn}, 'unspecified')) AS method,
                   COALESCE(SUM(p.amount), 0)::numeric AS total
            FROM payments p
            WHERE p.hostel_id = $1
              AND p.semester_id = $2
            GROUP BY LOWER(COALESCE(p.${methodColumn}, 'unspecified'))
          `
          : `
            SELECT LOWER(COALESCE(p.${methodColumn}, 'unspecified')) AS method,
                   COALESCE(SUM(p.amount), 0)::numeric AS total
            FROM payments p
            WHERE p.hostel_id = $1
            GROUP BY LOWER(COALESCE(p.${methodColumn}, 'unspecified'))
          `
        : semesterId
        ? `
          SELECT LOWER(COALESCE(p.${methodColumn}, 'unspecified')) AS method,
                 COALESCE(SUM(p.amount), 0)::numeric AS total
          FROM payments p
          JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
          WHERE u.hostel_id = $1
            AND p.semester_id = $2
          GROUP BY LOWER(COALESCE(p.${methodColumn}, 'unspecified'))
        `
        : `
          SELECT LOWER(COALESCE(p.${methodColumn}, 'unspecified')) AS method,
                 COALESCE(SUM(p.amount), 0)::numeric AS total
          FROM payments p
          JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
          WHERE u.hostel_id = $1
          GROUP BY LOWER(COALESCE(p.${methodColumn}, 'unspecified'))
        `;
      const ledgerMethodParams = paymentInfo.hasHostelIdColumn
        ? semesterId
          ? [hostelId, semesterId]
          : [hostelId]
        : semesterId
        ? [hostelId, semesterId]
        : [hostelId];
      const ledgerMethodRes = await pool.query(ledgerMethodQuery, ledgerMethodParams);
      ledgerMethodTotals = ledgerMethodRes.rows as RawMethodRow[];
    }

    // Get booking payment methods (only if table exists)
    // This includes payments from public_booking_payments table AND online booking fees
    let bookingMethodTotals: RawMethodRow[] = [];
    if (hasBookingPaymentsTable) {
      // Get payments from public_booking_payments table
      // CRITICAL: Only count actual payment records with status='completed' and amount > 0
      const bookingMethodQuery = semesterId
        ? `
          SELECT LOWER(COALESCE(pbp.method, 'unspecified')) AS method,
                 COALESCE(SUM(pbp.amount), 0)::numeric AS total,
                 COUNT(pbp.id) AS payment_count
          FROM public_booking_payments pbp
          JOIN public_hostel_bookings b ON b.id = pbp.booking_id
          WHERE b.hostel_id = $1
            AND b.semester_id = $2
            AND pbp.status = 'completed'
            AND pbp.amount > 0
          GROUP BY LOWER(COALESCE(pbp.method, 'unspecified'))
        `
        : `
          SELECT LOWER(COALESCE(pbp.method, 'unspecified')) AS method,
                 COALESCE(SUM(pbp.amount), 0)::numeric AS total,
                 COUNT(pbp.id) AS payment_count
          FROM public_booking_payments pbp
          JOIN public_hostel_bookings b ON b.id = pbp.booking_id
          WHERE b.hostel_id = $1
            AND pbp.status = 'completed'
            AND pbp.amount > 0
          GROUP BY LOWER(COALESCE(pbp.method, 'unspecified'))
        `;
      const bookingMethodParams = semesterId ? [hostelId, semesterId] : [hostelId];
      const bookingMethodRes = await pool.query(bookingMethodQuery, bookingMethodParams);
      bookingMethodTotals = bookingMethodRes.rows as RawMethodRow[];
      
      // NOTE: Online booking fees are already included in bookingMethodTotals above
      // when we query public_booking_payments. We should NOT add them again from public_hostel_bookings.amount_paid
      // because that would double count. The public_booking_payments table is the source of truth for actual payments.
      // Only add online booking fees if they're NOT already in public_booking_payments (edge case for old data)
      const onlineBookingFeesQuery = semesterId
        ? `
          SELECT 
            COALESCE(SUM(b.amount_paid), 0)::numeric - 
            COALESCE(SUM(pbp.amount), 0)::numeric AS total
          FROM public_hostel_bookings b
          LEFT JOIN public_booking_payments pbp ON pbp.booking_id = b.id AND pbp.status = 'completed'
          WHERE b.hostel_id = $1
            AND b.semester_id = $2
            AND b.source = 'online'
            AND b.amount_paid > 0
            AND (pbp.id IS NULL OR pbp.amount IS NULL)
        `
        : `
          SELECT 
            COALESCE(SUM(b.amount_paid), 0)::numeric - 
            COALESCE(SUM(pbp.amount), 0)::numeric AS total
          FROM public_hostel_bookings b
          LEFT JOIN public_booking_payments pbp ON pbp.booking_id = b.id AND pbp.status = 'completed'
          WHERE b.hostel_id = $1
            AND b.source = 'online'
            AND b.amount_paid > 0
            AND (pbp.id IS NULL OR pbp.amount IS NULL)
        `;
      const onlineBookingFeesParams = semesterId ? [hostelId, semesterId] : [hostelId];
      const onlineBookingFeesRes = await pool.query(onlineBookingFeesQuery, onlineBookingFeesParams);
      const onlineBookingFeesTotal = Math.max(0, parseFloat(onlineBookingFeesRes.rows[0]?.total || '0'));
      
      // Only add online booking fees if they're NOT already recorded in public_booking_payments
      // This handles edge cases where online bookings exist but payment records are missing
      if (onlineBookingFeesTotal > 0) {
        const existingMobileMoney = bookingMethodTotals.find(row => row.method === 'mobile_money');
        if (existingMobileMoney) {
          existingMobileMoney.total = (parseFloat(existingMobileMoney.total?.toString() || '0') + onlineBookingFeesTotal).toString();
        } else {
          bookingMethodTotals.push({
            method: 'mobile_money',
            total: onlineBookingFeesTotal.toString(),
          });
        }
      }
    }

    type MethodAggregate = {
      method: string;
      ledger_total: number;
      booking_total: number;
    };
    const methodTotalsMap = new Map<string, MethodAggregate>();
    const addMethodAmount = (methodRaw: string | null, amount: number, source: 'ledger' | 'booking') => {
      const method = normalizePaymentMethod(methodRaw);
      const existing = methodTotalsMap.get(method) || {
        method,
        ledger_total: 0,
        booking_total: 0,
      };
      if (source === 'ledger') {
        existing.ledger_total += amount;
      } else {
        existing.booking_total += amount;
      }
      methodTotalsMap.set(method, existing);
    };

    // Exclude checked-in booking payments from ledger method totals to avoid double counting
    // We need to subtract the method-specific amounts for checked-in bookings
    let checkedInBookingMethodTotals: RawMethodRow[] = [];
    if (hasBookingPaymentsTable && paymentInfo.paymentMethodColumn) {
      const checkedInMethodQuery = paymentInfo.hasHostelIdColumn
        ? (semesterId
          ? `
            SELECT LOWER(COALESCE(p.${paymentInfo.paymentMethodColumn}, 'unspecified')) AS method,
                   COALESCE(SUM(p.amount), 0)::numeric AS total
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            JOIN public_hostel_bookings b ON LOWER(b.student_email) = LOWER(u.email) AND b.hostel_id = $1
            WHERE b.status = 'checked_in'
              AND b.semester_id = $2
              AND p.hostel_id = $1
              ${paymentInfo.hasSemesterIdColumn ? 'AND p.semester_id = $2' : ''}
            GROUP BY LOWER(COALESCE(p.${paymentInfo.paymentMethodColumn}, 'unspecified'))
          `
          : `
            SELECT LOWER(COALESCE(p.${paymentInfo.paymentMethodColumn}, 'unspecified')) AS method,
                   COALESCE(SUM(p.amount), 0)::numeric AS total
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            JOIN public_hostel_bookings b ON LOWER(b.student_email) = LOWER(u.email) AND b.hostel_id = $1
            WHERE b.status = 'checked_in'
              AND p.hostel_id = $1
            GROUP BY LOWER(COALESCE(p.${paymentInfo.paymentMethodColumn}, 'unspecified'))
          `)
        : (semesterId
          ? `
            SELECT LOWER(COALESCE(p.${paymentInfo.paymentMethodColumn}, 'unspecified')) AS method,
                   COALESCE(SUM(p.amount), 0)::numeric AS total
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            JOIN public_hostel_bookings b ON LOWER(b.student_email) = LOWER(u.email) AND b.hostel_id = $1
            WHERE b.status = 'checked_in'
              AND b.semester_id = $2
              AND u.hostel_id = $1
              ${paymentInfo.hasSemesterIdColumn ? 'AND p.semester_id = $2' : ''}
            GROUP BY LOWER(COALESCE(p.${paymentInfo.paymentMethodColumn}, 'unspecified'))
          `
          : `
            SELECT LOWER(COALESCE(p.${paymentInfo.paymentMethodColumn}, 'unspecified')) AS method,
                   COALESCE(SUM(p.amount), 0)::numeric AS total
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            JOIN public_hostel_bookings b ON LOWER(b.student_email) = LOWER(u.email) AND b.hostel_id = $1
            WHERE b.status = 'checked_in'
              AND u.hostel_id = $1
            GROUP BY LOWER(COALESCE(p.${paymentInfo.paymentMethodColumn}, 'unspecified'))
          `);
      const checkedInMethodParams = semesterId ? [hostelId, semesterId] : [hostelId];
      const checkedInMethodRes = await pool.query(checkedInMethodQuery, checkedInMethodParams);
      checkedInBookingMethodTotals = checkedInMethodRes.rows as RawMethodRow[];
    }
    
    // Subtract checked-in booking payments from ledger totals
    const adjustedLedgerTotals = ledgerMethodTotals.map((row) => {
      const ledgerAmount = Number.parseFloat((row.total ?? 0).toString());
      const checkedInAmount = Number.parseFloat(
        (checkedInBookingMethodTotals.find((c) => c.method === row.method)?.total ?? 0).toString()
      );
      return {
        ...row,
        total: (ledgerAmount - checkedInAmount).toString(),
      };
    });
    
    adjustedLedgerTotals.forEach((row) => {
      const amount = Number.parseFloat((row.total ?? 0).toString());
      if (Number.isFinite(amount) && amount > 0) {
        addMethodAmount(row.method, amount, 'ledger');
      }
    });
    bookingMethodTotals.forEach((row) => {
      const amount = Number.parseFloat((row.total ?? 0).toString());
      if (Number.isFinite(amount) && amount !== 0) {
        addMethodAmount(row.method, amount, 'booking');
      }
    });

    const paymentMethodBreakdown = Array.from(methodTotalsMap.values())
      .map((entry) => {
        const total = entry.ledger_total + entry.booking_total;
        return {
          method: entry.method,
          label: getPaymentMethodLabel(entry.method),
          ledger_total: entry.ledger_total,
          booking_total: entry.booking_total,
          total,
        };
      })
      .sort((a, b) => b.total - a.total);

    const ledgerMethodSum = paymentMethodBreakdown.reduce(
      (sum, entry) => sum + entry.ledger_total,
      0,
    );
    const bookingMethodSum = paymentMethodBreakdown.reduce(
      (sum, entry) => sum + entry.booking_total,
      0,
    );
    const paymentMethodCombinedTotal = ledgerMethodSum + bookingMethodSum;

    // Per-student expected vs paid (with optional semester filtering)
    const assignmentFilter = semesterId && sraInfo.hasSemesterColumn ? 'AND sra.semester_id = $2' : '';
    const buildSemesterFilter = (alias: string) =>
      semesterId && paymentInfo.hasSemesterIdColumn ? `AND ${alias}.semester_id = $3` : '';
    
    let paidSubquery: string;
    if (paymentInfo.hasHostelIdColumn) {
      const alias = 'p';
      paidSubquery = `
        SELECT ${alias}.${paymentInfo.userIdColumn} AS user_id, COALESCE(SUM(${alias}.amount),0)::numeric AS paid
        FROM payments ${alias}
        WHERE ${alias}.hostel_id = $1
        ${buildSemesterFilter(alias)}
        GROUP BY ${alias}.${paymentInfo.userIdColumn}
      `;
    } else {
      paidSubquery = `
        SELECT p.${paymentInfo.userIdColumn} AS user_id, COALESCE(SUM(p.amount),0)::numeric AS paid
        FROM payments p
        JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
        WHERE u.hostel_id = $1
        ${buildSemesterFilter('p')}
        GROUP BY p.${paymentInfo.userIdColumn}
      `;
    }
    
    // Check if student_profiles table exists, otherwise use students table
    const studentProfilesCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'student_profiles'
    `);
    const hasStudentProfiles = studentProfilesCheck.rows.length > 0;
    
    // Build the student profile join based on which table exists
    let studentProfileJoin: string;
    let studentProfileSelect: string;
    
    if (hasStudentProfiles) {
      // Use student_profiles table
      studentProfileJoin = 'LEFT JOIN student_profiles sp ON sp.user_id = u.id';
      studentProfileSelect = 'sp.access_number, sp.phone, sp.whatsapp';
    } else {
      // Use students table (fallback)
      studentProfileJoin = 'LEFT JOIN students s ON s.user_id = u.id';
      studentProfileSelect = 's.access_number, s.phone_number AS phone, NULL AS whatsapp';
    }
    
    const queryParams = semesterId
      ? [hostelId, semesterId, semesterId, hostelId]
      : [hostelId, hostelId];
    
    const rowsRes = await pool.query(
      injectRoomPrice(`WITH active_assignment AS (
        SELECT sra.${sraInfo.userIdColumn} AS user_id, ${roomPriceForSingle} AS expected, rm.room_number
        FROM student_room_assignments sra
        JOIN rooms rm ON rm.id = sra.room_id
        WHERE sra.status = 'active' AND rm.hostel_id = $1
        ${assignmentFilter}
      ),
      paid AS (
        ${paidSubquery}
      )
      SELECT u.id AS user_id, u.name, u.email,
             ${studentProfileSelect},
             aa.expected, aa.room_number,
             COALESCE(p.paid, 0)::numeric AS paid,
             CASE WHEN aa.expected IS NULL THEN NULL ELSE (aa.expected - COALESCE(p.paid,0))::numeric END AS balance
      FROM users u
      ${studentProfileJoin}
      LEFT JOIN active_assignment aa ON aa.user_id = u.id
      LEFT JOIN paid p ON p.user_id = u.id
      WHERE u.role = 'user' AND u.hostel_id = ${semesterId ? '$4' : '$2'}
      ORDER BY u.name ASC`),
      queryParams
    );

    let students = rowsRes.rows.map(r => ({
      user_id: r.user_id,
      name: r.name,
      email: r.email,
      access_number: r.access_number || null,
      phone: r.phone || null,
      whatsapp: r.whatsapp || null,
      room_number: r.room_number || null,
      expected: r.expected !== null ? parseFloat(r.expected) : null,
      paid: parseFloat(r.paid || 0),
      balance: r.balance !== null ? parseFloat(r.balance) : null,
      status: r.expected === null ? 'unassigned' : (parseFloat(r.paid || 0) >= parseFloat(r.expected || 0) ? 'paid' : (parseFloat(r.paid || 0) > 0 ? 'partial' : 'unpaid'))
    }));

    let matchedBookingPaymentsTotal = 0;
    if (bookingPaymentsTotal > 0 && hasBookingPaymentsTable) {
      const bookingPaidByUserQuery = semesterId
        ? `
          SELECT u.id AS user_id, COALESCE(SUM(pbp.amount), 0)::numeric AS paid
          FROM public_booking_payments pbp
          JOIN public_hostel_bookings b ON b.id = pbp.booking_id
          JOIN users u ON u.hostel_id = b.hostel_id
            AND b.student_email IS NOT NULL
            AND LOWER(u.email) = LOWER(b.student_email)
          WHERE b.hostel_id = $1
            AND b.semester_id = $2
            AND pbp.status = 'completed'
          GROUP BY u.id
        `
        : `
          SELECT u.id AS user_id, COALESCE(SUM(pbp.amount), 0)::numeric AS paid
          FROM public_booking_payments pbp
          JOIN public_hostel_bookings b ON b.id = pbp.booking_id
          JOIN users u ON u.hostel_id = b.hostel_id
            AND b.student_email IS NOT NULL
            AND LOWER(u.email) = LOWER(b.student_email)
          WHERE b.hostel_id = $1
            AND pbp.status = 'completed'
          GROUP BY u.id
        `;
      const bookingPaidByUserParams = semesterId ? [hostelId, semesterId] : [hostelId];
      const bookingPaidByUserRes = await pool.query(
        bookingPaidByUserQuery,
        bookingPaidByUserParams,
      );
      const bookingPaidMap = new Map<number, number>();
      bookingPaidByUserRes.rows.forEach((row: any) => {
        const amount = parseFloat(row.paid || 0);
        if (Number.isFinite(amount) && amount > 0) {
          bookingPaidMap.set(row.user_id, amount);
          matchedBookingPaymentsTotal += amount;
        }
      });

      if (bookingPaidMap.size > 0) {
        students = students.map((student) => {
          const extra = bookingPaidMap.get(student.user_id) || 0;
          if (!extra) return student;
          const basePaid = Number(student.paid ?? 0);
          const updatedPaid = basePaid + extra;
          const expected = student.expected ?? null;
          const recalculatedBalance =
            expected !== null ? Math.max(expected - updatedPaid, 0) : student.balance;
          let status = student.status;
          if (expected !== null) {
            if (updatedPaid >= expected) status = 'paid';
            else if (updatedPaid > 0) status = 'partial';
            else status = 'unpaid';
          }
          return {
            ...student,
            paid: updatedPaid,
            balance: recalculatedBalance,
            status,
          };
        });
      }
    }

    const outstandingFromAssignments = students.reduce(
      (sum, s) => sum + (s.balance && s.balance > 0 ? s.balance : 0),
      0,
    );
    const total_outstanding = bookingsOutstandingTotal || outstandingFromAssignments;
    const unlinkedBookingPayments = Math.max(
      0,
      bookingPaymentsTotal - matchedBookingPaymentsTotal,
    );

    // Ensure payment method breakdown totals match total_collected
    // If there's a discrepancy, adjust the breakdown proportionally or add an "other" category
    const methodBreakdownTotal = paymentMethodBreakdown.reduce((sum, item) => sum + item.total, 0);
    const discrepancy = total_collected - methodBreakdownTotal;
    
    // If there's a discrepancy, add it as "unspecified" or adjust
    if (Math.abs(discrepancy) > 0.01) {
      const existingUnspecified = paymentMethodBreakdown.find(item => item.method === 'unspecified');
      if (existingUnspecified) {
        existingUnspecified.total += discrepancy;
        existingUnspecified.booking_total += discrepancy;
      } else {
        paymentMethodBreakdown.push({
          method: 'unspecified',
          label: 'Unspecified / Other',
          ledger_total: 0,
          booking_total: discrepancy,
          total: discrepancy,
        });
      }
    }

    const payload = {
      total_collected,
      total_outstanding,
      students,
      booking_payments_total: bookingPaymentsTotal,
      bookings_amount_paid: bookingsAmountPaid,
      bookings_amount_due: bookingsAmountDue,
      bookings_outstanding_total: bookingsOutstandingTotal,
      unlinked_booking_payments: unlinkedBookingPayments,
      payment_methods: {
        items: paymentMethodBreakdown,
        ledger_total: ledgerMethodSum,
        booking_total: bookingMethodSum,
        combined_total: total_collected, // Use actual total_collected instead of calculated sum
        reconciliation: {
          method_breakdown_total: methodBreakdownTotal,
          actual_total_collected: total_collected,
          discrepancy: discrepancy,
        },
        notes: {
          ledger_reported_total: ledgerCollected,
          booking_payments_reported_total: bookingPaymentsTotal,
          bookings_amount_paid_total: bookingsAmountPaid,
        },
      },
    };
    summaryCache.set(hostelId, { data: payload, expiresAt: now + SUMMARY_TTL_MS });
    res.json({ success: true, data: payload });
  } catch (e) {
    console.error('Payments summary error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Semester-level payment history for a hostel
router.get('/summary/semesters', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let hostelId: number | null = null;
    if (currentUser.role === 'super_admin') {
      hostelId = req.query.hostel_id ? Number(req.query.hostel_id) : null;
      if (!hostelId) return res.status(400).json({ success: false, message: 'hostel_id is required for super_admin' });
    } else {
      hostelId = await resolveHostelIdForUser(currentUser.id, currentUser.role);
    }
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const paymentInfo = await getPaymentTableInfo();
    const sraInfo = await getStudentRoomAssignmentInfo();
    const { sumExpr: roomPriceForSum } = await getRoomPriceExpressions();
    const injectRoomPrice = createRoomPriceInjector(roomPriceForSum);

    const paymentTotalsCte = paymentInfo.hasHostelIdColumn
      ? `
        SELECT semester_id, COALESCE(SUM(amount),0)::numeric AS total_collected
        FROM payments
        WHERE hostel_id = $1
        GROUP BY semester_id
      `
      : `
        SELECT p.semester_id, COALESCE(SUM(p.amount),0)::numeric AS total_collected
        FROM payments p
        JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
        WHERE u.hostel_id = $1
        GROUP BY p.semester_id
      `;

    const publicBookingsExistsResult = await pool.query(
      "SELECT to_regclass('public.public_hostel_bookings') AS table_ref",
    );
    const hasPublicBookingsTable = Boolean(publicBookingsExistsResult.rows[0]?.table_ref);

    const bookingTotalsCte = hasPublicBookingsTable
      ? `
      SELECT 
        semester_id,
        COALESCE(SUM(amount_paid),0)::numeric AS total_collected,
        COALESCE(SUM(amount_due),0)::numeric AS total_expected,
        COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)),0)::numeric AS total_outstanding
      FROM public_hostel_bookings
      WHERE hostel_id = $1
      GROUP BY semester_id
    `
      : `
      SELECT
        NULL::INTEGER AS semester_id,
        0::numeric AS total_collected,
        0::numeric AS total_expected,
        0::numeric AS total_outstanding
      WHERE 1 = 0
    `;

    const expectedTotalsCte = `
      SELECT sra.semester_id, COALESCE(SUM(${roomPriceForSum}),0) AS total_expected
      FROM student_room_assignments sra
      JOIN rooms rm ON rm.id = sra.room_id
      WHERE rm.hostel_id = $1
        AND sra.status IN ('active','completed')
      GROUP BY sra.semester_id
    `;

    const semestersRes = await pool.query(
      `
        WITH payment_totals AS (
          ${paymentTotalsCte}
        ),
        booking_totals AS (
          ${bookingTotalsCte}
        ),
        expected_totals AS (
          ${expectedTotalsCte}
        )
        SELECT se.id,
               se.name,
               se.academic_year,
               se.start_date,
               se.end_date,
               se.is_current,
               (COALESCE(pt.total_collected,0)::numeric + COALESCE(bt.total_collected,0)::numeric) AS total_collected,
               (COALESCE(et.total_expected,0)::numeric + COALESCE(bt.total_expected,0)::numeric) AS total_expected,
               (COALESCE(et.total_expected,0)::numeric + COALESCE(bt.total_expected,0)::numeric - (COALESCE(pt.total_collected,0)::numeric + COALESCE(bt.total_collected,0)::numeric)) AS outstanding,
               COALESCE(bt.total_outstanding,0)::numeric AS booking_outstanding
        FROM semesters se
        LEFT JOIN payment_totals pt ON pt.semester_id = se.id
        LEFT JOIN booking_totals bt ON bt.semester_id = se.id
        LEFT JOIN expected_totals et ON et.semester_id = se.id
        WHERE se.hostel_id = $1
        ORDER BY se.start_date DESC, se.id DESC
      `,
      [hostelId]
    );

    const semesters = semestersRes.rows.map((row) => ({
      semester_id: row.id,
      name: row.name,
      academic_year: row.academic_year,
      start_date: row.start_date,
      end_date: row.end_date,
      is_current: row.is_current,
      total_collected: parseFloat(row.total_collected || 0),
      total_expected: parseFloat(row.total_expected || 0),
      outstanding: parseFloat(row.outstanding || 0),
      booking_outstanding: parseFloat(row.booking_outstanding || 0),
    }));

    const current = semesters.find((s) => s.is_current) || null;

    res.json({
      success: true,
      data: {
        current,
        history: semesters,
      },
    });
  } catch (e) {
    console.error('Payments semester summary error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Global summary for super admins across all hostels
router.get('/summary/global', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (currentUser.role !== 'super_admin') return res.status(403).json({ success: false, message: 'Forbidden' });

    const paymentInfo = await getPaymentTableInfo();
    const { sumExpr: roomPriceForSum } = await getRoomPriceExpressions();

    const paymentTotalsCte = paymentInfo.hasHostelIdColumn
      ? `
        SELECT hostel_id, COALESCE(SUM(amount),0)::numeric AS total_collected
        FROM payments
        WHERE hostel_id IS NOT NULL
        GROUP BY hostel_id
      `
      : `
        SELECT u.hostel_id, COALESCE(SUM(p.amount),0)::numeric AS total_collected
        FROM payments p
        JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
        WHERE u.hostel_id IS NOT NULL
        GROUP BY u.hostel_id
      `;

    const publicBookingsExistsResult = await pool.query(
      "SELECT to_regclass('public.public_hostel_bookings') AS table_ref",
    );
    const hasPublicBookingsTable = Boolean(publicBookingsExistsResult.rows[0]?.table_ref);

    const bookingTotalsCte = hasPublicBookingsTable
      ? `
      SELECT 
        hostel_id, 
        COALESCE(SUM(amount_paid),0)::numeric AS total_collected,
        COALESCE(SUM(amount_due),0)::numeric AS total_expected,
        COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)),0)::numeric AS total_outstanding
      FROM public_hostel_bookings
      WHERE hostel_id IS NOT NULL
      GROUP BY hostel_id
    `
      : `
      SELECT
        NULL::INTEGER AS hostel_id,
        0::numeric AS total_collected,
        0::numeric AS total_expected,
        0::numeric AS total_outstanding
      WHERE 1 = 0
    `;

    const expectedTotalsCte = `
      SELECT rm.hostel_id, COALESCE(SUM(${roomPriceForSum}),0) AS total_expected
      FROM student_room_assignments sra
      JOIN rooms rm ON rm.id = sra.room_id
      WHERE rm.hostel_id IS NOT NULL
        AND sra.status IN ('active','completed')
      GROUP BY rm.hostel_id
    `;

    const currentSemestersCte = `
      SELECT hostel_id, id AS semester_id, name, academic_year
      FROM semesters
      WHERE is_current = true
    `;

    const currentPaymentTotalsCte = paymentInfo.hasHostelIdColumn
      ? `
        SELECT cs.hostel_id, COALESCE(SUM(p.amount),0)::numeric AS total_collected
        FROM current_semesters cs
        JOIN payments p ON p.hostel_id = cs.hostel_id AND p.semester_id = cs.semester_id
        GROUP BY cs.hostel_id
      `
      : `
        SELECT cs.hostel_id, COALESCE(SUM(p.amount),0)::numeric AS total_collected
        FROM current_semesters cs
        JOIN payments p ON p.semester_id = cs.semester_id
        JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
        WHERE u.hostel_id = cs.hostel_id
        GROUP BY cs.hostel_id
      `;

    const currentBookingTotalsCte = hasPublicBookingsTable
      ? `
      SELECT 
        cs.hostel_id, 
        COALESCE(SUM(b.amount_paid),0)::numeric AS total_collected,
        COALESCE(SUM(b.amount_due),0)::numeric AS total_expected,
        COALESCE(SUM(GREATEST(b.amount_due - b.amount_paid, 0)),0)::numeric AS total_outstanding
      FROM current_semesters cs
      JOIN public_hostel_bookings b ON b.semester_id = cs.semester_id AND b.hostel_id = cs.hostel_id
      GROUP BY cs.hostel_id
    `
      : `
      SELECT
        NULL::INTEGER AS hostel_id,
        0::numeric AS total_collected,
        0::numeric AS total_expected,
        0::numeric AS total_outstanding
      WHERE 1 = 0
    `;

    const currentExpectedTotalsCte = `
      SELECT cs.hostel_id, COALESCE(SUM(${roomPriceForSum}),0) AS total_expected
      FROM current_semesters cs
      JOIN student_room_assignments sra ON sra.semester_id = cs.semester_id
      JOIN rooms rm ON rm.id = sra.room_id
      WHERE sra.status IN ('active','completed')
      GROUP BY cs.hostel_id
    `;

    const globalRes = await pool.query(`
      WITH payment_totals AS (
        ${paymentTotalsCte}
      ),
      expected_totals AS (
        ${expectedTotalsCte}
      ),
      current_semesters AS (
        ${currentSemestersCte}
      ),
      current_payment_totals AS (
        ${currentPaymentTotalsCte}
      ),
      current_expected_totals AS (
        ${currentExpectedTotalsCte}
      ),
      booking_totals AS (
        ${bookingTotalsCte}
      ),
      current_booking_totals AS (
        ${currentBookingTotalsCte}
      )
      SELECT h.id,
             h.name,
             (COALESCE(pt.total_collected,0)::numeric + COALESCE(bt.total_collected,0)::numeric) AS total_collected,
             (COALESCE(et.total_expected,0)::numeric + COALESCE(bt.total_expected,0)::numeric) AS total_expected,
             (COALESCE(et.total_expected,0)::numeric + COALESCE(bt.total_expected,0)::numeric - (COALESCE(pt.total_collected,0)::numeric + COALESCE(bt.total_collected,0)::numeric)) AS outstanding,
             COALESCE(bt.total_outstanding,0)::numeric AS booking_outstanding,
             cs.semester_id AS current_semester_id,
             cs.name AS current_semester_name,
             cs.academic_year AS current_semester_academic_year,
             (COALESCE(cpt.total_collected,0)::numeric + COALESCE(cbt.total_collected,0)::numeric) AS current_total_collected,
             (COALESCE(cet.total_expected,0)::numeric + COALESCE(cbt.total_expected,0)::numeric) AS current_total_expected,
             (COALESCE(cet.total_expected,0)::numeric + COALESCE(cbt.total_expected,0)::numeric - (COALESCE(cpt.total_collected,0)::numeric + COALESCE(cbt.total_collected,0)::numeric)) AS current_outstanding,
             COALESCE(cbt.total_outstanding,0)::numeric AS current_booking_outstanding
      FROM hostels h
      LEFT JOIN payment_totals pt ON pt.hostel_id = h.id
      LEFT JOIN booking_totals bt ON bt.hostel_id = h.id
      LEFT JOIN expected_totals et ON et.hostel_id = h.id
      LEFT JOIN current_semesters cs ON cs.hostel_id = h.id
      LEFT JOIN current_payment_totals cpt ON cpt.hostel_id = h.id
      LEFT JOIN current_expected_totals cet ON cet.hostel_id = h.id
      LEFT JOIN current_booking_totals cbt ON cbt.hostel_id = h.id
      ORDER BY h.name ASC
    `);

    const hostels = globalRes.rows.map((row) => {
      const totalCollected = parseFloat(row.total_collected || 0);
      const totalExpected = parseFloat(row.total_expected || 0);
      const outstanding = parseFloat(row.outstanding || 0);
      const currentCollected = parseFloat(row.current_total_collected || 0);
      const currentExpected = parseFloat(row.current_total_expected || 0);
      const currentOutstanding = parseFloat(row.current_outstanding || 0);
      const bookingOutstanding = parseFloat(row.booking_outstanding || 0);
      const currentBookingOutstanding = parseFloat(row.current_booking_outstanding || 0);

      return {
        hostel_id: row.id,
        hostel_name: row.name,
        totals: {
          collected: totalCollected,
          expected: totalExpected,
          outstanding,
          booking_outstanding: bookingOutstanding,
        },
        current_semester: row.current_semester_id
          ? {
              semester_id: row.current_semester_id,
              name: row.current_semester_name,
              academic_year: row.current_semester_academic_year,
              collected: currentCollected,
              expected: currentExpected,
              outstanding: currentOutstanding,
              booking_outstanding: currentBookingOutstanding,
            }
          : null,
      };
    });

    const overall = hostels.reduce(
      (acc, hostel) => {
        acc.collected += hostel.totals.collected;
        acc.expected += hostel.totals.expected;
        acc.outstanding += hostel.totals.outstanding;
        if (hostel.current_semester) {
          acc.current_collected += hostel.current_semester.collected;
          acc.current_expected += hostel.current_semester.expected;
          acc.current_outstanding += hostel.current_semester.outstanding;
        }
        return acc;
      },
      {
        collected: 0,
        expected: 0,
        outstanding: 0,
        current_collected: 0,
        current_expected: 0,
        current_outstanding: 0,
      }
    );

    res.json({
      success: true,
      data: {
        overall,
        hostels,
      },
    });
  } catch (e) {
    console.error('Payments global summary error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// List payments (super_admin may pass ?hostel_id=...)
router.get('/', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let hostelId: number | null = null;
    if (currentUser.role === 'super_admin') {
      hostelId = req.query.hostel_id ? Number(req.query.hostel_id) : null;
      if (!hostelId) return res.status(400).json({ success: false, message: 'hostel_id is required for super_admin' });
    } else {
      hostelId = await resolveHostelIdForUser(currentUser.id, currentUser.role);
    }
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const search = (req.query.search as string | undefined)?.trim().toLowerCase();
    const userIdFilter = req.query.user_id ? Number(req.query.user_id) : undefined;
    const semesterId = req.query.semester_id ? Number(req.query.semester_id) : null;

    // Pagination with sane defaults/caps
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limitRaw = Math.max(1, parseInt((req.query.limit as string) || '20', 10));
    const limit = Math.min(100, limitRaw);
    const offset = (page - 1) * limit;

    const paymentsColumnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'payments'
    `);
    const paymentColumns = paymentsColumnsRes.rows.map(r => r.column_name);
    const paymentUserIdColumn = paymentColumns.includes('user_id')
      ? 'user_id'
      : paymentColumns.includes('student_id')
        ? 'student_id'
        : 'user_id';
    const hasHostelIdColumn = paymentColumns.includes('hostel_id');
    const hasSemesterIdColumn = paymentColumns.includes('semester_id');
    const purposeColumn = paymentColumns.includes('purpose')
      ? 'purpose'
      : paymentColumns.includes('notes')
        ? 'notes'
        : null;
    const purposeSelect = purposeColumn ? `p.${purposeColumn}` : 'NULL';

    const params: any[] = [hostelId];
    let paramIndex = 2;
    const where: string[] = [hasHostelIdColumn ? 'p.hostel_id = $1' : 'u.hostel_id = $1'];

    if (semesterId !== null) {
      if (!hasSemesterIdColumn) {
        return res.status(400).json({ success: false, message: 'Semester filtering is not supported because payments.semester_id column is missing' });
      }
      where.push(`p.semester_id = $${paramIndex}`);
      params.push(semesterId);
      paramIndex++;
    }

    if (typeof userIdFilter === 'number' && !Number.isNaN(userIdFilter)) {
      where.push(`p.${paymentUserIdColumn} = $${paramIndex}`);
      params.push(userIdFilter);
      paramIndex++;
    }

    if (search) {
      const searchConditions = [
        `LOWER(u.name) LIKE $${paramIndex}`,
        `LOWER(u.email) LIKE $${paramIndex}`,
      ];
      if (purposeColumn) {
        searchConditions.push(`LOWER(p.${purposeColumn}) LIKE $${paramIndex}`);
      }
      where.push(`(${searchConditions.join(' OR ')})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const query = `
      SELECT p.id,
             p.${paymentUserIdColumn} AS user_id,
             p.amount,
             p.currency,
             ${purposeSelect} AS purpose,
             p.created_at,
             u.name as student_name,
             u.email as student_email
      FROM payments p
      JOIN users u ON u.id = p.${paymentUserIdColumn}
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows, page, limit });
  } catch (e) {
    console.error('List payments error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.get('/summary/hostel', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let hostelId: number | null = await resolveHostelIdForUser(currentUser.id, currentUser.role);
    if (currentUser.role === 'super_admin' && req.query.hostel_id) {
      hostelId = Number(req.query.hostel_id);
    }

    if (!hostelId) {
      return res.status(403).json({ success: false, message: 'Hostel scope required' });
    }

    const monthsParam = Number(req.query.months);
    const months = Number.isFinite(monthsParam) && monthsParam > 0 ? Math.min(Math.trunc(monthsParam), 12) : 6;
    const paymentInfo = await getPaymentTableInfo();
    const sraInfo = await getStudentRoomAssignmentInfo();
    const assignmentDateExpr = buildAssignmentDateExpression(sraInfo);

    const expensesColumnsRes = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'expenses'
      `
    );
    const expenseColumns = new Set(expensesColumnsRes.rows.map((row) => row.column_name));
    const hasExpensesTable = expenseColumns.size > 0;
    const hasSpentAtColumn = expenseColumns.has('spent_at');
    const hasExpenseDateColumn = expenseColumns.has('expense_date');
    const hasCreatedAtColumn = expenseColumns.has('created_at');
    const expenseDateExpr = hasSpentAtColumn
      ? 'COALESCE(e.spent_at, CURRENT_DATE)'
      : hasExpenseDateColumn
      ? 'COALESCE(e.expense_date, CURRENT_DATE)'
      : hasCreatedAtColumn
      ? 'COALESCE(e.created_at, CURRENT_DATE)'
      : 'CURRENT_DATE';

    const dateExpr = buildPaymentDateExpression(paymentInfo);
    const totalCollectedQuery = paymentInfo.hasHostelIdColumn
      ? `SELECT COALESCE(SUM(amount),0)::numeric AS total FROM payments WHERE hostel_id = $1`
      : `SELECT COALESCE(SUM(p.amount),0)::numeric AS total
         FROM payments p
         JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
         WHERE u.hostel_id = $1`;

    const { sumExpr: roomPriceForSum } = await getRoomPriceExpressions();
    const injectRoomPrice = createRoomPriceInjector(roomPriceForSum);

    const [
      totalCollectedRes,
      totalExpectedRes,
      currentSemesterRes,
      paymentsTrendRes,
      expectedTrendRes,
      expensesTrendRes,
      expensesTotalRes,
      topCollectorsRes,
      outstandingStudentsRes,
    ] = await Promise.all([
      pool.query(totalCollectedQuery, [hostelId]),
      pool.query(
        injectRoomPrice(
          `
         SELECT COALESCE(SUM(__ROOM_PRICE_SUM__),0) AS total
         FROM student_room_assignments sra
         JOIN rooms rm ON rm.id = sra.room_id
         WHERE rm.hostel_id = $1
           AND sra.status IN ('active','completed')`
        ),
        [hostelId]
      ),
      pool.query(
        `SELECT id, name, academic_year
         FROM semesters
         WHERE hostel_id = $1
           AND is_current = true
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
        [hostelId]
      ),
      pool.query(
        paymentInfo.hasHostelIdColumn
          ? `
            SELECT to_char(date_trunc('month', ${dateExpr}), 'YYYY-MM') AS period,
                   SUM(p.amount)::numeric AS collected
            FROM payments p
            WHERE p.hostel_id = $1
              AND ${dateExpr} >= date_trunc('month', CURRENT_DATE) - INTERVAL '${months - 1} month'
            GROUP BY period
            ORDER BY period ASC
          `
          : `
            SELECT to_char(date_trunc('month', ${dateExpr}), 'YYYY-MM') AS period,
                   SUM(p.amount)::numeric AS collected
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            WHERE u.hostel_id = $1
              AND ${dateExpr} >= date_trunc('month', CURRENT_DATE) - INTERVAL '${months - 1} month'
            GROUP BY period
            ORDER BY period ASC
          `,
        [hostelId]
      ),
      pool.query(
        injectRoomPrice(
          `
          SELECT to_char(date_trunc('month', ${assignmentDateExpr}), 'YYYY-MM') AS period,
                 COALESCE(SUM(__ROOM_PRICE_SUM__),0)::numeric AS expected
          FROM student_room_assignments sra
          JOIN rooms rm ON rm.id = sra.room_id
          WHERE rm.hostel_id = $1
            AND sra.status IN ('active','completed')
            AND ${assignmentDateExpr} >= date_trunc('month', CURRENT_DATE) - INTERVAL '${months - 1} month'
          GROUP BY period
          ORDER BY period ASC
        `
        ),
        [hostelId]
      ),
      hasExpensesTable
        ? pool.query(
            `
              SELECT to_char(date_trunc('month', ${expenseDateExpr}), 'YYYY-MM') AS period,
                     SUM(e.amount)::numeric AS expenses
              FROM expenses e
              WHERE e.hostel_id = $1
                AND ${expenseDateExpr} >= date_trunc('month', CURRENT_DATE) - INTERVAL '${months - 1} month'
              GROUP BY period
              ORDER BY period ASC
            `,
            [hostelId]
          )
        : Promise.resolve({ rows: [] }),
      hasExpensesTable
        ? pool.query(`SELECT COALESCE(SUM(amount)::numeric,0) AS total FROM expenses WHERE hostel_id = $1`, [hostelId])
        : Promise.resolve({ rows: [{ total: 0 }] }),
      pool.query(
        paymentInfo.hasHostelIdColumn
          ? `
            SELECT u.name, u.email, SUM(p.amount)::numeric AS total_paid
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            WHERE p.hostel_id = $1
            GROUP BY u.id, u.name, u.email
            ORDER BY total_paid DESC
            LIMIT 5
          `
          : `
            SELECT u.name, u.email, SUM(p.amount)::numeric AS total_paid
            FROM payments p
            JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
            WHERE u.hostel_id = $1
            GROUP BY u.id, u.name, u.email
            ORDER BY total_paid DESC
            LIMIT 5
          `,
        [hostelId]
      ),
      pool.query(
        paymentInfo.hasHostelIdColumn
          ? injectRoomPrice(
              `
            SELECT u.name,
                   u.email,
                   COALESCE(SUM(__ROOM_PRICE_SUM__),0) - COALESCE(SUM(p.amount)::numeric,0) AS outstanding
            FROM student_room_assignments sra
            JOIN rooms rm ON rm.id = sra.room_id
            JOIN users u ON u.id = sra.${sraInfo.userIdColumn}
            LEFT JOIN payments p ON p.${paymentInfo.userIdColumn} = u.id
            WHERE rm.hostel_id = $1
              AND sra.status IN ('active','completed')
            GROUP BY u.id, u.name, u.email
            HAVING COALESCE(SUM(__ROOM_PRICE_SUM__),0) - COALESCE(SUM(p.amount)::numeric,0) > 0
            ORDER BY outstanding DESC
            LIMIT 5
          `)
          : injectRoomPrice(
              `
            SELECT u.name,
                   u.email,
                   COALESCE(SUM(__ROOM_PRICE_SUM__),0) - COALESCE(SUM(p.amount)::numeric,0) AS outstanding
            FROM student_room_assignments sra
            JOIN rooms rm ON rm.id = sra.room_id
            JOIN users u ON u.id = sra.${sraInfo.userIdColumn}
            LEFT JOIN payments p ON p.${paymentInfo.userIdColumn} = u.id
            WHERE rm.hostel_id = $1
              AND sra.status IN ('active','completed')
            GROUP BY u.id, u.name, u.email
            HAVING COALESCE(SUM(__ROOM_PRICE_SUM__),0) - COALESCE(SUM(p.amount)::numeric,0) > 0
            ORDER BY outstanding DESC
            LIMIT 5
          `),
        [hostelId]
      ),
    ]);

    const totalCollectedRow = totalCollectedRes.rows[0] as { total?: number | string } | undefined;
    const totalExpectedRow = totalExpectedRes.rows[0] as { total?: number | string } | undefined;
    const totalCollected = parseFloat(totalCollectedRow?.total?.toString() ?? '0');
    const totalExpected = parseFloat(totalExpectedRow?.total?.toString() ?? '0');
    const totalOutstanding = totalExpected - totalCollected;
    const totalExpenses = parseFloat(expensesTotalRes.rows[0]?.total || 0);
    const netRevenue = totalCollected - totalExpenses;

    const currentSemesterRow = currentSemesterRes.rows[0] || null;

    let currentCollected = 0;
    let currentExpected = 0;

    if (currentSemesterRow) {
      const currentCollectedQuery = paymentInfo.hasHostelIdColumn
        ? `SELECT COALESCE(SUM(amount),0)::numeric AS total FROM payments WHERE hostel_id = $1 AND semester_id = $2`
        : `SELECT COALESCE(SUM(p.amount),0)::numeric AS total
           FROM payments p
           JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
           WHERE u.hostel_id = $1
             AND p.semester_id = $2`;
      const currentCollectedRes = await pool.query(currentCollectedQuery, [hostelId, currentSemesterRow.id]);
      currentCollected = parseFloat(currentCollectedRes.rows[0]?.total || 0);

      const currentExpectedRes = await pool.query(
        `SELECT COALESCE(SUM(${roomPriceForSum}),0) AS total
         FROM student_room_assignments sra
         JOIN rooms rm ON rm.id = sra.room_id
         WHERE rm.hostel_id = $1
           AND sra.status IN ('active','completed')
           AND sra.semester_id = $2`,
        [hostelId, currentSemesterRow.id]
      );
      const currentExpectedRow = currentExpectedRes.rows[0] as { total?: number | string } | undefined;
      currentExpected = parseFloat(currentExpectedRow?.total?.toString() ?? '0');
    }

    const trendMap: Record<
      string,
      { period: string; collected: number; expected: number; expenses: number }
    > = {};
    paymentsTrendRes.rows.forEach((row: any) => {
      const period = row.period as string;
      if (!trendMap[period]) {
        trendMap[period] = { period, collected: 0, expected: 0, expenses: 0 };
      }
      trendMap[period].collected = parseFloat(row.collected?.toString() ?? '0');
    });
    expectedTrendRes.rows.forEach((row: any) => {
      const period = row.period as string;
      if (!trendMap[period]) {
        trendMap[period] = { period, collected: 0, expected: 0, expenses: 0 };
      }
      trendMap[period].expected = parseFloat(row.expected?.toString() ?? '0');
    });
    expensesTrendRes.rows.forEach((row: any) => {
      const period = row.period as string;
      if (!trendMap[period]) {
        trendMap[period] = { period, collected: 0, expected: 0, expenses: 0 };
      }
      trendMap[period].expenses = parseFloat(row.expenses?.toString() ?? '0');
    });

    const trend = Object.values(trendMap).sort((a, b) => a.period.localeCompare(b.period));

    res.json({
      success: true,
      data: {
        totals: {
          collected: totalCollected,
          expected: totalExpected,
          outstanding: totalOutstanding,
          expenses: totalExpenses,
          net: netRevenue,
          current_collected: currentCollected,
          current_expected: currentExpected,
          current_outstanding: currentExpected - currentCollected,
        },
        current_semester: currentSemesterRow
          ? {
              semester_id: currentSemesterRow.id,
              name: currentSemesterRow.name,
              academic_year: currentSemesterRow.academic_year,
              collected: currentCollected,
              expected: currentExpected,
              outstanding: currentExpected - currentCollected,
            }
          : null,
        trend,
        top_collectors: topCollectorsRes.rows.map((row) => ({
          name: row.name,
          email: row.email,
          collected: parseFloat(row.total_paid || 0),
        })),
        outstanding_students: (outstandingStudentsRes.rows as Array<{ name?: string; email?: string; outstanding?: number | string }>).map(
          (row) => ({
            name: row.name ?? '',
            email: row.email ?? '',
            outstanding: parseFloat(row.outstanding?.toString() ?? '0'),
          })
        ),
      },
    });
  } catch (e) {
    console.error('Payments hostel summary error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;











