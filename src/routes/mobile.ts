import express from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';

const router = express.Router();

function getToken(req: any): string | null {
  const rawAuth = req.headers.authorization || '';
  if (!rawAuth) return null;
  return rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '').trim() : rawAuth.trim();
}

router.get('/me', async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (currentUser.role !== 'user') return res.status(403).json({ success: false, message: 'Forbidden' });

    const userId = currentUser.id;

    // Hostel info
    let hostel: any = null;
    if (currentUser.hostel_id) {
      const h = await pool.query('SELECT id, name FROM hostels WHERE id = $1', [currentUser.hostel_id]);
      hostel = h.rows[0] || null;
    }

    // Latest active room assignment
    const sraColsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'student_room_assignments'
    `);
    const sraCols = new Set<string>(sraColsRes.rows.map((r: any) => r.column_name));
    const sraUserCol = sraCols.has('student_id') ? 'student_id' : 'user_id';
    const assignDateCol = sraCols.has('assignment_date') ? 'assignment_date' : (sraCols.has('created_at') ? 'created_at' : null);

    const activeAssignment = await pool.query(
      `SELECT sra.room_id, rm.room_number
       FROM student_room_assignments sra
       JOIN rooms rm ON rm.id = sra.room_id
       WHERE sra.${sraUserCol} = $1 AND sra.status = 'active'
       ORDER BY ${assignDateCol ? `sra.${assignDateCol}` : 'sra.id'} DESC NULLS LAST
       LIMIT 1`,
      [userId]
    );
    const room = activeAssignment.rows[0] || null;

    // If hostel is still null but we have an active room, derive hostel from the room
    if (!hostel && room?.room_id) {
      const hr = await pool.query(
        `SELECT h.id, h.name 
         FROM rooms rm 
         JOIN hostels h ON h.id = rm.hostel_id 
         WHERE rm.id = $1`,
        [room.room_id]
      );
      hostel = hr.rows[0] || null;
    }

    // Latest enrollment for the user (by updated_at desc)
    const enrollRes = await pool.query(
      `SELECT id, semester_id, total_amount, amount_paid, balance, enrollment_status
       FROM semester_enrollments
       WHERE user_id = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [userId]
    );
    const enrollment = enrollRes.rows[0] || null;

    // If enrollment exists, we can trust its totals; otherwise compute minimal paid from payments
    let payments = {
      expected: enrollment?.total_amount != null ? Number(enrollment.total_amount) : null,
      amount_paid: enrollment?.amount_paid != null ? Number(enrollment.amount_paid) : 0,
      balance: enrollment?.balance != null ? Number(enrollment.balance) : null,
      status: enrollment?.enrollment_status || null,
      semester_id: enrollment?.semester_id || null,
    };

    if (!enrollment) {
      // Fallback: sum all ledger payments for the user
      const sumRes = await pool.query(
        `SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE ${'user_id'} = $1`,
        [userId]
      );
      const paid = Number(sumRes.rows[0]?.paid || 0);
      payments = {
        expected: null,
        amount_paid: paid,
        balance: null,
        status: null,
        semester_id: null,
      };
    }

    return res.json({
      success: true,
      data: {
        user: {
          id: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
        },
        hostel,
        room: room ? { id: room.room_id, room_number: room.room_number } : null,
        payments,
      },
    });
  } catch (e) {
    console.error('Mobile /me error:', e);
    return res.status(500).json({ success: false, message: 'Failed to load profile' });
  }
});

export default router;





