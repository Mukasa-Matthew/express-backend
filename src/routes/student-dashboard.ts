import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';

const router = Router();

type AuthedUser = {
  id: number;
  role: string;
  name: string;
  email: string;
  hostel_id: number | null;
};

async function authenticateRequest(req: Request): Promise<AuthedUser | null> {
  const rawAuth = req.headers.authorization || '';
  const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
  if (!token) return null;

  try {
    const decoded: any = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return null;
    return {
      id: currentUser.id,
      role: currentUser.role,
      name: currentUser.name,
      email: currentUser.email,
      hostel_id: currentUser.hostel_id || null,
    };
  } catch (err) {
    return null;
  }
}

async function getStudentHostelId(userId: number): Promise<number | null> {
  // Get hostel from active enrollment
  const enrollmentRes = await pool.query(
    `
    SELECT s.hostel_id
    FROM semester_enrollments se
    JOIN semesters s ON s.id = se.semester_id
    WHERE se.user_id = $1
      AND se.enrollment_status = 'active'
      AND (s.status = 'active' OR s.status = 'upcoming')
      AND (s.is_current = true OR s.start_date >= NOW())
    ORDER BY s.start_date DESC
    LIMIT 1
    `,
    [userId]
  );

  if (enrollmentRes.rows.length > 0) {
    return enrollmentRes.rows[0].hostel_id;
  }

  // Get hostel from active reservation
  const reservationRes = await pool.query(
    `
    SELECT h.id as hostel_id
    FROM room_reservations rr
    JOIN rooms r ON r.id = rr.room_id
    JOIN hostels h ON h.id = r.hostel_id
    JOIN semesters s ON s.id = rr.reserved_for_semester_id
    WHERE rr.user_id = $1
      AND rr.status IN ('active', 'confirmed')
      AND (s.status = 'active' OR s.status = 'upcoming')
    ORDER BY s.start_date DESC
    LIMIT 1
    `,
    [userId]
  );

  return reservationRes.rows[0]?.hostel_id || null;
}

/**
 * GET /api/student-dashboard/payments
 * Get student's payment history
 */
router.get('/payments', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (currentUser.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only students can access this endpoint' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10)));
    const offset = (page - 1) * limit;

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

    // Get payment history
    const paymentsRes = await pool.query(
      `
      SELECT 
        p.id,
        p.amount,
        p.payment_method,
        p.payment_date,
        p.transaction_id,
        p.currency,
        p.notes,
        p.created_at,
        s.name as semester_name,
        s.academic_year,
        u.name as recorded_by_name
      FROM payments p
      LEFT JOIN semesters s ON s.id = p.semester_id
      LEFT JOIN users u ON u.id = p.recorded_by
      WHERE p.${paymentUserIdColumn} = $1
      ORDER BY p.payment_date DESC, p.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [currentUser.id, limit, offset]
    );

    // Get total count
    const countRes = await pool.query(
      `SELECT COUNT(*) as total FROM payments WHERE ${paymentUserIdColumn} = $1`,
      [currentUser.id]
    );

    // Get balance breakdown
    const balanceRes = await pool.query(
      `
      SELECT 
        se.total_amount,
        se.amount_paid,
        se.balance,
        s.name as semester_name,
        s.start_date,
        s.end_date
      FROM semester_enrollments se
      JOIN semesters s ON s.id = se.semester_id
      WHERE se.user_id = $1
        AND se.enrollment_status = 'active'
      ORDER BY s.start_date DESC
      LIMIT 1
      `,
      [currentUser.id]
    );

    res.json({
      success: true,
      data: {
        payments: paymentsRes.rows,
        pagination: {
          page,
          limit,
          total: parseInt(countRes.rows[0]?.total || '0', 10),
        },
        balance: balanceRes.rows[0] || null,
      },
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch payments' });
  }
});

/**
 * GET /api/student-dashboard/payments/:id/receipt
 * Generate PDF receipt for a payment
 */
router.get('/payments/:id/receipt', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (currentUser.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only students can access this endpoint' });
    }

    const paymentId = parseInt(req.params.id, 10);
    if (Number.isNaN(paymentId)) {
      return res.status(400).json({ success: false, message: 'Invalid payment ID' });
    }

    // Check payment table structure
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

    // Get payment details
    const paymentRes = await pool.query(
      `
      SELECT 
        p.id,
        p.amount,
        p.payment_method,
        p.payment_date,
        p.transaction_id,
        p.currency,
        p.notes,
        u.name as student_name,
        u.email as student_email,
        h.name as hostel_name,
        h.address as hostel_address,
        h.contact_phone as hostel_phone,
        s.name as semester_name,
        r.room_number
      FROM payments p
      JOIN users u ON u.id = p.${paymentUserIdColumn}
      LEFT JOIN semesters s ON s.id = p.semester_id
      LEFT JOIN hostels h ON h.id = (SELECT hostel_id FROM semesters WHERE id = p.semester_id)
      LEFT JOIN student_room_assignments sra ON sra.${paymentColumns.includes('student_id') ? 'student_id' : 'user_id'} = p.${paymentUserIdColumn} AND sra.semester_id = p.semester_id AND sra.status = 'active'
      LEFT JOIN rooms r ON r.id = sra.room_id
      WHERE p.id = $1 AND p.${paymentUserIdColumn} = $2
      `,
      [paymentId, currentUser.id]
    );

    if (paymentRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const payment = paymentRes.rows[0];

    // Generate simple HTML receipt (can be converted to PDF using a library like puppeteer)
    const receiptHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Payment Receipt - ${payment.id}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          .header { text-align: center; margin-bottom: 30px; }
          .details { margin: 20px 0; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; }
          .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${payment.hostel_name || 'Hostel'}</h1>
          <p>Payment Receipt</p>
        </div>
        <div class="details">
          <div class="detail-row"><span class="label">Receipt Number:</span> REC-${payment.id}</div>
          <div class="detail-row"><span class="label">Date:</span> ${new Date(payment.payment_date).toLocaleDateString()}</div>
          <div class="detail-row"><span class="label">Student:</span> ${payment.student_name}</div>
          <div class="detail-row"><span class="label">Email:</span> ${payment.student_email}</div>
          ${payment.room_number ? `<div class="detail-row"><span class="label">Room:</span> ${payment.room_number}</div>` : ''}
          ${payment.semester_name ? `<div class="detail-row"><span class="label">Semester:</span> ${payment.semester_name}</div>` : ''}
          <div class="detail-row"><span class="label">Amount:</span> ${payment.currency} ${parseFloat(payment.amount).toFixed(2)}</div>
          <div class="detail-row"><span class="label">Payment Method:</span> ${payment.payment_method}</div>
          ${payment.transaction_id ? `<div class="detail-row"><span class="label">Transaction ID:</span> ${payment.transaction_id}</div>` : ''}
          ${payment.notes ? `<div class="detail-row"><span class="label">Notes:</span> ${payment.notes}</div>` : ''}
        </div>
        <div class="footer">
          <p>This is a computer-generated receipt. No signature required.</p>
          ${payment.hostel_address ? `<p>${payment.hostel_address}</p>` : ''}
          ${payment.hostel_phone ? `<p>Phone: ${payment.hostel_phone}</p>` : ''}
        </div>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(receiptHtml);
  } catch (error) {
    console.error('Get receipt error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate receipt' });
  }
});

/**
 * GET /api/student-dashboard/bookings
 * Get student's booking history
 */
router.get('/bookings', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (currentUser.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only students can access this endpoint' });
    }

    const hostelId = await getStudentHostelId(currentUser.id);
    if (!hostelId) {
      return res.status(403).json({ success: false, message: 'No active enrollment or reservation found' });
    }

    // Get bookings by email or phone
    const bookingsRes = await pool.query(
      `
      SELECT 
        pb.id,
        pb.student_name,
        pb.student_email,
        pb.student_phone,
        pb.status,
        pb.payment_status,
        pb.booking_fee,
        pb.amount_paid,
        pb.created_at as booking_date,
        pb.confirmed_at,
        pb.created_at,
        h.name as hostel_name,
        s.name as semester_name,
        r.room_number
      FROM public_hostel_bookings pb
      JOIN hostels h ON h.id = pb.hostel_id
      LEFT JOIN semesters s ON s.id = pb.semester_id
      LEFT JOIN rooms r ON r.id = pb.room_id
      WHERE pb.hostel_id = $1
        AND (pb.student_email = $2 OR pb.student_phone = $3)
      ORDER BY pb.created_at DESC
      `,
      [hostelId, currentUser.email, currentUser.email] // Using email as identifier
    );

    res.json({
      success: true,
      data: bookingsRes.rows,
    });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
});

/**
 * GET /api/student-dashboard/roommates
 * Get student's roommates
 */
router.get('/roommates', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (currentUser.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only students can access this endpoint' });
    }

    // Check student_room_assignments table structure
    const sraColsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'student_room_assignments'
    `);
    const sraCols = new Set<string>(sraColsRes.rows.map((r: any) => r.column_name));
    const sraUserCol = sraCols.has('student_id') ? 'student_id' : 'user_id';

    // Get current room assignment
    const roomRes = await pool.query(
      `
      SELECT 
        sra.room_id,
        r.room_number,
        r.capacity,
        r.floor,
        h.name as hostel_name,
        h.address as hostel_address
      FROM student_room_assignments sra
      JOIN rooms r ON r.id = sra.room_id
      JOIN hostels h ON h.id = r.hostel_id
      JOIN semesters s ON s.id = sra.semester_id
      WHERE sra.${sraUserCol} = $1
        AND sra.status = 'active'
        AND (s.status = 'active' OR s.status = 'upcoming')
        AND (s.is_current = true OR s.start_date >= NOW())
      ORDER BY s.start_date DESC
      LIMIT 1
      `,
      [currentUser.id]
    );

    if (roomRes.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          room: null,
          roommates: [],
          capacity: 0,
          current_occupancy: 0,
        },
      });
    }

    const room = roomRes.rows[0];

    // Check what assignment date column exists
    const assignmentDateColRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'student_room_assignments'
        AND column_name IN ('assignment_date', 'assigned_at', 'created_at')
      ORDER BY 
        CASE column_name
          WHEN 'assignment_date' THEN 1
          WHEN 'assigned_at' THEN 2
          WHEN 'created_at' THEN 3
        END
      LIMIT 1
    `);
    const assignmentDateCol = assignmentDateColRes.rows[0]?.column_name || 'created_at';

    // Check which profile table exists and what phone column it has
    const profileTableCheck = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('student_profiles', 'students')
    `);
    const hasStudentProfilesTable = profileTableCheck.rows.some((row: any) => row.table_name === 'student_profiles');
    const hasStudentsTable = profileTableCheck.rows.some((row: any) => row.table_name === 'students');

    // Determine phone column name
    let phoneColumn = null;
    let whatsappColumn = null;
    let profileJoin = '';
    
    if (hasStudentProfilesTable) {
      phoneColumn = 'sp.phone';
      whatsappColumn = 'sp.whatsapp';
      profileJoin = 'LEFT JOIN student_profiles sp ON sp.user_id = u.id';
    } else if (hasStudentsTable) {
      phoneColumn = 'sp.phone_number';
      whatsappColumn = 'NULL'; // students table doesn't have whatsapp
      profileJoin = 'LEFT JOIN students sp ON sp.user_id = u.id';
    } else {
      phoneColumn = 'NULL';
      whatsappColumn = 'NULL';
      profileJoin = '';
    }

    // Get roommates (other students in the same room)
    const roommatesRes = await pool.query(
      `
      SELECT 
        u.id,
        u.name,
        u.email,
        u.profile_picture,
        sra.${assignmentDateCol} as assignment_date,
        ${phoneColumn} as phone,
        ${whatsappColumn} as whatsapp
      FROM student_room_assignments sra
      JOIN users u ON u.id = sra.${sraUserCol}
      ${profileJoin}
      JOIN semesters s ON s.id = sra.semester_id
      WHERE sra.room_id = $1
        AND sra.${sraUserCol} != $2
        AND sra.status = 'active'
        AND (s.status = 'active' OR s.status = 'upcoming')
        AND (s.is_current = true OR s.start_date >= NOW())
      ORDER BY sra.${assignmentDateCol} ASC
      `,
      [room.room_id, currentUser.id]
    );

    // Get current occupancy
    const occupancyRes = await pool.query(
      `
      SELECT COUNT(*) as count
      FROM student_room_assignments sra
      JOIN semesters s ON s.id = sra.semester_id
      WHERE sra.room_id = $1
        AND sra.status = 'active'
        AND (s.status = 'active' OR s.status = 'upcoming')
        AND (s.is_current = true OR s.start_date >= NOW())
      `,
      [room.room_id]
    );

    res.json({
      success: true,
      data: {
        room: {
          room_number: room.room_number,
          floor: room.floor,
          capacity: room.capacity,
          hostel_name: room.hostel_name,
          hostel_address: room.hostel_address,
        },
        roommates: roommatesRes.rows,
        capacity: room.capacity,
        current_occupancy: parseInt(occupancyRes.rows[0]?.count || '0', 10),
      },
    });
  } catch (error) {
    console.error('Get roommates error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch roommates' });
  }
});

/**
 * GET /api/student-dashboard/announcements
 * Get hostel announcements
 */
router.get('/announcements', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (currentUser.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only students can access this endpoint' });
    }

    const hostelId = await getStudentHostelId(currentUser.id);
    if (!hostelId) {
      return res.status(403).json({ success: false, message: 'No active enrollment or reservation found' });
    }

    const now = new Date();
    const announcementsRes = await pool.query(
      `
      SELECT 
        a.id,
        a.title,
        a.content,
        a.priority,
        a.published_at,
        a.expires_at,
        a.created_at,
        u.name as created_by_name
      FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.hostel_id = $1
        AND a.is_active = true
        AND (a.published_at IS NULL OR a.published_at <= $2)
        AND (a.expires_at IS NULL OR a.expires_at >= $2)
      ORDER BY 
        CASE a.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        a.published_at DESC NULLS LAST,
        a.created_at DESC
      LIMIT 50
      `,
      [hostelId, now]
    );

    res.json({
      success: true,
      data: announcementsRes.rows,
    });
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch announcements' });
  }
});

/**
 * GET /api/student-dashboard/notifications
 * Get student notifications
 */
router.get('/notifications', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (currentUser.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only students can access this endpoint' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10)));
    const offset = (page - 1) * limit;
    const unreadOnly = req.query.unread_only === 'true';

    let query = `
      SELECT 
        id,
        type,
        title,
        message,
        is_read,
        read_at,
        link,
        metadata,
        created_at
      FROM notifications
      WHERE user_id = $1
    `;
    const params: any[] = [currentUser.id];

    if (unreadOnly) {
      query += ' AND is_read = false';
    }

    query += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    params.push(limit, offset);

    const notificationsRes = await pool.query(query, params);

    // Get unread count
    const unreadCountRes = await pool.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [currentUser.id]
    );

    res.json({
      success: true,
      data: {
        notifications: notificationsRes.rows,
        unread_count: parseInt(unreadCountRes.rows[0]?.count || '0', 10),
        pagination: {
          page,
          limit,
        },
      },
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

/**
 * POST /api/student-dashboard/notifications/:id/read
 * Mark notification as read
 */
router.post('/notifications/:id/read', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (currentUser.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only students can access this endpoint' });
    }

    const notificationId = parseInt(req.params.id, 10);
    if (Number.isNaN(notificationId)) {
      return res.status(400).json({ success: false, message: 'Invalid notification ID' });
    }

    await pool.query(
      `UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = $1 AND user_id = $2`,
      [notificationId, currentUser.id]
    );

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
  }
});

/**
 * GET /api/student-dashboard/documents
 * Get hostel documents (rules, receipts, etc.)
 */
router.get('/documents', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (currentUser.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only students can access this endpoint' });
    }

    const hostelId = await getStudentHostelId(currentUser.id);
    if (!hostelId) {
      return res.status(403).json({ success: false, message: 'No active enrollment or reservation found' });
    }

    // Get hostel info including rules
    const hostelRes = await pool.query(
      `
      SELECT 
        id,
        name,
        rules_and_regulations,
        amenities,
        address,
        contact_phone,
        contact_email
      FROM hostels
      WHERE id = $1
      `,
      [hostelId]
    );

    if (hostelRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Hostel not found' });
    }

    const hostel = hostelRes.rows[0];

    res.json({
      success: true,
      data: {
        rules_and_regulations: hostel.rules_and_regulations,
        amenities: hostel.amenities,
        contact_info: {
          address: hostel.address,
          phone: hostel.contact_phone,
          email: hostel.contact_email,
        },
      },
    });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch documents' });
  }
});

/**
 * GET /api/student-dashboard/statistics
 * Get student statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (currentUser.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only students can access this endpoint' });
    }

    // Get current enrollment
    const enrollmentRes = await pool.query(
      `
      SELECT 
        se.id,
        se.enrollment_date,
        se.total_amount,
        se.amount_paid,
        se.balance,
        s.id as semester_id,
        s.name as semester_name,
        s.start_date,
        s.end_date,
        s.academic_year
      FROM semester_enrollments se
      JOIN semesters s ON s.id = se.semester_id
      WHERE se.user_id = $1
        AND se.enrollment_status = 'active'
        AND (s.status = 'active' OR s.status = 'upcoming')
      ORDER BY s.start_date DESC
      LIMIT 1
      `,
      [currentUser.id]
    );

    const enrollment = enrollmentRes.rows[0] || null;

    // Check payment table structure
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

    // Get payment trends (last 6 months)
    const paymentTrendsRes = await pool.query(
      `
      SELECT 
        DATE_TRUNC('month', payment_date) as month,
        COUNT(*) as payment_count,
        SUM(amount) as total_amount
      FROM payments
      WHERE ${paymentUserIdColumn} = $1
        AND payment_date >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', payment_date)
      ORDER BY month ASC
      `,
      [currentUser.id]
    );

    // Calculate stay duration
    let stayDuration = null;
    if (enrollment) {
      const enrollmentDate = new Date(enrollment.enrollment_date);
      const now = new Date();
      const daysDiff = Math.floor((now.getTime() - enrollmentDate.getTime()) / (1000 * 60 * 60 * 24));
      stayDuration = {
        days: daysDiff,
        months: Math.floor(daysDiff / 30),
        enrollment_date: enrollment.enrollment_date,
      };
    }

    // Calculate semester progress
    let semesterProgress = null;
    if (enrollment && enrollment.start_date && enrollment.end_date) {
      const startDate = new Date(enrollment.start_date);
      const endDate = new Date(enrollment.end_date);
      const now = new Date();
      const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const daysElapsed = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, Math.floor((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const progressPercent = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));

      semesterProgress = {
        days_elapsed: daysElapsed,
        days_remaining: daysRemaining,
        total_days: totalDays,
        progress_percent: Math.round(progressPercent),
        start_date: enrollment.start_date,
        end_date: enrollment.end_date,
      };
    }

    res.json({
      success: true,
      data: {
        enrollment: enrollment ? {
          semester_name: enrollment.semester_name,
          academic_year: enrollment.academic_year,
          total_amount: enrollment.total_amount,
          amount_paid: enrollment.amount_paid,
          balance: enrollment.balance,
        } : null,
        payment_trends: paymentTrendsRes.rows.map((row: any) => ({
          month: row.month,
          payment_count: parseInt(row.payment_count, 10),
          total_amount: parseFloat(row.total_amount),
        })),
        stay_duration: stayDuration,
        semester_progress: semesterProgress,
      },
    });
  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics' });
  }
});

export default router;

