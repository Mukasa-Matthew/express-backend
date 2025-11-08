import express, { Request } from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';
import { EmailService } from '../services/emailService';
import { requireActiveSemester } from '../utils/semesterMiddleware';

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

  paymentTableInfoCache = {
    userIdColumn,
    hasHostelIdColumn: columns.includes('hostel_id'),
    hasSemesterIdColumn: columns.includes('semester_id'),
    currencyColumn: columns.includes('currency') ? 'currency' : null,
    purposeColumn,
  };

  return paymentTableInfoCache;
}

interface StudentRoomAssignmentInfo {
  userIdColumn: string;
  hasSemesterColumn: boolean;
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

  studentRoomAssignmentInfoCache = {
    userIdColumn: columns.includes('user_id')
      ? 'user_id'
      : columns.includes('student_id')
      ? 'student_id'
      : 'user_id',
    hasSemesterColumn: columns.includes('semester_id'),
  };

  return studentRoomAssignmentInfoCache;
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

    // Determine active assignment and expected room price
    const roomParams: any[] = [user_id, hostelId];
    let roomQuery = `
      SELECT rm.room_number, rm.price::numeric AS expected_price
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
    roomQuery += `
      ORDER BY sra.assignment_date DESC NULLS LAST, sra.id DESC
      LIMIT 1
    `;

    const roomRes = await client.query(roomQuery, roomParams);
    const room = roomRes.rows[0] || null;
    const expectedPrice = room?.expected_price != null ? parseFloat(room.expected_price) : null;

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

    // If fully paid now, send thank you & welcome email
    if (expected != null && balanceAfter != null && balanceAfter <= 0) {
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
    const total_collected = parseFloat(totalPaidRes.rows[0]?.total_collected || '0');

    // Per-student expected vs paid (with optional semester filtering)
    const assignmentFilter = semesterId && sraInfo.hasSemesterColumn ? 'AND sra.semester_id = $2' : '';
    const paymentFilter =
      semesterId && paymentInfo.hasSemesterIdColumn ? 'AND p.semester_id = $3' : '';
    
    let paidSubquery: string;
    if (paymentInfo.hasHostelIdColumn) {
      paidSubquery = `
        SELECT ${paymentInfo.userIdColumn} AS user_id, COALESCE(SUM(amount),0)::numeric AS paid
        FROM payments
        WHERE hostel_id = $1
        ${paymentFilter}
        GROUP BY ${paymentInfo.userIdColumn}
      `;
    } else {
      paidSubquery = `
        SELECT p.${paymentInfo.userIdColumn} AS user_id, COALESCE(SUM(p.amount),0)::numeric AS paid
        FROM payments p
        JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
        WHERE u.hostel_id = $1
        ${paymentFilter}
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
      `WITH active_assignment AS (
        SELECT sra.${sraInfo.userIdColumn} AS user_id, rm.price::numeric AS expected, rm.room_number
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
      ORDER BY u.name ASC`,
      queryParams
    );

    const students = rowsRes.rows.map(r => ({
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

    const total_outstanding = students.reduce((sum, s) => sum + (s.balance && s.balance > 0 ? s.balance : 0), 0);

    const payload = { total_collected, total_outstanding, students };
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

    const expectedTotalsCte = `
      SELECT sra.semester_id, COALESCE(SUM(rm.price)::numeric,0) AS total_expected
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
        expected_totals AS (
          ${expectedTotalsCte}
        )
        SELECT se.id,
               se.name,
               se.academic_year,
               se.start_date,
               se.end_date,
               se.is_current,
               COALESCE(pt.total_collected,0)::numeric AS total_collected,
               COALESCE(et.total_expected,0)::numeric AS total_expected,
               (COALESCE(et.total_expected,0)::numeric - COALESCE(pt.total_collected,0)::numeric) AS outstanding
        FROM semesters se
        LEFT JOIN payment_totals pt ON pt.semester_id = se.id
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

    const expectedTotalsCte = `
      SELECT rm.hostel_id, COALESCE(SUM(rm.price)::numeric,0) AS total_expected
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

    const currentExpectedTotalsCte = `
      SELECT cs.hostel_id, COALESCE(SUM(rm.price)::numeric,0) AS total_expected
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
      )
      SELECT h.id,
             h.name,
             COALESCE(pt.total_collected,0)::numeric AS total_collected,
             COALESCE(et.total_expected,0)::numeric AS total_expected,
             (COALESCE(et.total_expected,0)::numeric - COALESCE(pt.total_collected,0)::numeric) AS outstanding,
             cs.semester_id AS current_semester_id,
             cs.name AS current_semester_name,
             cs.academic_year AS current_semester_academic_year,
             COALESCE(cpt.total_collected,0)::numeric AS current_total_collected,
             COALESCE(cet.total_expected,0)::numeric AS current_total_expected,
             (COALESCE(cet.total_expected,0)::numeric - COALESCE(cpt.total_collected,0)::numeric) AS current_outstanding
      FROM hostels h
      LEFT JOIN payment_totals pt ON pt.hostel_id = h.id
      LEFT JOIN expected_totals et ON et.hostel_id = h.id
      LEFT JOIN current_semesters cs ON cs.hostel_id = h.id
      LEFT JOIN current_payment_totals cpt ON cpt.hostel_id = h.id
      LEFT JOIN current_expected_totals cet ON cet.hostel_id = h.id
      ORDER BY h.name ASC
    `);

    const hostels = globalRes.rows.map((row) => {
      const totalCollected = parseFloat(row.total_collected || 0);
      const totalExpected = parseFloat(row.total_expected || 0);
      const outstanding = parseFloat(row.outstanding || 0);
      const currentCollected = parseFloat(row.current_total_collected || 0);
      const currentExpected = parseFloat(row.current_total_expected || 0);
      const currentOutstanding = parseFloat(row.current_outstanding || 0);

      return {
        hostel_id: row.id,
        hostel_name: row.name,
        totals: {
          collected: totalCollected,
          expected: totalExpected,
          outstanding,
        },
        current_semester: row.current_semester_id
          ? {
              semester_id: row.current_semester_id,
              name: row.current_semester_name,
              academic_year: row.current_semester_academic_year,
              collected: currentCollected,
              expected: currentExpected,
              outstanding: currentOutstanding,
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

    const dateExpr = 'COALESCE(p.payment_date, p.created_at)';
    const totalCollectedQuery = paymentInfo.hasHostelIdColumn
      ? `SELECT COALESCE(SUM(amount),0)::numeric AS total FROM payments WHERE hostel_id = $1`
      : `SELECT COALESCE(SUM(p.amount),0)::numeric AS total
         FROM payments p
         JOIN users u ON u.id = p.${paymentInfo.userIdColumn}
         WHERE u.hostel_id = $1`;

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
        `SELECT COALESCE(SUM(rm.price)::numeric,0) AS total
         FROM student_room_assignments sra
         JOIN rooms rm ON rm.id = sra.room_id
         WHERE rm.hostel_id = $1
           AND sra.status IN ('active','completed')`,
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
        `
          SELECT to_char(date_trunc('month', COALESCE(sra.assignment_date, sra.created_at, CURRENT_DATE)), 'YYYY-MM') AS period,
                 SUM(rm.price)::numeric AS expected
          FROM student_room_assignments sra
          JOIN rooms rm ON rm.id = sra.room_id
          WHERE rm.hostel_id = $1
            AND sra.status IN ('active','completed')
            AND COALESCE(sra.assignment_date, sra.created_at, CURRENT_DATE) >= date_trunc('month', CURRENT_DATE) - INTERVAL '${months - 1} month'
          GROUP BY period
          ORDER BY period ASC
        `,
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
          ? `
            SELECT u.name,
                   u.email,
                   COALESCE(SUM(rm.price)::numeric,0) - COALESCE(SUM(p.amount)::numeric,0) AS outstanding
            FROM student_room_assignments sra
            JOIN rooms rm ON rm.id = sra.room_id
            JOIN users u ON u.id = sra.${sraInfo.userIdColumn}
            LEFT JOIN payments p ON p.${paymentInfo.userIdColumn} = u.id
            WHERE rm.hostel_id = $1
              AND sra.status IN ('active','completed')
            GROUP BY u.id, u.name, u.email
            HAVING COALESCE(SUM(rm.price)::numeric,0) - COALESCE(SUM(p.amount)::numeric,0) > 0
            ORDER BY outstanding DESC
            LIMIT 5
          `
          : `
            SELECT u.name,
                   u.email,
                   COALESCE(SUM(rm.price)::numeric,0) - COALESCE(SUM(p.amount)::numeric,0) AS outstanding
            FROM student_room_assignments sra
            JOIN rooms rm ON rm.id = sra.room_id
            JOIN users u ON u.id = sra.${sraInfo.userIdColumn}
            LEFT JOIN payments p ON p.${paymentInfo.userIdColumn} = u.id
            WHERE rm.hostel_id = $1
              AND sra.status IN ('active','completed')
            GROUP BY u.id, u.name, u.email
            HAVING COALESCE(SUM(rm.price)::numeric,0) - COALESCE(SUM(p.amount)::numeric,0) > 0
            ORDER BY outstanding DESC
            LIMIT 5
          `,
        [hostelId]
      ),
    ]);

    const totalCollected = parseFloat(totalCollectedRes.rows[0]?.total || 0);
    const totalExpected = parseFloat(totalExpectedRes.rows[0]?.total || 0);
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
        `SELECT COALESCE(SUM(rm.price)::numeric,0) AS total
         FROM student_room_assignments sra
         JOIN rooms rm ON rm.id = sra.room_id
         WHERE rm.hostel_id = $1
           AND sra.status IN ('active','completed')
           AND sra.semester_id = $2`,
        [hostelId, currentSemesterRow.id]
      );
      currentExpected = parseFloat(currentExpectedRes.rows[0]?.total || 0);
    }

    const trendMap: Record<
      string,
      { period: string; collected: number; expected: number; expenses: number }
    > = {};
    paymentsTrendRes.rows.forEach((row) => {
      const period = row.period;
      if (!trendMap[period]) {
        trendMap[period] = { period, collected: 0, expected: 0, expenses: 0 };
      }
      trendMap[period].collected = parseFloat(row.collected || 0);
    });
    expectedTrendRes.rows.forEach((row) => {
      const period = row.period;
      if (!trendMap[period]) {
        trendMap[period] = { period, collected: 0, expected: 0, expenses: 0 };
      }
      trendMap[period].expected = parseFloat(row.expected || 0);
    });
    expensesTrendRes.rows.forEach((row) => {
      const period = row.period;
      if (!trendMap[period]) {
        trendMap[period] = { period, collected: 0, expected: 0, expenses: 0 };
      }
      trendMap[period].expenses = parseFloat(row.expenses || 0);
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
        outstanding_students: outstandingStudentsRes.rows.map((row) => ({
          name: row.name,
          email: row.email,
          outstanding: parseFloat(row.outstanding || 0),
        })),
      },
    });
  } catch (e) {
    console.error('Payments hostel summary error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;











