import express from 'express';
import pool from '../config/database';
import { HostelModel } from '../models/Hostel';

const router = express.Router();

// Get all published hostels (public endpoint)
router.get('/hostels', async (req, res) => {
  try {
    const {
      search,
      university_id,
      region_id,
      min_price,
      max_price,
      occupancy_type,
      min_available_rooms,
      page = '1',
      limit = '20'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    // Build WHERE clause
    let whereConditions = ['h.is_published = TRUE'];
    const params: any[] = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      whereConditions.push(`(h.name ILIKE $${paramCount} OR h.address ILIKE $${paramCount} OR h.description ILIKE $${paramCount} OR u.name ILIKE $${paramCount} OR u.code ILIKE $${paramCount})`);
      params.push(`%${search}%`);
    }

    if (university_id) {
      paramCount++;
      whereConditions.push(`h.university_id = $${paramCount}`);
      params.push(parseInt(university_id as string));
    }

    if (region_id) {
      paramCount++;
      whereConditions.push(`u.region_id = $${paramCount}`);
      params.push(parseInt(region_id as string));
    }

    if (min_price) {
      paramCount++;
      whereConditions.push(`h.price_per_room >= $${paramCount}`);
      params.push(parseInt(min_price as string));
    }

    if (max_price) {
      paramCount++;
      whereConditions.push(`h.price_per_room <= $${paramCount}`);
      params.push(parseInt(max_price as string));
    }

    if (occupancy_type) {
      paramCount++;
      whereConditions.push(`h.occupancy_type = $${paramCount}`);
      params.push(occupancy_type);
    }

    // Note: min_available_rooms filter will be applied in a subquery since available_rooms is calculated dynamically

    // Ensure we always have at least one condition for WHERE clause if min_available_rooms filter is used
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : (min_available_rooms ? 'WHERE TRUE' : '');

        // Get hostels with university and region info
    // Calculate available rooms dynamically based on room assignments
    // Use a subquery to calculate available rooms for each hostel
    const query = `
      WITH hostel_availability AS (
        SELECT
          h.id as hostel_id,
          COUNT(DISTINCT CASE 
            WHEN r.id IS NOT NULL AND r.status = 'available' 
            AND (r.capacity - COALESCE(occupant_count.current_occupants, 0)) > 0 
            THEN r.id 
          END) as available_rooms_count
        FROM hostels h
        LEFT JOIN rooms r ON r.hostel_id = h.id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) as current_occupants
          FROM student_room_assignments sra
          WHERE sra.room_id = r.id AND sra.status = 'active'
        ) occupant_count ON true
        GROUP BY h.id
      )
      SELECT
        h.id,
        h.name,
        h.address,
        h.description,
        h.total_rooms,
        COALESCE(ha.available_rooms_count, 0) as available_rooms,
        h.contact_phone,
        h.contact_email,
        h.price_per_room,
        h.occupancy_type,
        h.distance_from_campus,
        h.amenities,
        h.latitude,
        h.longitude,
        h.created_at,
        u.name as university_name,
        u.code as university_code,
        r.name as region_name,
        (
          SELECT image_url
          FROM hostel_images
          WHERE hostel_id = h.id AND is_primary = TRUE
          LIMIT 1
        ) as primary_image
      FROM hostels h
      LEFT JOIN universities u ON h.university_id = u.id
      LEFT JOIN regions r ON u.region_id = r.id
      LEFT JOIN hostel_availability ha ON ha.hostel_id = h.id
      ${whereClause}
      ${min_available_rooms ? `AND COALESCE(ha.available_rooms_count, 0) >= $${++paramCount}` : ''}
      ORDER BY h.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    if (min_available_rooms) {
      params.push(parseInt(min_available_rooms as string));
    }

    params.push(limitNum, offset);

    // Get total count (without limit/offset params, but need to account for HAVING clause)
    const countParams: any[] = [];
    let countParamCount = 0;
    const countWhereConditions = ['h.is_published = TRUE'];

    if (search) {
      countParamCount++;
      countWhereConditions.push(`(h.name ILIKE $${countParamCount} OR h.address ILIKE $${countParamCount} OR h.description ILIKE $${countParamCount} OR u.name ILIKE $${countParamCount} OR u.code ILIKE $${countParamCount})`);
      countParams.push(`%${search}%`);
    }

    if (university_id) {
      countParamCount++;
      countWhereConditions.push(`h.university_id = $${countParamCount}`);
      countParams.push(parseInt(university_id as string));
    }

    if (region_id) {
      countParamCount++;
      countWhereConditions.push(`u.region_id = $${countParamCount}`);
      countParams.push(parseInt(region_id as string));
    }

    if (min_price) {
      countParamCount++;
      countWhereConditions.push(`h.price_per_room >= $${countParamCount}`);
      countParams.push(parseInt(min_price as string));
    }

    if (max_price) {
      countParamCount++;
      countWhereConditions.push(`h.price_per_room <= $${countParamCount}`);
      countParams.push(parseInt(max_price as string));
    }

    if (occupancy_type) {
      countParamCount++;
      countWhereConditions.push(`h.occupancy_type = $${countParamCount}`);
      countParams.push(occupancy_type);
    }

    // Ensure we always have at least one condition for WHERE clause
    const countWhereClause = countWhereConditions.length > 0 
      ? `WHERE ${countWhereConditions.join(' AND ')}` 
      : (min_available_rooms ? 'WHERE TRUE' : '');

    const countQuery = `
      WITH hostel_availability AS (
        SELECT
          h.id as hostel_id,
          COUNT(DISTINCT CASE 
            WHEN r.id IS NOT NULL AND r.status = 'available' 
            AND (r.capacity - COALESCE(occupant_count.current_occupants, 0)) > 0 
            THEN r.id 
          END) as available_rooms_count
        FROM hostels h
        LEFT JOIN rooms r ON r.hostel_id = h.id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) as current_occupants
          FROM student_room_assignments sra
          WHERE sra.room_id = r.id AND sra.status = 'active'
        ) occupant_count ON true
        GROUP BY h.id
      )
      SELECT COUNT(*) as total
      FROM hostels h
      LEFT JOIN universities u ON h.university_id = u.id
      LEFT JOIN hostel_availability ha ON ha.hostel_id = h.id
      ${countWhereClause}
      ${min_available_rooms ? `AND COALESCE(ha.available_rooms_count, 0) >= $${++countParamCount}` : ''}
    `;

    if (min_available_rooms && countParams.length > 0) {
      countParams.push(parseInt(min_available_rooms as string));
    } else if (min_available_rooms) {
      countParams.push(parseInt(min_available_rooms as string));
    }

    const [results, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams.length > 0 ? countParams : undefined)
    ]);

    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    res.json({
      success: true,
      data: results.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching public hostels:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hostels'
    });
  }
});

// Get single hostel details (public endpoint)
router.get('/hostels/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    // Get hostel details
    const hostelQuery = `
      SELECT 
        h.id,
        h.name,
        h.address,
        h.description,
        h.total_rooms,
        h.available_rooms,
        h.contact_phone,
        h.contact_email,
        h.price_per_room,
        h.occupancy_type,
        h.distance_from_campus,
        h.amenities,
        h.rules_and_regulations,
        h.latitude,
        h.longitude,
        h.created_at,
        u.name as university_name,
        u.code as university_code,
        u.address as university_address,
        r.name as region_name
      FROM hostels h
      LEFT JOIN universities u ON h.university_id = u.id
      LEFT JOIN regions r ON u.region_id = r.id
      WHERE h.id = $1 AND h.is_published = TRUE
    `;

    const hostelResult = await pool.query(hostelQuery, [id]);

    if (hostelResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hostel not found or not published'
      });
    }

    // Get hostel images
    const imagesQuery = `
      SELECT 
        id,
        image_url,
        caption,
        is_primary,
        display_order
      FROM hostel_images
      WHERE hostel_id = $1
      ORDER BY is_primary DESC, display_order ASC, created_at ASC
    `;

    const imagesResult = await pool.query(imagesQuery, [id]);

        // Get room statistics with dynamic available rooms calculation
    const roomsQuery = `
      SELECT
        COUNT(*) as total_rooms,
        COUNT(DISTINCT CASE 
          WHEN r.status = 'available' 
          AND (r.capacity - COALESCE(occupant_counts.current_occupants, 0)) > 0 
          THEN r.id 
        END) as available_rooms,
        MIN(r.price) as min_price,
        MAX(r.price) as max_price,
        AVG(r.price) as avg_price
      FROM rooms r
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as current_occupants
        FROM student_room_assignments sra
        WHERE sra.room_id = r.id AND sra.status = 'active'
      ) occupant_counts ON true
      WHERE r.hostel_id = $1
    `;

    const roomsResult = await pool.query(roomsQuery, [id]);

    // Calculate available rooms for the hostel (overriding the static value)
    const availableRoomsCount = parseInt(roomsResult.rows[0]?.available_rooms || '0', 10);

    res.json({
      success: true,
      data: {
        ...hostelResult.rows[0],
        available_rooms: availableRoomsCount, // Use dynamically calculated value
        images: imagesResult.rows,
        room_stats: roomsResult.rows[0] || null
      }
    });
  } catch (error) {
    console.error('Error fetching hostel details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hostel details'
    });
  }
});

// Get hostel images (public endpoint)
router.get('/hostels/:id/images', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    // Verify hostel is published
    const hostelCheck = await pool.query(
      'SELECT id FROM hostels WHERE id = $1 AND is_published = TRUE',
      [id]
    );

    if (hostelCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hostel not found or not published'
      });
    }

    const query = `
      SELECT 
        id,
        image_url,
        caption,
        is_primary,
        display_order
      FROM hostel_images
      WHERE hostel_id = $1
      ORDER BY is_primary DESC, display_order ASC, created_at ASC
    `;

    const result = await pool.query(query, [id]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching hostel images:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hostel images'
    });
  }
});

// Submit inquiry/contact form (public endpoint)
router.post('/hostels/:id/inquiry', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, email, phone, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and message are required'
      });
    }

    // Verify hostel is published
    const hostelCheck = await pool.query(
      'SELECT id, name, contact_email FROM hostels WHERE id = $1 AND is_published = TRUE',
      [id]
    );

    if (hostelCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hostel not found or not published'
      });
    }

    const hostel = hostelCheck.rows[0];

    // TODO: Send email to hostel admin using EmailService
    // For now, just return success

    res.json({
      success: true,
      message: 'Inquiry submitted successfully. The hostel will contact you soon.'
    });
  } catch (error) {
    console.error('Error submitting inquiry:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit inquiry'
    });
  }
});

// Get all universities (public endpoint)
router.get('/universities', async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        name,
        code,
        address,
        contact_email,
        contact_phone,
        website,
        status
      FROM universities
      WHERE status = 'active'
      ORDER BY name ASC
    `;

    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching universities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch universities'
    });
  }
});

// Get all regions (public endpoint)
router.get('/regions', async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        name,
        country
      FROM regions
      ORDER BY name ASC
    `;

    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch regions'
    });
  }
});

export default router;

