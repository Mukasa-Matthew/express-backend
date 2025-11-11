import express from 'express';
import pool from '../config/database';
import { EmailService } from '../services/emailService';

const router = express.Router();

type HostelSummaryRow = {
  id: number;
  name: string;
  address: string | null;
  description: string | null;
  booking_fee: number | null;
  amenities: string | string[] | null;
  distance_from_campus: number | null;
  occupancy_type: string | null;
  latitude: number | null;
  longitude: number | null;
  is_published: boolean;
  price_per_room: number | null;
  total_rooms: number | null;
  available_rooms: number | null;
  min_price: number | null;
  max_price: number | null;
  avg_price: number | null;
  primary_image: string | null;
};

type HostelDetailRow = HostelSummaryRow & {
  contact_phone: string | null;
  contact_email: string | null;
  university_id: number | null;
  university_name: string | null;
  university_code: string | null;
  university_address: string | null;
};

function normalizeAmenities(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((value) => value?.toString().trim()).filter(Boolean) as string[];
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeImageUrl(url: string | null): string | null {
  if (!url) return null;

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  const base =
    process.env.BACKEND_PUBLIC_URL ||
    process.env.PUBLIC_ASSET_BASE_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5000';

  const normalizedBase = base.replace(/\/$/, '');
  let normalizedPath = url.trim();

  if (normalizedPath.startsWith('./')) {
    normalizedPath = normalizedPath.slice(2);
  }
  if (normalizedPath.startsWith('../')) {
    normalizedPath = normalizedPath.replace(/^\.\//, '');
  }

  if (normalizedPath.startsWith('uploads/')) {
    normalizedPath = `/${normalizedPath}`;
  } else if (normalizedPath.startsWith('/uploads/')) {
    // already correct
  } else if (normalizedPath.startsWith('hostel-images/')) {
    normalizedPath = `/uploads/${normalizedPath}`;
  } else if (!normalizedPath.startsWith('/')) {
    normalizedPath = `/uploads/${normalizedPath}`;
  }

  const fullUrl = `${normalizedBase}${normalizedPath}`;
  console.debug('[Public] normalizeImageUrl', { raw: url, fullUrl });
  return fullUrl;
}

function generateVerificationCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

interface HostelSummaryFilters {
  hostelIds?: number[];
  universityId?: number;
}

async function fetchHostelSummaries(filters?: HostelSummaryFilters): Promise<HostelSummaryRow[]> {
  const params: any[] = [];
  const conditions: string[] = [];

  if (filters?.hostelIds && filters.hostelIds.length > 0) {
    params.push(filters.hostelIds);
    conditions.push(`h.id = ANY($${params.length})`);
  }

  if (typeof filters?.universityId === 'number' && !Number.isNaN(filters.universityId)) {
    params.push(filters.universityId);
    conditions.push(`h.university_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const bookingsTableCheck = await pool.query("SELECT to_regclass('public.public_hostel_bookings') AS table_ref");
  const hasPublicBookingsTable = Boolean(bookingsTableCheck.rows[0]?.table_ref);

  const pendingBookingsJoin = hasPublicBookingsTable
    ? `
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS booking_count
        FROM public_hostel_bookings pb
        WHERE pb.room_id = r.id AND pb.status IN ('pending', 'booked', 'checked_in')
      ) pending_bookings ON TRUE
    `
    : `
      LEFT JOIN LATERAL (
        SELECT 0::bigint AS booking_count
      ) pending_bookings ON TRUE
    `;

  const query = `
    WITH room_availability AS (
      SELECT
        r.hostel_id,
        COUNT(*) AS total_rooms,
        COUNT(*) FILTER (
          WHERE (r.status IS NULL OR r.status = 'available')
            AND (r.capacity - COALESCE(active_assignments.active_count, 0) - COALESCE(pending_bookings.booking_count, 0)) > 0
        ) AS available_rooms,
        MIN(r.price) FILTER (WHERE r.price IS NOT NULL) AS min_price,
        MAX(r.price) FILTER (WHERE r.price IS NOT NULL) AS max_price,
        AVG(r.price) FILTER (WHERE r.price IS NOT NULL) AS avg_price
      FROM rooms r
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS active_count
        FROM student_room_assignments sra
        WHERE sra.room_id = r.id AND sra.status = 'active'
      ) active_assignments ON TRUE
      ${pendingBookingsJoin}
      GROUP BY r.hostel_id
    ),
    primary_image AS (
      SELECT hostel_id, image_url
      FROM (
        SELECT
          hi.hostel_id,
          hi.image_url,
          ROW_NUMBER() OVER (
            PARTITION BY hi.hostel_id
            ORDER BY hi.is_primary DESC, hi.display_order ASC, hi.id ASC
          ) AS row_number
        FROM hostel_images hi
      ) ranked
      WHERE row_number = 1
    )
    SELECT
      h.id,
      h.name,
      h.address,
      h.description,
      h.booking_fee,
      h.amenities,
      h.distance_from_campus,
      h.occupancy_type,
      h.latitude,
      h.longitude,
      h.is_published,
      h.price_per_room,
      ra.total_rooms,
      ra.available_rooms,
      ra.min_price,
      ra.max_price,
      ra.avg_price,
      pi.image_url AS primary_image
    FROM hostels h
    LEFT JOIN room_availability ra ON ra.hostel_id = h.id
    LEFT JOIN primary_image pi ON pi.hostel_id = h.id
    ${whereClause}
    ORDER BY h.name ASC
  `;

  const result = await pool.query(query, params);
  return result.rows as HostelSummaryRow[];
}

router.get('/universities-with-hostels', async (_req, res) => {
  try {
    const bookingsTableCheck = await pool.query("SELECT to_regclass('public.public_hostel_bookings') AS table_ref");
    const hasPublicBookingsTable = Boolean(bookingsTableCheck.rows[0]?.table_ref);

    const pendingBookingsJoin = hasPublicBookingsTable
      ? `
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS booking_count
          FROM public_hostel_bookings pb
          WHERE pb.room_id = r.id AND pb.status IN ('pending', 'booked', 'checked_in')
        ) pending_bookings ON TRUE
      `
      : `
        LEFT JOIN LATERAL (
          SELECT 0::bigint AS booking_count
        ) pending_bookings ON TRUE
      `;

    const universityImageColumnCheck = await pool.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'universities'
          AND column_name = 'image_url'
        LIMIT 1`,
    );
    const universityImageSelect = universityImageColumnCheck.rowCount ? 'u.image_url' : 'NULL::text';

    const query = `
      WITH room_availability AS (
        SELECT
          r.hostel_id,
          COUNT(*) AS total_rooms,
          COUNT(*) FILTER (
            WHERE (r.status IS NULL OR r.status = 'available')
              AND (r.capacity - COALESCE(active_assignments.active_count, 0) - COALESCE(pending_bookings.booking_count, 0)) > 0
          ) AS available_rooms,
          MIN(r.price) FILTER (WHERE r.price IS NOT NULL) AS min_price,
          MAX(r.price) FILTER (WHERE r.price IS NOT NULL) AS max_price,
          AVG(r.price) FILTER (WHERE r.price IS NOT NULL) AS avg_price
        FROM rooms r
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS active_count
          FROM student_room_assignments sra
          WHERE sra.room_id = r.id AND sra.status = 'active'
        ) active_assignments ON TRUE
        ${pendingBookingsJoin}
        GROUP BY r.hostel_id
      ),
      primary_image AS (
        SELECT hostel_id, image_url
        FROM (
          SELECT
            hi.hostel_id,
            hi.image_url,
            ROW_NUMBER() OVER (
              PARTITION BY hi.hostel_id
              ORDER BY hi.is_primary DESC, hi.display_order ASC, hi.id ASC
            ) AS row_number
          FROM hostel_images hi
        ) ranked
        WHERE row_number = 1
      )
      SELECT
        u.id,
        u.name,
        u.code,
        u.address,
        u.contact_email,
        u.contact_phone,
        u.website,
        ${universityImageSelect} AS image_url,
        COALESCE(
          json_agg(
            json_build_object(
              'id', h.id,
              'name', h.name,
              'address', h.address,
              'description', h.description,
              'booking_fee', h.booking_fee,
              'amenities', h.amenities,
              'distance_from_campus', h.distance_from_campus,
              'occupancy_type', h.occupancy_type,
              'latitude', h.latitude,
              'longitude', h.longitude,
              'is_published', h.is_published,
              'price_per_room', h.price_per_room,
              'total_rooms', ra.total_rooms,
              'available_rooms', ra.available_rooms,
              'min_price', ra.min_price,
              'max_price', ra.max_price,
              'avg_price', ra.avg_price,
              'primary_image', pi.image_url
            ) ORDER BY h.name ASC
          ) FILTER (WHERE h.id IS NOT NULL),
          '[]'
        ) AS hostels
      FROM universities u
      LEFT JOIN hostels h
        ON h.university_id = u.id
        AND h.is_published = TRUE
      LEFT JOIN room_availability ra ON ra.hostel_id = h.id
      LEFT JOIN primary_image pi ON pi.hostel_id = h.id
      GROUP BY u.id
      ORDER BY u.name ASC
    `;

    const result = await pool.query(query);
    const data = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      address: row.address,
      contact_email: row.contact_email,
      contact_phone: row.contact_phone,
      website: row.website,
      image_url: row.image_url,
      hostels: (Array.isArray(row.hostels) ? row.hostels : []).map((hostel: any) => ({
        ...hostel,
        amenities: normalizeAmenities(hostel.amenities),
        primary_image: normalizeImageUrl(hostel.primary_image),
      })),
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Public universities-with-hostels error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load universities' });
  }
});

router.get('/universities/:id/hostels', async (req, res) => {
  const universityId = Number(req.params.id);
  if (Number.isNaN(universityId)) {
    return res.status(400).json({ success: false, message: 'Invalid university id' });
  }

  try {
    const universityResult = await pool.query(
      `SELECT id, name, code, address, contact_email, contact_phone, website, image_url
       FROM universities
       WHERE id = $1`,
      [universityId],
    );

    if (universityResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'University not found' });
    }

    const hostels = await fetchHostelSummaries({ universityId });
    const filteredHostels = hostels
      .filter((hostel) => hostel.is_published && hostel.id)
      .map((hostel) => ({
        id: hostel.id,
        name: hostel.name,
        address: hostel.address,
        description: hostel.description,
        booking_fee: hostel.booking_fee,
        amenities: normalizeAmenities(hostel.amenities),
        distance_from_campus: hostel.distance_from_campus,
        occupancy_type: hostel.occupancy_type,
        latitude: hostel.latitude,
        longitude: hostel.longitude,
        is_published: hostel.is_published,
        price_per_room: hostel.price_per_room,
        total_rooms: Number(hostel.total_rooms ?? 0),
        available_rooms: Number(hostel.available_rooms ?? 0),
        min_price: hostel.min_price,
        max_price: hostel.max_price,
        avg_price: hostel.avg_price,
        primary_image: normalizeImageUrl(hostel.primary_image),
      }));

    return res.json({
      success: true,
      data: {
        university: universityResult.rows[0],
        hostels: filteredHostels,
      },
    });
  } catch (error) {
    console.error('Public university hostels error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load university hostels' });
  }
});

router.get('/hostels', async (_req, res) => {
  try {
    const rows = await fetchHostelSummaries();
    const data = rows
      .filter((row) => row.is_published)
      .map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        description: row.description,
        booking_fee: row.booking_fee,
        amenities: normalizeAmenities(row.amenities),
        distance_from_campus: row.distance_from_campus,
        occupancy_type: row.occupancy_type,
        latitude: row.latitude,
        longitude: row.longitude,
        is_published: row.is_published,
        price_per_room: row.price_per_room,
        total_rooms: Number(row.total_rooms ?? 0),
        available_rooms: Number(row.available_rooms ?? 0),
        min_price: row.min_price,
        max_price: row.max_price,
        avg_price: row.avg_price,
        primary_image: normalizeImageUrl(row.primary_image),
      }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Public hostels list error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load hostels' });
  }
});

router.get('/hostels/:id', async (req, res) => {
  const hostelId = Number(req.params.id);
  if (Number.isNaN(hostelId)) {
    return res.status(400).json({ success: false, message: 'Invalid hostel id' });
  }

  try {
    const bookingsTableCheck = await pool.query("SELECT to_regclass('public.public_hostel_bookings') AS table_ref");
    const hasPublicBookingsTable = Boolean(bookingsTableCheck.rows[0]?.table_ref);

    const pendingBookingsJoin = hasPublicBookingsTable
      ? `
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS booking_count
          FROM public_hostel_bookings pb
          WHERE pb.room_id = r.id AND pb.status IN ('pending', 'booked', 'checked_in')
        ) pending_bookings ON TRUE
      `
      : `
        LEFT JOIN LATERAL (
          SELECT 0::bigint AS booking_count
        ) pending_bookings ON TRUE
      `;

    const hostelQuery = `
      WITH room_availability AS (
        SELECT
          r.hostel_id,
          COUNT(*) AS total_rooms,
          COUNT(*) FILTER (
            WHERE (r.status IS NULL OR r.status = 'available')
              AND (r.capacity - COALESCE(active_assignments.active_count, 0) - COALESCE(pending_bookings.booking_count, 0)) > 0
          ) AS available_rooms,
          MIN(r.price) FILTER (WHERE r.price IS NOT NULL) AS min_price,
          MAX(r.price) FILTER (WHERE r.price IS NOT NULL) AS max_price,
          AVG(r.price) FILTER (WHERE r.price IS NOT NULL) AS avg_price
        FROM rooms r
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS active_count
          FROM student_room_assignments sra
          WHERE sra.room_id = r.id AND sra.status = 'active'
        ) active_assignments ON TRUE
        ${pendingBookingsJoin}
        GROUP BY r.hostel_id
      )
      SELECT 
        h.id,
        h.name,
        h.address,
        h.description,
        h.booking_fee,
        h.amenities,
        h.distance_from_campus,
        h.occupancy_type,
        h.latitude,
        h.longitude,
        h.is_published,
        h.price_per_room,
        h.contact_phone,
        h.contact_email,
        h.university_id,
        u.name AS university_name,
        u.code AS university_code,
        u.address AS university_address,
        ra.total_rooms,
        ra.available_rooms,
        ra.min_price,
        ra.max_price,
        ra.avg_price
      FROM hostels h
      LEFT JOIN universities u ON u.id = h.university_id
      LEFT JOIN room_availability ra ON ra.hostel_id = h.id
      WHERE h.id = $1 AND h.is_published = TRUE
    `;

    const hostelResult = await pool.query(hostelQuery, [hostelId]);
    if (hostelResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Hostel not found or not published' });
    }

    const hostel = hostelResult.rows[0] as HostelDetailRow;

    const imagesResult = await pool.query(
      `SELECT id, image_url, caption, is_primary
      FROM hostel_images
      WHERE hostel_id = $1
       ORDER BY is_primary DESC, display_order ASC, id ASC`,
      [hostelId],
    );

    const semestersResult = await pool.query(
      `SELECT id, name, academic_year, start_date, end_date, status
      FROM semesters
      WHERE hostel_id = $1
       ORDER BY start_date DESC NULLS LAST, id DESC`,
      [hostelId],
    );

    const roomsResult = await pool.query(
      `
      SELECT
        r.id,
        r.room_number,
        r.capacity,
        r.status,
        r.price,
        r.description,
        r.self_contained,
        COALESCE(active_assignments.active_count, 0) AS active_occupants,
        COALESCE(pending_bookings.booking_count, 0) AS pending_bookings,
        COALESCE(active_assignments.active_count, 0) + COALESCE(pending_bookings.booking_count, 0) AS occupied_count,
        GREATEST(
          r.capacity - COALESCE(active_assignments.active_count, 0) - COALESCE(pending_bookings.booking_count, 0),
          0
        ) AS available_spaces
      FROM rooms r
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS active_count
          FROM student_room_assignments sra
          WHERE sra.room_id = r.id AND sra.status = 'active'
        ) active_assignments ON TRUE
        ${pendingBookingsJoin}
      WHERE r.hostel_id = $1
      ORDER BY r.room_number ASC
      `,
      [hostelId],
    );

    const data = {
      id: hostel.id,
      name: hostel.name,
      address: hostel.address,
      description: hostel.description,
      booking_fee: hostel.booking_fee,
      amenities: normalizeAmenities(hostel.amenities),
      distance_from_campus: hostel.distance_from_campus,
      occupancy_type: hostel.occupancy_type,
      latitude: hostel.latitude,
      longitude: hostel.longitude,
      is_published: hostel.is_published,
      price_per_room: hostel.price_per_room,
      contact_phone: hostel.contact_phone,
      contact_email: hostel.contact_email,
      university_id: hostel.university_id,
      university_name: hostel.university_name,
      university_code: hostel.university_code,
      university_address: hostel.university_address,
      total_rooms: Number(hostel.total_rooms ?? 0),
      available_rooms: Number(hostel.available_rooms ?? 0),
      room_stats: hostel.total_rooms !== null
        ? {
            total_rooms: Number(hostel.total_rooms ?? 0),
            available_rooms: Number(hostel.available_rooms ?? 0),
            min_price: hostel.min_price,
            max_price: hostel.max_price,
            avg_price: hostel.avg_price,
          }
        : null,
      images: imagesResult.rows.map((row) => ({
        id: row.id,
        image_url: normalizeImageUrl(row.image_url) || '',
        caption: row.caption,
        is_primary: row.is_primary,
      })),
      room_list: roomsResult.rows.map((room) => ({
        id: room.id,
        room_number: room.room_number,
        capacity: Number(room.capacity ?? 0),
        status: room.status,
        price: room.price !== null ? Number(room.price) : null,
        description: room.description,
        self_contained: room.self_contained,
        occupied_count: Number(room.occupied_count ?? 0),
        available_spaces: Number(room.available_spaces ?? 0),
      })),
      semesters: semestersResult.rows,
    };

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Public hostel detail error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load hostel detail' });
  }
});

router.post('/hostels/:id/bookings', async (req, res) => {
  const hostelId = Number(req.params.id);
  if (Number.isNaN(hostelId)) {
    return res.status(400).json({ success: false, message: 'Invalid hostel id' });
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

  const semesterInt = parseInt(String(semesterId), 10);
  if (Number.isNaN(semesterInt)) {
    return res.status(400).json({ success: false, message: 'Semester selection is required' });
  }

  const roomInt = parseInt(String(roomId), 10);
  if (Number.isNaN(roomInt)) {
    return res.status(400).json({ success: false, message: 'Room selection is required' });
  }

  const client = await pool.connect();
  try {
    const hostelResult = await client.query(
      `SELECT id, name, booking_fee, price_per_room, university_id
        FROM hostels
       WHERE id = $1 AND is_published = TRUE`,
      [hostelId],
    );

    if (hostelResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Hostel not found or not published' });
    }

    const hostel = hostelResult.rows[0];

    const semesterResult = await client.query(
      `SELECT id, name, academic_year FROM semesters WHERE id = $1 AND hostel_id = $2`,
      [semesterInt, hostelId],
    );
    if (semesterResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Semester not available for this hostel' });
    }

    const roomResult = await client.query(
      `SELECT id, room_number, capacity, price FROM rooms WHERE id = $1 AND hostel_id = $2`,
      [roomInt, hostelId],
    );
    if (roomResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Room not available for this hostel' });
    }

    const room = roomResult.rows[0];
    const roomCapacity = Number(room.capacity ?? 0);
    const roomPrice = room.price !== null && room.price !== undefined
      ? Number(room.price)
      : hostel.price_per_room !== null && hostel.price_per_room !== undefined
        ? Number(hostel.price_per_room)
        : Number(hostel.booking_fee ?? 0);

    const bookingFee = Number(hostel.booking_fee ?? 0);

    const normalizedBookingFee = Math.max(0, bookingFee);
    const amountDue = Math.max(roomPrice, normalizedBookingFee);
    const amountPaid = Math.min(normalizedBookingFee, amountDue);
    const outstandingBalance = Math.max(amountDue - amountPaid, 0);

    const occupancyCheck = await client.query(
      `
        SELECT
          $1::INT AS capacity,
          COALESCE((
            SELECT COUNT(*) FROM public_hostel_bookings pb
            WHERE pb.room_id = $2
              AND pb.semester_id = $3
              AND pb.status IN ('pending', 'booked', 'checked_in')
          ), 0) AS pending_bookings,
          COALESCE((
            SELECT COUNT(*) FROM student_room_assignments sra
            WHERE sra.room_id = $2
              AND sra.status = 'active'
              AND (sra.semester_id = $3 OR $3 IS NULL)
          ), 0) AS active_assignments
      `,
      [roomCapacity, roomInt, semesterInt],
    );

    const occupancy = occupancyCheck.rows[0];
    const occupied = Number(occupancy.pending_bookings ?? 0) + Number(occupancy.active_assignments ?? 0);
    if (occupied >= roomCapacity) {
      return res.status(409).json({ success: false, message: 'Selected room is already fully booked' });
    }

    const reference = `RM-${hostelId}-${Date.now()}`;
    const verificationCode = generateVerificationCode();
    const resolvedCurrency =
      typeof currency === 'string' && currency.trim().length > 0 ? currency.trim().toUpperCase() : 'UGX';

    const parsedCheckIn =
      typeof preferredCheckIn === 'string' && preferredCheckIn.trim().length > 0
        ? new Date(preferredCheckIn)
        : null;
    const checkInDate = parsedCheckIn && !Number.isNaN(parsedCheckIn.valueOf()) ? parsedCheckIn : null;

    const parsedDob =
      typeof dateOfBirth === 'string' && dateOfBirth.trim().length > 0
        ? new Date(dateOfBirth)
        : null;
    const dob = parsedDob && !Number.isNaN(parsedDob.valueOf()) ? parsedDob : null;

    const insertQuery = `
      INSERT INTO public_hostel_bookings (
        hostel_id,
        university_id,
        semester_id,
        room_id,
        source,
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
        verification_issued_at
      ) VALUES (
        $1, $2, $3, $4, 'online',
        $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, 'paid', 'booked', $23, NOW()
      )
      RETURNING *
    `;

    const values = [
      hostelId,
      hostel.university_id ?? null,
      semesterInt,
      roomInt,
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
      normalizedBookingFee,
      amountDue,
      amountPaid,
      (paymentPhone || phone).trim(),
      reference,
      verificationCode,
    ];

    const inserted = await client.query(insertQuery, values);
    const booking = inserted.rows[0];

    const availabilityQuery = `
      SELECT 
          COUNT(DISTINCT CASE 
            WHEN r.id IS NOT NULL 
            AND (r.status IS NULL OR r.status = 'available')
            AND (r.capacity - COALESCE(active_assignments.active_count, 0) - COALESCE(pending_bookings.booking_count, 0)) > 0
            THEN r.id
        END) AS available_rooms
      FROM rooms r
        LEFT JOIN LATERAL (
        SELECT COUNT(*) AS active_count
          FROM student_room_assignments sra
          WHERE sra.room_id = r.id AND sra.status = 'active'
      ) active_assignments ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS booking_count
        FROM public_hostel_bookings pb
        WHERE pb.room_id = r.id AND pb.status IN ('pending', 'booked', 'checked_in')
      ) pending_bookings ON TRUE
      WHERE r.hostel_id = $1
    `;

    const availabilityResult = await client.query(availabilityQuery, [hostelId]);
    const availableRooms = Number(availabilityResult.rows[0]?.available_rooms ?? 0);

    const roomAvailability = Math.max(roomCapacity - (occupied + 1), 0);

    await EmailService.sendEmailAsync({
      to: email.trim(),
      subject: `Your Booking Confirmation for ${hostel.name}`,
      html: EmailService.generatePublicBookingConfirmationEmail({
        studentName: fullName.trim(),
        studentEmail: email.trim(),
        studentPhone: phone.trim(),
        registrationNumber: registrationNumber?.trim() || null,
        course: course?.trim() || null,
        semesterName: semesterResult.rows[0]?.name || null,
        hostelName: hostel.name,
        verificationCode,
        bookingReference: reference,
        bookingFee: normalizedBookingFee,
        roomPrice: amountDue,
        outstandingBalance,
        currency: resolvedCurrency,
        paymentPhone: (paymentPhone || phone).trim(),
        roomNumber: room.room_number ?? null,
        availableSpaces: roomAvailability,
        availableRooms,
        portalUrl: process.env.PUBLIC_PORTAL_URL || process.env.FRONTEND_URL || 'http://localhost:3000',
      }),
    });

    return res.status(201).json({
      success: true,
      message: 'Booking request received and payment marked as received for demonstration purposes.',
      data: {
        id: booking.id,
        booking_fee: Number(booking.booking_fee ?? 0),
        amount_due: Number(booking.amount_due ?? amountDue),
        amount_paid: Number(booking.amount_paid ?? amountPaid),
        outstanding_balance: outstandingBalance,
        room_price: amountDue,
        payment_reference: booking.payment_reference,
        payment_status: booking.payment_status,
        status: booking.status,
        created_at: booking.created_at,
        semester_id: booking.semester_id,
        room_id: booking.room_id,
        verification_code: booking.verification_code,
        available_rooms: availableRooms,
        room_available_spaces: roomAvailability,
        room_number: room.room_number ?? null,
        currency: booking.currency,
      },
    });
  } catch (error) {
    console.error('Public booking creation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit booking request' });
  } finally {
    client.release();
  }
});

export default router;
