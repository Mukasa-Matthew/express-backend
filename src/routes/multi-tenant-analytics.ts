import express from 'express';
import pool from '../config/database';

const router = express.Router();

// Middleware to extract user context (you'd implement proper JWT verification)
const getUserContext = (req: any) => {
  // This would be extracted from JWT token in a real implementation
  return {
    userId: req.user?.id,
    role: req.user?.role,
    universityId: req.user?.university_id,
    hostelId: req.user?.hostel_id
  };
};

// Super Admin Analytics - Platform-wide statistics
router.get('/platform/overview', async (req, res) => {
  const client = await pool.connect();
  try {
    const [
      totalUniversitiesRes,
      totalHostelsRes,
      totalStudentsRes,
      totalHostelAdminsRes,
      totalUniversityAdminsRes,
      totalRoomsRes,
      occupiedRoomsRes,
    ] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS total FROM universities WHERE status = 'active'`),
      client.query(`SELECT COUNT(*)::int AS total FROM hostels`),
      client.query(
        `SELECT COUNT(*)::int AS total 
         FROM users 
         WHERE role = 'user' AND hostel_id IS NOT NULL`
      ),
      client.query(`SELECT COUNT(*)::int AS total FROM users WHERE role = 'hostel_admin'`),
      client.query(`SELECT COUNT(*)::int AS total FROM users WHERE role = 'university_admin'`),
      client.query(`SELECT COALESCE(SUM(total_rooms), 0)::int AS total FROM hostels`),
      client.query(
        `SELECT COALESCE(COUNT(DISTINCT room_id), 0)::int AS total 
         FROM student_room_assignments 
         WHERE status = 'active'`
      ),
    ]);

    const totalRooms = totalRoomsRes.rows[0]?.total ?? 0;
    const occupiedRooms = occupiedRoomsRes.rows[0]?.total ?? 0;
    const availableRooms = Math.max(totalRooms - occupiedRooms, 0);
    const occupancyRate =
      totalRooms > 0 ? Number(((occupiedRooms / totalRooms) * 100).toFixed(2)) : 0;

    res.json({
      success: true,
      data: {
        total_universities: totalUniversitiesRes.rows[0]?.total ?? 0,
        total_hostels: totalHostelsRes.rows[0]?.total ?? 0,
        total_students: totalStudentsRes.rows[0]?.total ?? 0,
        total_hostel_admins: totalHostelAdminsRes.rows[0]?.total ?? 0,
        total_university_admins: totalUniversityAdminsRes.rows[0]?.total ?? 0,
        total_rooms: totalRooms,
        available_rooms: availableRooms,
        occupied_rooms: occupiedRooms,
        overall_occupancy_rate: occupancyRate,
      },
    });
  } catch (error) {
    console.error('Get platform overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  } finally {
    client.release();
  }
});

// University-wise analytics
router.get('/universities/stats', async (req, res) => {
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
        u.id,
        u.name as university_name,
        u.code,
        COUNT(DISTINCT h.id) as hostel_count,
        COUNT(DISTINCT CASE WHEN us.role = 'user' THEN us.id END) as student_count,
        SUM(h.total_rooms) as total_rooms,
        SUM(h.total_rooms - COALESCE(aa.occupied_rooms_count, 0)) as available_rooms,
        SUM(COALESCE(aa.occupied_rooms_count, 0)) as occupied_rooms,
        CASE 
          WHEN SUM(h.total_rooms) > 0 THEN 
            ROUND((SUM(COALESCE(aa.occupied_rooms_count, 0))::numeric / SUM(h.total_rooms)::numeric) * 100, 2)
          ELSE 0 
        END as occupancy_rate,
        u.status
      FROM universities u
      LEFT JOIN regions r ON u.region_id = r.id
      LEFT JOIN hostels h ON h.university_id = u.id
      LEFT JOIN users us ON us.hostel_id = h.id
      LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
      GROUP BY u.id, u.name, u.code, u.status
      ORDER BY hostel_count DESC
    `;
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get university stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Region-wise analytics (works across all universities)
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
        r.id,
        r.name as region_name,
        r.country,
        COUNT(DISTINCT u.id) as university_count,
        COUNT(DISTINCT h.id) as hostel_count,
        COUNT(DISTINCT CASE WHEN us.role = 'user' THEN us.id END) as student_count,
        SUM(h.total_rooms) as total_rooms,
        SUM(h.total_rooms - COALESCE(aa.occupied_rooms_count, 0)) as available_rooms,
        SUM(COALESCE(aa.occupied_rooms_count, 0)) as occupied_rooms,
        CASE 
          WHEN SUM(h.total_rooms) > 0 THEN 
            ROUND((SUM(COALESCE(aa.occupied_rooms_count, 0))::numeric / SUM(h.total_rooms)::numeric) * 100, 2)
          ELSE 0 
        END as avg_occupancy_rate
      FROM regions r
      LEFT JOIN universities u ON u.region_id = r.id AND u.status = 'active'
      LEFT JOIN hostels h ON h.university_id = u.id
      LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
      LEFT JOIN users us ON us.hostel_id = h.id
      GROUP BY r.id, r.name, r.country
      ORDER BY hostel_count DESC
    `;
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get region stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// University Admin Analytics - University-specific statistics
router.get('/university/:universityId/overview', async (req, res) => {
  try {
    const { universityId } = req.params;
    const userContext = getUserContext(req);
    
    // Verify user has access to this university
    if (userContext.role === 'university_admin' && userContext.universityId !== parseInt(universityId)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied to this university' 
      });
    }

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
        u.name as university_name,
        u.code,
        COUNT(DISTINCT h.id) as total_hostels,
        COUNT(DISTINCT CASE WHEN us.role = 'user' THEN us.id END) as total_students,
        COUNT(DISTINCT CASE WHEN us.role = 'hostel_admin' THEN us.id END) as total_hostel_admins,
        SUM(h.total_rooms) as total_rooms,
        SUM(h.total_rooms - COALESCE(aa.occupied_rooms_count, 0)) as available_rooms,
        SUM(COALESCE(aa.occupied_rooms_count, 0)) as occupied_rooms,
        CASE 
          WHEN SUM(h.total_rooms) > 0 THEN 
            ROUND((SUM(COALESCE(aa.occupied_rooms_count, 0))::numeric / SUM(h.total_rooms)::numeric) * 100, 2)
          ELSE 0 
        END as occupancy_rate
      FROM universities u
      LEFT JOIN regions r ON u.region_id = r.id
      LEFT JOIN hostels h ON h.university_id = u.id
      LEFT JOIN users us ON us.hostel_id = h.id
      LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
      WHERE u.id = $1
      GROUP BY u.id, u.name, u.code
    `;
    const result = await pool.query(query, [universityId]);
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get university overview error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Hostel Admin Analytics - Hostel-specific statistics
router.get('/hostel/:hostelId/overview', async (req, res) => {
  try {
    const { hostelId } = req.params;
    const userContext = getUserContext(req);
    
    // Verify user has access to this hostel
    if (userContext.role === 'hostel_admin' && userContext.hostelId !== parseInt(hostelId)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied to this hostel' 
      });
    }

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
        h.name as hostel_name,
        h.address,
        u.name as university_name,
        COUNT(CASE WHEN us.role = 'user' THEN us.id END) as total_students,
        h.total_rooms,
        (h.total_rooms - COALESCE(aa.occupied_rooms_count, 0)) as available_rooms,
        COALESCE(aa.occupied_rooms_count, 0) as occupied_rooms,
        CASE 
          WHEN h.total_rooms > 0 THEN 
            ROUND((COALESCE(aa.occupied_rooms_count, 0)::numeric / h.total_rooms::numeric) * 100, 2)
          ELSE 0 
        END as occupancy_rate,
        h.status,
        hs.status as subscription_status,
        hs.end_date as subscription_end_date,
        sp.name as plan_name,
        EXTRACT(EPOCH FROM (hs.end_date - NOW())) / 86400 as days_until_expiry
      FROM hostels h
      LEFT JOIN universities u ON h.university_id = u.id
      LEFT JOIN users us ON us.hostel_id = h.id
      LEFT JOIN hostel_subscriptions hs ON h.current_subscription_id = hs.id
      LEFT JOIN subscription_plans sp ON hs.plan_id = sp.id
      LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
      WHERE h.id = $1
      GROUP BY h.id, h.name, h.address, u.name, h.total_rooms, aa.occupied_rooms_count, h.status, hs.status, hs.end_date, sp.name
    `;
    const result = await pool.query(query, [hostelId]);
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get hostel overview error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get all regions for dropdowns
router.get('/regions', async (req, res) => {
  try {
    const query = 'SELECT * FROM regions ORDER BY name';
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get regions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

export default router;
