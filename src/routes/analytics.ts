import express from 'express';
import pool from '../config/database';

const router = express.Router();

// Get total hostels onboarded
router.get('/hostels/total', async (req, res) => {
  try {
    const query = 'SELECT COUNT(*) as total_hostels FROM hostels';
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: {
        total_hostels: parseInt(result.rows[0].total_hostels)
      }
    });
  } catch (error) {
    console.error('Get total hostels error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get total students across platform
router.get('/students/total', async (req, res) => {
  try {
    const query = `
      SELECT COUNT(*) as total_students 
      FROM users u
      WHERE u.role = 'user' 
      AND u.hostel_id IN (SELECT id FROM hostels)
    `;
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: {
        total_students: parseInt(result.rows[0].total_students)
      }
    });
  } catch (error) {
    console.error('Get total students error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get occupancy rates by hostel (prefer rooms table; fallback to hostels)
router.get('/occupancy/rates', async (req, res) => {
  try {
    const query = `
      WITH active_assignments AS (
        SELECT 
          r.hostel_id,
          COUNT(DISTINCT sra.id) as occupied_rooms_count
        FROM student_room_assignments sra
        JOIN rooms r ON sra.room_id = r.id
        WHERE sra.status = 'active'
        GROUP BY r.hostel_id
      )
      SELECT 
        h.id,
        h.name,
        h.status,
        h.total_rooms,
        (h.total_rooms - COALESCE(aa.occupied_rooms_count, 0)) as available_rooms,
        COALESCE(aa.occupied_rooms_count, 0) as occupied_rooms,
        CASE 
          WHEN h.total_rooms > 0 THEN 
            ROUND((COALESCE(aa.occupied_rooms_count, 0)::numeric / h.total_rooms::numeric) * 100, 2)
          ELSE 0 
        END AS occupancy_rate
      FROM hostels h
      LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
      ORDER BY occupancy_rate DESC`;

    const result = await pool.query(query);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get occupancy rates error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get region-wise growth and adoption stats
router.get('/regions/stats', async (req, res) => {
  try {
    const query = `
      WITH active_assignments AS (
        SELECT 
          r.hostel_id,
          COUNT(DISTINCT sra.id) as occupied_rooms_count
        FROM student_room_assignments sra
        JOIN rooms r ON sra.room_id = r.id
        WHERE sra.status = 'active'
        GROUP BY r.hostel_id
      )
      SELECT 
        CASE 
          WHEN h.address ILIKE '%kampala%' THEN 'Kampala'
          WHEN h.address ILIKE '%jinja%' THEN 'Jinja'
          WHEN h.address ILIKE '%mbarara%' THEN 'Mbarara'
          WHEN h.address ILIKE '%gulu%' THEN 'Gulu'
          WHEN h.address ILIKE '%masaka%' THEN 'Masaka'
          ELSE 'Other'
        END as region,
        COUNT(*) as hostel_count,
        SUM(h.total_rooms) as total_rooms,
        SUM(h.total_rooms - COALESCE(aa.occupied_rooms_count, 0)) as available_rooms,
        SUM(COALESCE(aa.occupied_rooms_count, 0)) as occupied_rooms,
        CASE 
          WHEN SUM(h.total_rooms) > 0 THEN 
            ROUND((SUM(COALESCE(aa.occupied_rooms_count, 0))::numeric / SUM(h.total_rooms)::numeric) * 100, 2)
          ELSE 0 
        END as avg_occupancy_rate
      FROM hostels h
      LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
      GROUP BY 
        CASE 
          WHEN h.address ILIKE '%kampala%' THEN 'Kampala'
          WHEN h.address ILIKE '%jinja%' THEN 'Jinja'
          WHEN h.address ILIKE '%mbarara%' THEN 'Mbarara'
          WHEN h.address ILIKE '%gulu%' THEN 'Gulu'
          WHEN h.address ILIKE '%masaka%' THEN 'Masaka'
          ELSE 'Other'
        END
      ORDER BY hostel_count DESC`;
    const result = await pool.query(query);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get region stats error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get overall platform statistics
router.get('/overview', async (req, res) => {
  try {
    const query = `
      WITH active_assignments AS (
        SELECT 
          r.hostel_id,
          COUNT(DISTINCT sra.id) as occupied_rooms_count
        FROM student_room_assignments sra
        JOIN rooms r ON sra.room_id = r.id
        WHERE sra.status = 'active'
        GROUP BY r.hostel_id
      ),
      hostel_occupancy AS (
        SELECT
          h.id,
          h.total_rooms,
          COALESCE(aa.occupied_rooms_count, 0) as occupied_rooms
        FROM hostels h
        LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
      )
      SELECT 
        (SELECT COUNT(*) FROM hostels) as total_hostels,
        (SELECT COUNT(*) FROM users u WHERE u.role = 'user' AND u.hostel_id IN (SELECT id FROM hostels)) as total_students,
        (SELECT COUNT(*) FROM users WHERE role = 'hostel_admin') as total_admins,
        (SELECT COALESCE(SUM(total_rooms), 0) FROM hostel_occupancy) as total_rooms,
        (SELECT COALESCE(SUM(total_rooms - occupied_rooms), 0) FROM hostel_occupancy) as available_rooms,
        (SELECT COALESCE(SUM(occupied_rooms), 0) FROM hostel_occupancy) as occupied_rooms,
        CASE 
          WHEN (SELECT COALESCE(SUM(total_rooms), 0) FROM hostel_occupancy) > 0 THEN 
            ROUND(((SELECT COALESCE(SUM(occupied_rooms), 0) FROM hostel_occupancy)::numeric
                   /
                   (SELECT COALESCE(SUM(total_rooms), 0) FROM hostel_occupancy)::numeric) * 100, 2)
          ELSE 0
        END as overall_occupancy_rate`;

    const result = await pool.query(query);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get overview stats error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Hostel-specific overview: prefers rooms table; falls back to hostels row
router.get('/hostel/:id/overview', async (req, res) => {
  try {
    const hostelId = Number(req.params.id);
    if (!Number.isFinite(hostelId)) {
      return res.status(400).json({ success: false, message: 'Invalid hostel id' });
    }

    const query = `
      WITH active_assignments AS (
        SELECT 
          r.hostel_id,
          COUNT(DISTINCT sra.id) as occupied_rooms_count
        FROM student_room_assignments sra
        JOIN rooms r ON sra.room_id = r.id
        WHERE sra.status = 'active' AND r.hostel_id = $1
        GROUP BY r.hostel_id
      )
      SELECT 
        h.name as hostel_name,
        (SELECT COUNT(*) FROM users u WHERE u.role = 'user' AND u.hostel_id = h.id) AS total_students,
        h.total_rooms,
        (h.total_rooms - COALESCE(aa.occupied_rooms_count, 0)) as available_rooms,
        COALESCE(aa.occupied_rooms_count, 0) as occupied_rooms
      FROM hostels h
      LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
      WHERE h.id = $1
      LIMIT 1`;

    const result = await pool.query(query, [hostelId]);
    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: 'Hostel not found' });
    }
    const row = result.rows[0];
    const total = Number(row.total_rooms || 0);
    const occupied = Number(row.occupied_rooms || 0);
    const rate = total > 0 ? Math.round((occupied / total) * 10000) / 100 : 0;
    res.json({ success: true, data: { 
      hostel_name: row.hostel_name,
      total_students: Number(row.total_students || 0),
      total_rooms: total,
      available_rooms: Number(row.available_rooms || Math.max(total - occupied, 0)),
      occupied_rooms: occupied,
      occupancy_rate: rate
    }});
  } catch (error) {
    console.error('Get hostel overview error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
