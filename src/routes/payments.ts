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
    if (!user_id || !amount) return res.status(400).json({ success: false, message: 'user_id and amount are required' });

    // Validate student belongs to hostel
    const student = await pool.query('SELECT id, email, name FROM users WHERE id = $1 AND hostel_id = $2 AND role = \'user\'', [user_id, hostelId]);
    if (!student.rowCount) return res.status(404).json({ success: false, message: 'Student not found in this hostel' });

    // Inspect payments table columns for legacy compatibility
    const paymentsColumnsRes = await client.query(`
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
    const hasCurrencyColumn = paymentColumns.includes('currency');
    const purposeColumn = paymentColumns.includes('purpose')
      ? 'purpose'
      : paymentColumns.includes('notes')
        ? 'notes'
        : null;

    const sraColumnsRes = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'student_room_assignments'
    `);
    const sraColumns = sraColumnsRes.rows.map(r => r.column_name);
    const sraUserIdColumn = sraColumns.includes('user_id')
      ? 'user_id'
      : sraColumns.includes('student_id')
        ? 'student_id'
        : 'user_id';
    const sraHasSemesterColumn = sraColumns.includes('semester_id');

    const insertColumns: string[] = [paymentUserIdColumn];
    const insertValues: any[] = [user_id];
    const placeholders: string[] = ['$1'];
    let paramIndex = 2;

    if (hasHostelIdColumn) {
      insertColumns.push('hostel_id');
      insertValues.push(hostelId);
      placeholders.push(`$${paramIndex++}`);
    }

    if (hasSemesterIdColumn) {
      insertColumns.push('semester_id');
      insertValues.push(semesterCheck.semesterId ?? null);
      placeholders.push(`$${paramIndex++}`);
    }

    insertColumns.push('amount');
    insertValues.push(parseFloat(amount));
    placeholders.push(`$${paramIndex++}`);

    if (hasCurrencyColumn) {
      insertColumns.push('currency');
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
    const roomParams: any[] = [user_id];
    let roomQuery = `
      SELECT rm.room_number, rm.price::numeric AS expected_price
       FROM student_room_assignments sra
       JOIN rooms rm ON rm.id = sra.room_id
      WHERE sra.${sraUserIdColumn} = $1
        AND sra.status = 'active'`;

    if (sraHasSemesterColumn && semesterCheck.semesterId != null) {
      roomQuery += ' AND sra.semester_id = $2';
      roomParams.push(semesterCheck.semesterId);
    }

    roomQuery += `
      LIMIT 1`;

    const roomRes = await client.query(roomQuery, roomParams);
    const room = roomRes.rows[0] || null;

    // Compute totals AFTER this payment for this semester
    const sumParams: any[] = [user_id];
    let sumQuery = `SELECT COALESCE(SUM(amount),0) as total_paid FROM payments WHERE ${paymentUserIdColumn} = $1`;
    if (hasSemesterIdColumn && semesterCheck.semesterId != null) {
      sumParams.push(semesterCheck.semesterId);
      sumQuery += ' AND semester_id = $2';
    }
    const sumRes = await client.query(sumQuery, sumParams);
    const totalPaidAfter = parseFloat(sumRes.rows[0]?.total_paid || '0');
    const expected = room?.expected_price != null ? parseFloat(room.expected_price) : null;
    const balanceAfter = expected != null ? (expected - totalPaidAfter) : null;

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
      parseFloat(amount),
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
        parseFloat(amount),
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

    // Check if payments table has hostel_id column
    const hostelIdColumnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payments' AND column_name = 'hostel_id'
    `);
    const hasHostelIdColumn = hostelIdColumnCheck.rows.length > 0;
    
    // Check if payments table uses user_id or student_id
    const userIdColumnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payments' AND (column_name = 'user_id' OR column_name = 'student_id')
    `);
    const userIdColumn = userIdColumnCheck.rows[0]?.column_name || 'user_id';
    
    // Total collected (filtered by semester if provided)
    let totalPaidQuery: string;
    let totalPaidParams: any[];
    
    if (hasHostelIdColumn) {
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
           JOIN users u ON u.id = p.${userIdColumn}
           WHERE u.hostel_id = $1 AND p.semester_id = $2`
        : `SELECT COALESCE(SUM(p.amount),0) AS total_collected 
           FROM payments p 
           JOIN users u ON u.id = p.${userIdColumn}
           WHERE u.hostel_id = $1`;
      totalPaidParams = semesterId ? [hostelId, semesterId] : [hostelId];
    }
    
    const totalPaidRes = await pool.query(totalPaidQuery, totalPaidParams);
    const total_collected = parseFloat(totalPaidRes.rows[0]?.total_collected || '0');

    // Check if student_room_assignments table uses student_id or user_id
    const sraUserIdColumnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'student_room_assignments' AND (column_name = 'user_id' OR column_name = 'student_id')
    `);
    const sraUserIdColumn = sraUserIdColumnCheck.rows[0]?.column_name || 'student_id';
    
    // Per-student expected vs paid (with optional semester filtering)
    const assignmentFilter = semesterId ? 'AND sra.semester_id = $2' : '';
    const paymentFilter = semesterId 
      ? (hasHostelIdColumn ? 'AND p.semester_id = $3' : 'AND p.semester_id = $3')
      : '';
    
    let paidSubquery: string;
    if (hasHostelIdColumn) {
      paidSubquery = `
        SELECT ${userIdColumn} AS user_id, COALESCE(SUM(amount),0)::numeric AS paid
        FROM payments
        WHERE hostel_id = $1
        ${paymentFilter}
        GROUP BY ${userIdColumn}
      `;
    } else {
      paidSubquery = `
        SELECT p.${userIdColumn} AS user_id, COALESCE(SUM(p.amount),0)::numeric AS paid
        FROM payments p
        JOIN users u ON u.id = p.${userIdColumn}
        WHERE u.hostel_id = $1
        ${paymentFilter}
        GROUP BY p.${userIdColumn}
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
    
    const queryParams = semesterId ? [hostelId, semesterId, semesterId, hostelId] : [hostelId, hostelId];
    
    const rowsRes = await pool.query(
      `WITH active_assignment AS (
        SELECT sra.${sraUserIdColumn} AS user_id, rm.price::numeric AS expected, rm.room_number
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

export default router;











