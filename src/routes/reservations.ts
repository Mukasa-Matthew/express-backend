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

/**
 * GET /api/reservations/my
 * Get current user's room reservations
 */
router.get('/my', async (req: Request, res: Response) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await pool.query(
      `
      SELECT 
        rr.id,
        rr.room_id,
        rr.current_semester_id,
        rr.reserved_for_semester_id,
        rr.status,
        rr.reservation_date,
        rr.confirmed_at,
        rr.expires_at,
        rr.notes,
        rr.created_at,
        r.room_number,
        r.capacity,
        r.price,
        h.id as hostel_id,
        h.name as hostel_name,
        cs.name as current_semester_name,
        cs.academic_year as current_semester_year,
        fs.name as reserved_for_semester_name,
        fs.academic_year as reserved_for_semester_year,
        fs.start_date as reserved_semester_start,
        fs.end_date as reserved_semester_end,
        h.booking_fee
      FROM room_reservations rr
      JOIN rooms r ON r.id = rr.room_id
      JOIN hostels h ON h.id = r.hostel_id
      JOIN semesters cs ON cs.id = rr.current_semester_id
      JOIN semesters fs ON fs.id = rr.reserved_for_semester_id
      WHERE rr.user_id = $1
        AND rr.status IN ('active', 'confirmed')
      ORDER BY rr.reservation_date DESC
      `,
      [currentUser.id]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get reservations error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reservations' });
  }
});

/**
 * POST /api/reservations
 * Create a room reservation for next semester
 */
router.post('/', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { room_id, reserved_for_semester_id, notes, payment_method, payment_reference, payment_phone } = req.body;

    if (!room_id || !reserved_for_semester_id) {
      return res.status(400).json({
        success: false,
        message: 'room_id and reserved_for_semester_id are required',
      });
    }

    // Verify user has an active assignment in this room for current semester
    const currentAssignment = await client.query(
      `
      SELECT sra.id, sra.room_id, sra.semester_id
      FROM student_room_assignments sra
      JOIN rooms r ON r.id = sra.room_id
      JOIN semesters s ON s.id = sra.semester_id
      WHERE sra.user_id = $1
        AND sra.room_id = $2
        AND sra.status = 'active'
        AND s.is_current = true
        AND s.status = 'active'
      LIMIT 1
      `,
      [currentUser.id, room_id]
    );

    if (currentAssignment.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You must be currently assigned to this room to reserve it for next semester',
      });
    }

    const currentSemesterId = currentAssignment.rows[0].semester_id;

    // Verify reserved semester exists and is upcoming
    const reservedSemester = await client.query(
      `
      SELECT id, name, start_date, end_date, status
      FROM semesters
      WHERE id = $1
        AND hostel_id = (SELECT hostel_id FROM rooms WHERE id = $2)
      `,
      [reserved_for_semester_id, room_id]
    );

    if (reservedSemester.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reserved semester not found for this hostel',
      });
    }

    const semester = reservedSemester.rows[0];
    // Allow reserving for upcoming semesters (when registered in system)
    if (semester.status !== 'upcoming' && semester.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Can only reserve rooms for upcoming or active semesters',
      });
    }

    // Get hostel booking fee
    const hostelResult = await client.query(
      `SELECT h.id, h.booking_fee, h.name as hostel_name
       FROM rooms r
       JOIN hostels h ON h.id = r.hostel_id
       WHERE r.id = $1`,
      [room_id]
    );

    if (hostelResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Room or hostel not found' });
    }

    const hostel = hostelResult.rows[0];
    const bookingFee = Number(hostel.booking_fee || 0);

    // Check if reservation already exists
    const existingReservation = await client.query(
      `
      SELECT id FROM room_reservations
      WHERE user_id = $1
        AND room_id = $2
        AND reserved_for_semester_id = $3
        AND status IN ('active', 'confirmed')
      `,
      [currentUser.id, room_id, reserved_for_semester_id]
    );

    if (existingReservation.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active reservation for this room and semester',
      });
    }

    // Set expiration date (30 days from now or semester start date, whichever is earlier)
    const now = new Date();
    const semesterStart = new Date(semester.start_date);
    const expiresAt = semesterStart < new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      ? semesterStart
      : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Process payment if provided
    let paymentRecorded = false;
    let reservationStatus = 'active';
    
    if (bookingFee > 0 && payment_method && (payment_reference || payment_method === 'cash')) {
      const normalizedMethod = payment_method.toLowerCase();
      if (normalizedMethod === 'cash' || normalizedMethod === 'mobile_money') {
        // Record payment in payments table
        const paymentResult = await client.query(
          `
          INSERT INTO payments (
            user_id, hostel_id, semester_id, amount, method, reference, notes, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          RETURNING *
          `,
          [
            currentUser.id,
            hostel.id,
            reserved_for_semester_id,
            bookingFee,
            normalizedMethod,
            payment_reference || `RESERVATION-${Date.now()}`,
            `Booking fee for room reservation - ${hostel.hostel_name}`
          ]
        );
        
        paymentRecorded = true;
        reservationStatus = 'confirmed'; // Mark as confirmed when booking fee is paid
      }
    }

    // Create reservation
    const result = await client.query(
      `
      INSERT INTO room_reservations (
        user_id, room_id, current_semester_id, reserved_for_semester_id,
        status, reservation_date, expires_at, notes
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
      RETURNING *
      `,
      [currentUser.id, room_id, currentSemesterId, reserved_for_semester_id, reservationStatus, expiresAt, notes || null]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: paymentRecorded 
        ? 'Room reserved successfully and booking fee paid'
        : bookingFee > 0
          ? 'Room reserved. Please pay the booking fee to confirm your reservation.'
          : 'Room reserved successfully for next semester',
      data: {
        ...result.rows[0],
        booking_fee: bookingFee,
        payment_recorded: paymentRecorded,
        payment_required: bookingFee > 0 && !paymentRecorded,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create reservation error:', error);
    res.status(500).json({ success: false, message: 'Failed to create reservation' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/reservations/:id
 * Cancel a room reservation
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const reservationId = parseInt(req.params.id, 10);
    if (Number.isNaN(reservationId)) {
      return res.status(400).json({ success: false, message: 'Invalid reservation id' });
    }

    // Verify ownership
    const reservation = await client.query(
      `
      SELECT id, status FROM room_reservations
      WHERE id = $1 AND user_id = $2
      `,
      [reservationId, currentUser.id]
    );

    if (reservation.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }

    if (reservation.rows[0].status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Reservation already cancelled' });
    }

    // Cancel reservation
    await client.query(
      `
      UPDATE room_reservations
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1
      `,
      [reservationId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Reservation cancelled successfully',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cancel reservation error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel reservation' });
  } finally {
    client.release();
  }
});

export default router;





