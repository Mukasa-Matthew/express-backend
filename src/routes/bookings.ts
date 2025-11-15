import express from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { EmailService } from '../services/emailService';
import { MobileMoneyService } from '../services/mobileMoneyService';
import { CredentialGenerator } from '../utils/credentialGenerator';

const router = express.Router();

type AuthedUser = {
  id: number;
  role: string;
  name: string;
  email: string;
  hostel_id: number | null;
};

async function authenticateRequest(req: express.Request): Promise<AuthedUser | null> {
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

async function resolveHostelIdForUser(user: AuthedUser, explicitHostelId?: number | null): Promise<number | null> {
  if (user.role === 'super_admin') {
    if (explicitHostelId) return explicitHostelId;
    return null;
  }

  if (user.role === 'hostel_admin') {
    if (user.hostel_id) return user.hostel_id;
    const admin = await UserModel.findById(user.id);
    return admin?.hostel_id || null;
  }

  if (user.role === 'custodian') {
    const res = await pool.query('SELECT hostel_id FROM custodians WHERE user_id = $1', [user.id]);
    const fromCustodian = res.rows[0]?.hostel_id || null;
    if (fromCustodian) return fromCustodian;
    const userRecord = await UserModel.findById(user.id);
    return userRecord?.hostel_id || null;
  }

  return null;
}

function generateVerificationCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function ensureRoomCapacity(roomId: number, semesterId: number): Promise<{ capacity: number; occupied: number }> {
  const capacityQuery = await pool.query(
    `
      SELECT
        r.capacity,
        COALESCE((
          SELECT COUNT(*) FROM public_hostel_bookings pb
          WHERE pb.room_id = r.id
            AND pb.semester_id = $2
            AND pb.status IN ('pending', 'booked', 'checked_in')
        ), 0) +
        COALESCE((
          SELECT COUNT(*) FROM student_room_assignments sra
          WHERE sra.room_id = r.id
            AND sra.status = 'active'
            AND (sra.semester_id = $2 OR $2 IS NULL)
        ), 0) AS occupied
      FROM rooms r
      WHERE r.id = $1
    `,
    [roomId, semesterId],
  );

  if (capacityQuery.rows.length === 0) {
    throw new Error('Room not found');
  }

  return capacityQuery.rows[0];
}

async function recordPayment(
  client: any,
  bookingId: number,
  amount: number,
  method: 'cash' | 'mobile_money',
  recordedByUserId: number | null,
  reference?: string | null,
  notes?: string | null,
  status: 'completed' | 'pending' | 'failed' = 'completed',
): Promise<{ payment: any; booking: any }> {
  const insertResult = await client.query(
    `
      INSERT INTO public_booking_payments (
        booking_id,
        amount,
        method,
        status,
        reference,
        notes,
        recorded_by_user_id,
        recorded_at,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW()
      )
      RETURNING *
    `,
    [bookingId, amount, method, status, reference || null, notes || null, recordedByUserId],
  );

  const payment = insertResult.rows[0];

  if (status === 'completed') {
    const bookingUpdate = await client.query(
      `
        UPDATE public_hostel_bookings
        SET amount_paid = amount_paid + $2,
            payment_status = CASE
              WHEN amount_paid + $2 >= amount_due THEN 'paid'
              WHEN amount_paid + $2 > 0 THEN 'partial'
              ELSE payment_status
            END,
            status = CASE
              WHEN amount_paid + $2 >= amount_due THEN 'booked'
              ELSE status
            END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [bookingId, amount],
    );
    return { payment, booking: bookingUpdate.rows[0] };
  }

  const bookingResult = await client.query(
    `
      SELECT *
      FROM public_hostel_bookings
      WHERE id = $1
    `,
    [bookingId],
  );

  return { payment, booking: bookingResult.rows[0] };
}

interface CheckInResponse {
  status: number;
  success: boolean;
  message: string;
  booking?: any;
  data?: any;
}

async function performBookingCheckIn(
  client: any,
  bookingId: number,
  currentUser: AuthedUser,
  requestedHostelId: number | null,
): Promise<CheckInResponse> {
  const allowedHostelId = await resolveHostelIdForUser(currentUser, requestedHostelId);
  if (!allowedHostelId) {
    return {
      status: 403,
      success: false,
      message: 'Hostel scope required for check-in',
    };
  }

  const bookingRes = await client.query(
    `
      SELECT
        b.id,
        b.hostel_id,
        b.semester_id,
        b.room_id,
        b.amount_due,
        b.amount_paid,
        b.status,
        b.payment_status,
        b.confirmed_at,
        b.student_name,
        b.student_email,
        b.student_phone,
        b.whatsapp,
        b.gender,
        b.date_of_birth,
        b.registration_number,
        b.course,
        b.emergency_contact
      FROM public_hostel_bookings b
      WHERE b.id = $1
        AND b.hostel_id = $2
    `,
    [bookingId, allowedHostelId],
  );

  if (bookingRes.rows.length === 0) {
    return {
      status: 404,
      success: false,
      message: 'Booking not found for this hostel',
    };
  }

  const bookingRow = bookingRes.rows[0];
  const amountDue = Number(bookingRow.amount_due ?? 0);
  const amountPaid = Number(bookingRow.amount_paid ?? 0);
  const outstanding = Math.max(0, Math.round((amountDue - amountPaid) * 100) / 100);

  if (outstanding > 0) {
    return {
      status: 400,
      success: false,
      message: `Outstanding balance of ${outstanding.toFixed(2)} must be cleared before check-in`,
      data: { outstanding },
    };
  }

  if ((bookingRow.status || '').toLowerCase() === 'checked_in') {
    return {
      status: 200,
      success: true,
      message: 'Booking already checked in',
      booking: bookingRow,
    };
  }

  // Extract booking data
  const {
    student_name,
    student_email,
    student_phone,
    whatsapp,
    gender,
    date_of_birth,
    registration_number,
    course,
    emergency_contact,
    room_id,
    semester_id,
  } = bookingRow;

  // Validate required fields
  if (!student_email || !student_name) {
    return {
      status: 400,
      success: false,
      message: 'Booking is missing required student information (email or name)',
    };
  }

  if (!room_id) {
    return {
      status: 400,
      success: false,
      message: 'Booking must have a room assigned before check-in',
    };
  }

  // Use unified student registration service for check-in
  // Get booking amount paid for initial payment
  const bookingAmountPaid = parseFloat(bookingRow.amount_paid || '0');
  
  // Ensure we have a semester_id - if booking doesn't have one, get current semester
  let finalSemesterId = semester_id;
  if (!finalSemesterId) {
    const currentSemesterRes = await client.query(
      `SELECT id FROM semesters 
       WHERE hostel_id = $1 AND is_current = true AND status = 'active'
       LIMIT 1`,
      [allowedHostelId]
    );
    if (currentSemesterRes.rows.length > 0) {
      finalSemesterId = currentSemesterRes.rows[0].id;
    } else {
      return {
        status: 400,
        success: false,
        message: 'No active semester found. Please create and activate a semester before checking in students.',
      };
    }
  }
  
  const { StudentRegistrationService } = require('../utils/studentRegistration');
  
  try {
    const registrationResult = await StudentRegistrationService.registerStudent(
      {
        name: student_name,
        email: student_email,
        phone: student_phone || null,
        gender: gender || null,
        dateOfBirth: date_of_birth || null,
        registrationNumber: registration_number || null,
        course: course || null,
        emergencyContact: emergency_contact || null,
        hostelId: allowedHostelId,
        roomId: room_id,
        semesterId: finalSemesterId,
        initialPaymentAmount: bookingAmountPaid > 0 ? bookingAmountPaid : 0,
        currency: 'UGX',
      },
      currentUser.id,
      client
    );

    const userId = registrationResult.userId;

    // Update room occupancy after assignment
    await StudentRegistrationService.updateRoomOccupancy(client, room_id);

    // Update booking status to checked_in
    const updateRes = await client.query(
      `
        UPDATE public_hostel_bookings
        SET status = 'checked_in',
            payment_status = CASE
              WHEN payment_status = 'paid' THEN payment_status
              ELSE 'paid'
            END,
            confirmed_at = COALESCE(confirmed_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [bookingId],
    );

    return {
      status: 200,
      success: true,
      message: 'Booking checked in successfully and student account created',
      booking: updateRes.rows[0],
    };
  } catch (registrationError: any) {
    return {
      status: 400,
      success: false,
      message: registrationError.message || 'Failed to register student during check-in',
    };
  }
}

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Only custodians can create bookings (hostel_admin should not create bookings)
    if (currentUser.role !== 'custodian') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only custodians can create bookings. Hostel administrators can view bookings and reports.' 
      });
    }

    const bodyHostelId = req.body.hostelId ? parseInt(String(req.body.hostelId), 10) : null;
    const hostelId = await resolveHostelIdForUser(currentUser, bodyHostelId);
    if (!hostelId) {
      return res.status(403).json({ success: false, message: 'Unable to determine hostel for this request' });
    }

    const {
      fullName,
      email,
      phone,
      whatsapp,
      gender,
      dateOfBirth,
      registrationNumber,
      course,
      preferredCheckIn,
      stayDuration,
      emergencyContact,
      notes,
      semesterId,
      roomId,
      currency,
      amountDue,
      initialPaymentAmount,
      paymentMethod,
      paymentReference,
      paymentNotes,
      paymentPhone,
    } = req.body || {};

    if (!fullName || typeof fullName !== 'string') {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    if (!semesterId) {
      return res.status(400).json({ success: false, message: 'Semester is required' });
    }
    if (!roomId) {
      return res.status(400).json({ success: false, message: 'Room selection is required' });
    }

    const semesterInt = parseInt(String(semesterId), 10);
    const roomInt = parseInt(String(roomId), 10);
    if (Number.isNaN(semesterInt) || Number.isNaN(roomInt)) {
      return res.status(400).json({ success: false, message: 'Invalid semester or room id' });
    }

    const hostelResult = await pool.query(
      `
        SELECT id, name, booking_fee, university_id
        FROM hostels
        WHERE id = $1
      `,
      [hostelId],
    );
    if (hostelResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Hostel not found' });
    }
    const hostel = hostelResult.rows[0];

    const semesterResult = await pool.query(
      `
        SELECT id, name
        FROM semesters
        WHERE id = $1 AND hostel_id = $2
      `,
      [semesterInt, hostelId],
    );
    if (semesterResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Semester not available for this hostel' });
    }

    const roomResult = await pool.query(
      `
        SELECT id, room_number, capacity, price
        FROM rooms
        WHERE id = $1 AND hostel_id = $2
      `,
      [roomInt, hostelId],
    );
    if (roomResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Room not available for this hostel' });
    }
    const room = roomResult.rows[0];
    const roomPrice = room?.price != null ? Number(room.price) : null;

    const capacityState = await ensureRoomCapacity(roomInt, semesterInt);
    if (capacityState.occupied >= capacityState.capacity) {
      return res.status(409).json({
        success: false,
        message: 'Selected room is fully booked for this semester',
      });
    }

    const parsedCheckIn =
      typeof preferredCheckIn === 'string' && preferredCheckIn.trim().length > 0
        ? new Date(preferredCheckIn)
        : null;
    const checkInDate =
      parsedCheckIn && !Number.isNaN(parsedCheckIn.valueOf()) ? parsedCheckIn : null;

    const parsedDob =
      typeof dateOfBirth === 'string' && dateOfBirth.trim().length > 0
        ? new Date(dateOfBirth)
        : null;
    const dob = parsedDob && !Number.isNaN(parsedDob.valueOf()) ? parsedDob : null;

    const resolvedCurrency =
      typeof currency === 'string' && currency.trim().length > 0 ? currency.trim().toUpperCase() : 'UGX';
    const resolvedAmountDue =
      amountDue && !Number.isNaN(parseFloat(amountDue))
        ? parseFloat(amountDue)
        : roomPrice != null && !Number.isNaN(roomPrice)
        ? roomPrice
        : Number(hostel.booking_fee) || 0;
    const normalizedPrimaryPhone = typeof phone === 'string' ? phone.trim() : '';
    const normalizedPaymentPhone =
      typeof paymentPhone === 'string' && paymentPhone.trim().length > 0
        ? paymentPhone.trim()
        : normalizedPrimaryPhone;
    const normalizedPaymentReference =
      typeof paymentReference === 'string' && paymentReference.trim().length > 0
        ? paymentReference.trim()
        : null;

    await client.query('BEGIN');

    const insertBooking = await client.query(
      `
        INSERT INTO public_hostel_bookings (
          hostel_id,
          university_id,
          semester_id,
          room_id,
          source,
          created_by_user_id,
          student_name,
          student_email,
          student_phone,
          whatsapp,
          gender,
          date_of_birth,
          registration_number,
          course,
          preferred_check_in,
          stay_duration,
          emergency_contact,
          notes,
          currency,
          booking_fee,
          amount_due,
          amount_paid,
          payment_phone,
          payment_reference,
          payment_status,
          status,
          verification_code,
          verification_issued_at,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, 0, $22, $23, 'pending', 'pending', NULL, NULL, NOW(), NOW()
        )
        RETURNING *
      `,
      [
        hostel.id,
        hostel.university_id ?? null,
        semesterInt,
        roomInt,
        'on_site', // Source is 'on_site' for bookings created by custodians
        currentUser.id,
        fullName.trim(),
        email.trim(),
        phone.trim(),
        whatsapp?.trim() || null,
        gender?.trim() || null,
        dob,
        registrationNumber?.trim() || null,
        course?.trim() || null,
        checkInDate,
        stayDuration?.trim() || null,
        emergencyContact?.trim() || null,
        notes?.trim() || null,
        resolvedCurrency,
        resolvedAmountDue,
        0,
        normalizedPaymentPhone,
        normalizedPaymentReference,
      ],
    );

    let booking = insertBooking.rows[0];
    let recordedPayment: any = null;
    let verificationCode: string | null = null;
    let requiresMobileInitiation = false;

    const paymentAmount =
      initialPaymentAmount && !Number.isNaN(parseFloat(initialPaymentAmount))
        ? parseFloat(initialPaymentAmount)
        : 0;

    const normalizedMethod =
      paymentMethod && typeof paymentMethod === 'string'
        ? paymentMethod.toLowerCase()
        : null;

    if (paymentAmount > 0) {
      if (normalizedMethod === 'cash') {
        const { payment, booking: updatedBooking } = await recordPayment(
          client,
          booking.id,
          paymentAmount,
          'cash',
          currentUser.id,
          normalizedPaymentReference,
          paymentNotes || null,
          'completed',
        );
        recordedPayment = payment;
        booking = updatedBooking;
      } else if (normalizedMethod === 'mobile_money') {
        if (normalizedPaymentReference) {
          const { payment, booking: updatedBooking } = await recordPayment(
            client,
            booking.id,
            paymentAmount,
            'mobile_money',
            currentUser.id,
            normalizedPaymentReference,
            paymentNotes || null,
            'completed',
          );
          recordedPayment = payment;
          booking = updatedBooking;
        } else {
          requiresMobileInitiation = true;
        }
      }
    }

    // Generate verification code when booking is fully paid and no code exists
    if (booking.payment_status === 'paid' && !booking.verification_code) {
      verificationCode = generateVerificationCode();
      const codeUpdate = await client.query(
        `
          UPDATE public_hostel_bookings
          SET verification_code = $2,
              verification_issued_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [booking.id, verificationCode],
      );
      booking = codeUpdate.rows[0];
    }

    await client.query('COMMIT');

    // Send receipt email if we have student email
    if (booking.student_email) {
      const balance =
        booking.amount_due !== null && booking.amount_paid !== null
          ? Number(booking.amount_due) - Number(booking.amount_paid)
          : null;

      const html = EmailService.generatePaymentReceiptEmail(
        booking.student_name,
        booking.student_email,
        Number(recordedPayment ? recordedPayment.amount : 0),
        booking.currency || 'UGX',
        balance,
        room.room_number || null,
        `Capacity ${room.capacity}`,
        new Date().toLocaleString(),
        hostel.name,
        currentUser.name,
        currentUser.role === 'custodian' ? 'Custodian' : 'Admin',
        null,
        Number(booking.amount_due),
        booking.verification_code || verificationCode || undefined,
      );

      await EmailService.sendEmail({
        to: booking.student_email,
        subject: `${hostel.name} booking confirmation`,
        html,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: {
        booking,
        payment: recordedPayment,
        verificationCode: verificationCode ?? booking.verification_code,
        mobileMoney: {
          requiresInitiation: requiresMobileInitiation,
          amount: requiresMobileInitiation ? paymentAmount : null,
          phone: requiresMobileInitiation ? normalizedPaymentPhone : null,
        },
      },
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Create booking error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create booking' });
  } finally {
    client.release();
  }
});

router.post('/:id/payments/mobile-initiate', async (req, res) => {
  const client = await pool.connect();
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const bookingId = parseInt(req.params.id, 10);
    if (Number.isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const requestedHostelId = req.query.hostel_id ? parseInt(String(req.query.hostel_id), 10) : null;
    const allowedHostelId = await resolveHostelIdForUser(currentUser, requestedHostelId);

    const { amount, phoneNumber, notes } = req.body || {};

    const paymentAmount =
      amount && !Number.isNaN(parseFloat(amount)) ? parseFloat(amount) : 0;
    if (paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    }

    const normalizedPhone =
      typeof phoneNumber === 'string' && phoneNumber.trim().length > 0 ? phoneNumber.trim() : '';
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, message: 'Phone number is required for mobile money payments' });
    }

    await client.query('BEGIN');
    const bookingResult = await client.query(
      `
        SELECT *
        FROM public_hostel_bookings
        WHERE id = $1
        FOR UPDATE
      `,
      [bookingId],
    );

    if (bookingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const bookingRow = bookingResult.rows[0];

    if (allowedHostelId && bookingRow.hostel_id !== allowedHostelId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

  const amountDue = Number(bookingRow.amount_due ?? 0);
  const amountPaidBefore = Number(bookingRow.amount_paid ?? 0);
  const outstandingBefore = Math.max(0, Math.round((amountDue - amountPaidBefore) * 100) / 100);

  if (outstandingBefore <= 0) {
    await client.query('ROLLBACK');
    return res.status(400).json({
      success: false,
      message: 'This student has already cleared the outstanding balance for this booking.',
    });
  }

  if (paymentAmount > outstandingBefore) {
    await client.query('ROLLBACK');
    return res.status(400).json({
      success: false,
      message: `Request amount exceeds remaining balance of ${outstandingBefore}.`,
      data: { outstanding: outstandingBefore },
    });
  }

    await client.query(
      `
        UPDATE public_hostel_bookings
        SET payment_phone = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [bookingId, normalizedPhone],
    );

    if (!MobileMoneyService.isConfigured()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message:
          'Mobile money provider not configured. Set MOMO_PROVIDER=mock to simulate payments or configure a supported provider.',
      });
    }

    const stkResult = await MobileMoneyService.initiateStkPush({
      phoneNumber: normalizedPhone,
      amount: paymentAmount,
      bookingId,
      hostelId: bookingRow.hostel_id,
      currency: bookingRow.currency || 'UGX',
      description: `Booking fee for ${bookingRow.student_name}`,
      metadata: { initiatedBy: currentUser.id },
    });

    if (!stkResult.success) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: stkResult.message });
    }

    const paymentStatus = stkResult.status === 'completed' ? 'completed' : 'pending';

    const { payment, booking } = await recordPayment(
      client,
      bookingId,
      paymentAmount,
      'mobile_money',
      currentUser.id,
      stkResult.reference || null,
      notes || null,
      paymentStatus,
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: stkResult.message,
      data: {
        payment,
        booking,
        status: paymentStatus,
        reference: stkResult.reference || payment?.reference || null,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Initiate mobile payment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to initiate mobile payment' });
  } finally {
    client.release();
  }
});

router.get('/', async (req, res) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const requestedHostelId = req.query.hostel_id ? parseInt(String(req.query.hostel_id), 10) : null;
    const hostelId = await resolveHostelIdForUser(currentUser, requestedHostelId);
    if (!hostelId) {
      return res.status(403).json({ success: false, message: 'Unable to determine hostel for this request' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10)));
    const offset = (page - 1) * limit;

    const filters: string[] = ['b.hostel_id = $1'];
    const values: any[] = [hostelId];
    let paramIndex = 2;

    if (req.query.status) {
      filters.push(`b.status = $${paramIndex}`);
      values.push(String(req.query.status));
      paramIndex += 1;
    }

    if (req.query.payment_status) {
      filters.push(`b.payment_status = $${paramIndex}`);
      values.push(String(req.query.payment_status));
      paramIndex += 1;
    }

    if (req.query.semester_id) {
      filters.push(`b.semester_id = $${paramIndex}`);
      values.push(parseInt(String(req.query.semester_id), 10));
      paramIndex += 1;
    }

    if (req.query.search) {
      filters.push(`(b.student_name ILIKE $${paramIndex} OR b.student_phone ILIKE $${paramIndex} OR b.student_email ILIKE $${paramIndex})`);
      values.push(`%${String(req.query.search).trim()}%`);
      paramIndex += 1;
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const bookingsTableCheck = await pool.query("SELECT to_regclass('public.public_hostel_bookings') AS table_ref");
    const hasPublicBookingsTable = Boolean(bookingsTableCheck.rows[0]?.table_ref);

    if (!hasPublicBookingsTable) {
      return res.json({
        success: true,
        data: [],
        page,
        limit,
        total: 0,
        totalPages: 1,
      });
    }

    const paymentsTableCheck = await pool.query("SELECT to_regclass('public.public_booking_payments') AS table_ref");
    const hasPublicBookingPaymentsTable = Boolean(paymentsTableCheck.rows[0]?.table_ref);

    const latestPaymentJoin = hasPublicBookingPaymentsTable
      ? `
        LEFT JOIN LATERAL (
          SELECT
            p.method,
            p.amount,
            p.status,
            p.reference,
            p.recorded_at
          FROM public_booking_payments p
          WHERE p.booking_id = b.id
          ORDER BY p.recorded_at DESC
          LIMIT 1
        ) latest_payment ON TRUE
      `
      : `
        LEFT JOIN LATERAL (
          SELECT
            NULL::text AS method,
            NULL::numeric AS amount,
            NULL::text AS status,
            NULL::text AS reference,
            NULL::timestamptz AS recorded_at
        ) latest_payment ON TRUE
      `;

    const countResult = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM public_hostel_bookings b
        ${whereClause}
      `,
      values,
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const listResult = await pool.query(
      `
        SELECT
          b.*,
          s.name AS semester_name,
          r.room_number,
          r.capacity AS room_capacity,
          latest_payment.method AS latest_payment_method,
          latest_payment.amount AS latest_payment_amount,
          latest_payment.status AS latest_payment_status,
          latest_payment.reference AS latest_payment_reference,
          latest_payment.recorded_at AS latest_payment_recorded_at
        FROM public_hostel_bookings b
        LEFT JOIN semesters s ON s.id = b.semester_id
        LEFT JOIN rooms r ON r.id = b.room_id
        ${latestPaymentJoin}
        ${whereClause}
        ORDER BY b.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      values,
    );

    return res.json({
      success: true,
      data: listResult.rows,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('List bookings error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load bookings' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const bookingId = parseInt(req.params.id, 10);
    if (Number.isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const requestedHostelId = req.query.hostel_id ? parseInt(String(req.query.hostel_id), 10) : null;
    const hostelId = await resolveHostelIdForUser(currentUser, requestedHostelId);

    const bookingResult = await pool.query(
      `
        SELECT
          b.*,
          h.name AS hostel_name,
          s.name AS semester_name,
          s.academic_year AS semester_academic_year,
          r.room_number,
          r.capacity AS room_capacity
        FROM public_hostel_bookings b
        JOIN hostels h ON h.id = b.hostel_id
        LEFT JOIN semesters s ON s.id = b.semester_id
        LEFT JOIN rooms r ON r.id = b.room_id
        WHERE b.id = $1
      `,
      [bookingId],
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    if (hostelId && booking.hostel_id !== hostelId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const paymentsResult = await pool.query(
      `
        SELECT
          p.*,
          u.name AS recorded_by_name,
          u.email AS recorded_by_email
        FROM public_booking_payments p
        LEFT JOIN users u ON u.id = p.recorded_by_user_id
        WHERE p.booking_id = $1
        ORDER BY p.recorded_at DESC
      `,
      [bookingId],
    );

    return res.json({
      success: true,
      data: {
        booking,
        payments: paymentsResult.rows,
      },
    });
  } catch (error) {
    console.error('Get booking detail error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load booking' });
  }
});

router.post('/:id/payments', async (req, res) => {
  const client = await pool.connect();
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Only custodians can record payments for bookings
    if (currentUser.role !== 'custodian') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only custodians can record payments. Hostel administrators can view bookings and reports.' 
      });
    }

    const bookingId = parseInt(req.params.id, 10);
    if (Number.isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const {
      amount,
      method,
      reference,
      notes,
    } = req.body || {};

    const paymentAmount =
      amount && !Number.isNaN(parseFloat(amount)) ? parseFloat(amount) : 0;
    if (paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero' });
    }

    const normalizedMethod =
      method && typeof method === 'string' ? method.toLowerCase() : '';
    if (normalizedMethod !== 'cash' && normalizedMethod !== 'mobile_money') {
      return res.status(400).json({ success: false, message: 'Payment method must be cash or mobile_money' });
    }

    const requestedHostelId = req.query.hostel_id ? parseInt(String(req.query.hostel_id), 10) : null;
    const allowedHostelId = await resolveHostelIdForUser(currentUser, requestedHostelId);

    await client.query('BEGIN');
    const bookingResult = await client.query(
      `
        SELECT *
        FROM public_hostel_bookings
        WHERE id = $1
        FOR UPDATE
      `,
      [bookingId],
    );

    if (bookingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const bookingRow = bookingResult.rows[0];

    if (allowedHostelId && bookingRow.hostel_id !== allowedHostelId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const hostelMeta = await client.query('SELECT name FROM hostels WHERE id = $1', [bookingRow.hostel_id]);
    const hostelName: string | null = hostelMeta.rows[0]?.name ?? null;

    let roomNumber: string | null = null;
    let roomCapacityLabel: string | null = null;
    if (bookingRow.room_id) {
      const roomMeta = await client.query('SELECT room_number, capacity FROM rooms WHERE id = $1', [bookingRow.room_id]);
      const roomRow = roomMeta.rows[0];
      if (roomRow) {
        roomNumber = roomRow.room_number ?? null;
        roomCapacityLabel = roomRow.capacity ? `Capacity ${roomRow.capacity}` : null;
      }
    }

    const amountDue = Number(bookingRow.amount_due ?? 0);
    const amountPaidBefore = Number(bookingRow.amount_paid ?? 0);
    const outstandingBefore = Math.max(0, Math.round((amountDue - amountPaidBefore) * 100) / 100);

    if (outstandingBefore <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'This student has already cleared the outstanding balance for this booking.',
      });
    }

    if (paymentAmount > outstandingBefore) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Payment exceeds remaining balance of ${outstandingBefore}.`,
        data: { outstanding: outstandingBefore },
      });
    }

    const { payment, booking } = await recordPayment(
      client,
      bookingId,
      paymentAmount,
      normalizedMethod,
      currentUser.id,
      reference || null,
      notes || null,
    );

    let updatedBooking = booking;
    let generatedCode: string | null = null;
    if (booking.payment_status === 'paid' && !booking.verification_code) {
      generatedCode = generateVerificationCode();
      const codeUpdate = await client.query(
        `
          UPDATE public_hostel_bookings
          SET verification_code = $2,
              verification_issued_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [bookingId, generatedCode],
      );
      updatedBooking = codeUpdate.rows[0];
    }

    // Auto-register student when payment is added (especially when balance is cleared)
    // This ensures student appears on students page with room number
    // Only register if booking has room and semester assigned
    if (updatedBooking.room_id && updatedBooking.semester_id && updatedBooking.student_email) {
      try {
        const { StudentRegistrationService } = require('../utils/studentRegistration');
        
        // Use booking's amount_due as total amount (not room price)
        const bookingTotalAmount = parseFloat(updatedBooking.amount_due || '0');
        const bookingAmountPaid = parseFloat(updatedBooking.amount_paid || '0');
        
        // Register student with the booking amounts
        const registrationResult = await StudentRegistrationService.registerStudent(
          {
            name: updatedBooking.student_name,
            email: updatedBooking.student_email,
            phone: updatedBooking.student_phone || null,
            gender: updatedBooking.gender || null,
            dateOfBirth: updatedBooking.date_of_birth || null,
            registrationNumber: updatedBooking.registration_number || null,
            course: updatedBooking.course || null,
            emergencyContact: updatedBooking.emergency_contact || null,
            hostelId: bookingRow.hostel_id,
            roomId: updatedBooking.room_id,
            semesterId: updatedBooking.semester_id,
            initialPaymentAmount: bookingAmountPaid, // Use total amount paid from booking
            currency: updatedBooking.currency || 'UGX',
          },
          currentUser.id,
          client
        );
        
        // Update semester enrollment to use booking's amount_due as total_amount
        // This ensures the balance is calculated correctly based on booking, not room price
        if (bookingTotalAmount > 0) {
          await client.query(
            `UPDATE semester_enrollments
             SET total_amount = $1::numeric,
                 amount_paid = $2::numeric,
                 balance = GREATEST(0, ($1::numeric - $2::numeric)),
                 updated_at = NOW()
             WHERE user_id = $3 AND semester_id = $4`,
            [
              bookingTotalAmount,
              bookingAmountPaid,
              registrationResult.userId,
              updatedBooking.semester_id
            ]
          );
        }
        
        // Update room occupancy after registration
        await StudentRegistrationService.updateRoomOccupancy(client, updatedBooking.room_id);
      } catch (registrationError: any) {
        // Log error but don't fail the payment - student might already be registered
        // The registerStudent function handles existing students gracefully
        console.error('Auto-registration error (non-fatal):', registrationError.message);
      }
    }

    await client.query('COMMIT');

    if (updatedBooking.student_email) {
      const balance =
        updatedBooking.amount_due !== null && updatedBooking.amount_paid !== null
          ? Number(updatedBooking.amount_due) - Number(updatedBooking.amount_paid)
          : null;

      const html = EmailService.generatePaymentReceiptEmail(
        updatedBooking.student_name,
        updatedBooking.student_email,
        Number(payment.amount),
        updatedBooking.currency || 'UGX',
        balance,
        roomNumber,
        roomCapacityLabel,
        new Date(payment.recorded_at).toLocaleString(),
        hostelName || 'Hostel',
        currentUser.name,
        currentUser.role === 'custodian' ? 'Custodian' : 'Admin',
        null,
        Number(updatedBooking.amount_due),
        updatedBooking.verification_code || generatedCode || undefined,
      );

      await EmailService.sendEmail({
        to: updatedBooking.student_email,
        subject: `${hostelName ?? 'Hostel'} payment receipt`,
        html,
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        payment,
        booking: updatedBooking,
      },
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Record booking payment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to record payment' });
  } finally {
    client.release();
  }
});

router.post('/:id/check-in', async (req, res) => {
  const client = await pool.connect();
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const bookingId = parseInt(req.params.id, 10);
    if (Number.isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const requestedHostelId = req.query.hostel_id ? parseInt(String(req.query.hostel_id), 10) : null;
    const result = await performBookingCheckIn(client, bookingId, currentUser, requestedHostelId);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
        data: result.data ?? undefined,
      });
    }

    return res.status(result.status).json({
      success: true,
      message: result.message,
      data: result.booking,
    });
  } catch (error) {
    console.error('Booking check-in error:', error);
    return res.status(500).json({ success: false, message: 'Failed to check in booking' });
  } finally {
    client.release();
  }
});

router.post('/check-in', async (req, res) => {
  const client = await pool.connect();
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const bookingIdRaw =
      req.body?.booking_id ??
      req.body?.bookingId ??
      req.query.booking_id ??
      req.query.bookingId ??
      req.body?.id;
    const bookingId = bookingIdRaw !== undefined ? parseInt(String(bookingIdRaw), 10) : NaN;
    if (Number.isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'booking_id is required for check-in' });
    }

    const requestedHostelIdRaw =
      req.body?.hostel_id ??
      req.body?.hostelId ??
      req.query.hostel_id ??
      req.query.hostelId;
    const requestedHostelId =
      requestedHostelIdRaw !== undefined ? parseInt(String(requestedHostelIdRaw), 10) : null;

    const result = await performBookingCheckIn(client, bookingId, currentUser, requestedHostelId);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
        data: result.data ?? undefined,
      });
    }

    return res.status(result.status).json({
      success: true,
      message: result.message,
      data: result.booking,
    });
  } catch (error) {
    console.error('Booking check-in error (body route):', error);
    return res.status(500).json({ success: false, message: 'Failed to check in booking' });
  } finally {
    client.release();
  }
});

// Verify booking code (only custodians can verify)
router.get('/verify/:code', async (req, res) => {
  try {
    const currentUser = await authenticateRequest(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Only custodians can verify booking codes
    if (currentUser.role !== 'custodian') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only custodians can verify booking codes. Hostel administrators can view bookings and reports.' 
      });
    }

    const code = (req.params.code || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ success: false, message: 'Verification code is required' });
    }

    const result = await pool.query(
      `
        SELECT
          b.id,
          b.hostel_id,
          b.student_name,
          b.student_email,
          b.student_phone,
          b.payment_phone,
          b.currency,
          b.amount_due,
          b.amount_paid,
          b.payment_status,
          b.status,
          b.semester_id,
          b.room_id,
          b.verification_code,
          b.verification_issued_at,
          h.name AS hostel_name,
          r.room_number,
          r.capacity
        FROM public_hostel_bookings b
        JOIN hostels h ON h.id = b.hostel_id
        LEFT JOIN rooms r ON r.id = b.room_id
        WHERE b.verification_code = $1
      `,
      [code],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found for this verification code',
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Verify booking code error:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify booking' });
  }
});

export default router;


