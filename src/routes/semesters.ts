import express from 'express';
import { SemesterModel, SemesterEnrollmentModel, GlobalSemesterModel } from '../models/Semester';
import { SemesterService } from '../services/semesterService';
import pool from '../config/database';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Helper function to verify token
function verifyToken(req: express.Request): any {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
  } catch {
    return null;
  }
}

// Helper function to get hostel ID for user
async function getHostelIdForUser(userId: number, role: string): Promise<number | null> {
  if (role === 'super_admin') {
    return null; // Super admin can access all hostels
  }
  
  if (role === 'hostel_admin') {
    const result = await pool.query('SELECT hostel_id FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.hostel_id || null;
  }
  
  if (role === 'custodian') {
    // For custodians, get hostel_id from custodians table first, fallback to users table
    const custodianResult = await pool.query('SELECT hostel_id FROM custodians WHERE user_id = $1', [userId]);
    const fromCustodians = custodianResult.rows[0]?.hostel_id || null;
    if (fromCustodians) return fromCustodians;
    
    const result = await pool.query('SELECT hostel_id FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.hostel_id || null;
  }
  
  return null;
}

// Get all semesters for a hostel
router.get('/hostel/:hostelId', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const hostelId = parseInt(req.params.hostelId);
    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);

    // Check if user has access (super_admin can access all, others only their hostel)
    if (decoded.role !== 'super_admin' && userHostelId !== hostelId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const semesters = await SemesterModel.findByHostelId(hostelId);
    
    res.json({ success: true, semesters });
  } catch (error) {
    console.error('Error fetching semesters:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch semesters' });
  }
});

// Get current semester for a hostel
router.get('/hostel/:hostelId/current', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const hostelId = parseInt(req.params.hostelId);
    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);

    if (decoded.role !== 'super_admin' && userHostelId !== hostelId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const currentSemester = await SemesterModel.findCurrentByHostelId(hostelId);
    
    if (!currentSemester) {
      return res.status(404).json({ success: false, message: 'No current semester found' });
    }

    res.json({ success: true, semester: currentSemester });
  } catch (error) {
    console.error('Error fetching current semester:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch current semester' });
  }
});

// ========== GLOBAL SEMESTER ROUTES (Super Admin only) ==========

// Get all global semester templates (available to all authenticated users)
router.get('/global', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
      const globalSemesters = await GlobalSemesterModel.findAll();
      res.json({ success: true, globalSemesters });
    } catch (dbError: any) {
      // If table doesn't exist, return empty array (migration might not have run yet)
      if (dbError.code === '42P01' || dbError.message?.includes('does not exist')) {
        console.warn('global_semesters table does not exist yet, returning empty array');
        return res.json({ success: true, globalSemesters: [] });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Error fetching global semesters:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch global semesters' });
  }
});

// Create a global semester template
router.post('/global', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Semester name is required' });
    }

    try {
      const globalSemester = await GlobalSemesterModel.create({ name, description });
      return res.status(201).json({ success: true, globalSemester });
    } catch (error: any) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.warn('global_semesters table missing - skipping creation');
        return res.status(400).json({
          success: false,
          message: 'Global semesters feature is not available because the global_semesters table is missing. Please run the latest migrations.',
        });
      }
      throw error;
    }
  } catch (error: any) {
    console.error('Error creating global semester:', error);
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ success: false, message: 'Semester name already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create global semester' });
  }
});

// Update a global semester template
router.patch('/global/:id', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const id = parseInt(req.params.id);
    const { name, description, is_active } = req.body;

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (is_active !== undefined) updates.is_active = is_active;

    const globalSemester = await GlobalSemesterModel.update(id, updates);

    if (!globalSemester) {
      return res.status(404).json({ success: false, message: 'Global semester not found' });
    }

    res.json({ success: true, globalSemester });
  } catch (error) {
    console.error('Error updating global semester:', error);
    res.status(500).json({ success: false, message: 'Failed to update global semester' });
  }
});

// Delete a global semester template
router.delete('/global/:id', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const id = parseInt(req.params.id);
    const success = await GlobalSemesterModel.delete(id);

    if (!success) {
      return res.status(404).json({ success: false, message: 'Global semester not found' });
    }

    res.json({ success: true, message: 'Global semester deleted successfully' });
  } catch (error) {
    console.error('Error deleting global semester:', error);
    res.status(500).json({ success: false, message: 'Failed to delete global semester' });
  }
});

// ========== HOSTEL SEMESTER ROUTES ==========

// Create a new semester for a hostel (Only Custodians or Super Admin)
router.post('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    // Only custodians and super_admin can create semesters (hostel_admin should not create semesters)
    if (!decoded || (decoded.role !== 'super_admin' && decoded.role !== 'custodian')) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only custodians can create semesters. Hostel administrators can view semesters and reports.' 
      });
    }

    const { global_semester_id, name, academic_year, start_date, end_date } = req.body;

    // Get hostel_id - Super Admin provides it, others use their assigned hostel
    let hostel_id: number | null;
    if (decoded.role === 'super_admin') {
      hostel_id = req.body.hostel_id;
      if (!hostel_id) {
        return res.status(400).json({ success: false, message: 'Hostel ID is required for super admin' });
      }
    } else {
      // Use the helper function to get hostel_id (which checks custodians table for custodians)
      hostel_id = await getHostelIdForUser(decoded.userId, decoded.role);
      if (!hostel_id) {
        return res.status(400).json({ success: false, message: 'User not assigned to a hostel' });
      }
    }

    // For custodians and hostel admins, global_semester_id is required
    if (decoded.role !== 'super_admin' && !global_semester_id) {
      return res.status(400).json({ success: false, message: 'Semester template is required' });
    }

    if (!name || !academic_year || !start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Validate dates
    const start = new Date(start_date);
    const end = new Date(end_date);
    
    if (end <= start) {
      return res.status(400).json({ success: false, message: 'End date must be after start date' });
    }

    const semester = await SemesterModel.create({
      hostel_id,
      global_semester_id,
      name,
      academic_year,
      start_date: start,
      end_date: end
    });

    res.status(201).json({ success: true, semester });
  } catch (error) {
    console.error('Error creating semester:', error);
    res.status(500).json({ success: false, message: 'Failed to create semester' });
  }
});

// Set a semester as current (Hostel Admin, Custodian, or Super Admin)
router.post('/:semesterId/set-current', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const semesterId = parseInt(req.params.semesterId);
    const semester = await SemesterModel.findById(semesterId);

    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    // Check access
    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);
    if (decoded.role !== 'super_admin' && userHostelId !== semester.hostel_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await SemesterModel.setAsCurrent(semesterId, semester.hostel_id);

    res.json({ success: true, message: 'Semester set as current successfully' });
  } catch (error) {
    console.error('Error setting current semester:', error);
    res.status(500).json({ success: false, message: 'Failed to set current semester' });
  }
});

// Get semester by ID
router.get('/:id', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const semesterId = parseInt(req.params.id);
    const semester = await SemesterModel.findById(semesterId);

    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    // Check access
    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);
    if (decoded.role !== 'super_admin' && userHostelId !== semester.hostel_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, semester });
  } catch (error) {
    console.error('Error fetching semester:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch semester' });
  }
});

// Get semester statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const semesterId = parseInt(req.params.id);
    const semester = await SemesterModel.findById(semesterId);

    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    // Check access
    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);
    if (decoded.role !== 'super_admin' && userHostelId !== semester.hostel_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const stats = await SemesterModel.getStatistics(semesterId);

    if (!stats) {
      return res.status(404).json({ success: false, message: 'Statistics not found' });
    }

    // Calculate outstanding balance
    const outstandingResult = await pool.query(
      `SELECT 
        COALESCE(SUM(rm.price - COALESCE(total_paid.paid, 0)), 0) as outstanding
      FROM semester_enrollments se
      LEFT JOIN rooms rm ON se.room_id = rm.id
      LEFT JOIN (
        SELECT user_id, SUM(amount) as paid
        FROM payments
        WHERE semester_id = $1
        GROUP BY user_id
      ) total_paid ON se.user_id = total_paid.user_id
      WHERE se.semester_id = $1 AND se.enrollment_status = 'active'`,
      [semesterId]
    );

    stats.outstanding_balance = parseFloat(outstandingResult.rows[0]?.outstanding || 0);

    // Calculate occupancy rate
    const occupancyResult = await pool.query(
      `SELECT 
        COUNT(DISTINCT r.id) as total_rooms,
        COUNT(DISTINCT se.room_id) as occupied_rooms
      FROM rooms r
      LEFT JOIN semester_enrollments se ON r.id = se.room_id AND se.semester_id = $1 AND se.enrollment_status = 'active'
      WHERE r.hostel_id = (SELECT hostel_id FROM semesters WHERE id = $1)`,
      [semesterId]
    );

    const totalRooms = parseFloat(occupancyResult.rows[0]?.total_rooms || 0);
    const occupiedRooms = parseFloat(occupancyResult.rows[0]?.occupied_rooms || 0);
    stats.occupancy_rate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching semester statistics:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics' });
  }
});

// Update semester status (Hostel Admin, Custodian, or Super Admin)
router.patch('/:id/status', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const semesterId = parseInt(req.params.id);
    const semester = await SemesterModel.findById(semesterId);

    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    // Check access
    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);
    if (decoded.role !== 'super_admin' && userHostelId !== semester.hostel_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { status } = req.body;

    const validStatuses = ['upcoming', 'active', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const success = await SemesterModel.updateStatus(semesterId, status);

    if (!success) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    res.json({ success: true, message: 'Semester status updated successfully' });
  } catch (error) {
    console.error('Error updating semester status:', error);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

// Delete a semester
router.delete('/:id', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const semesterId = parseInt(req.params.id);
    const success = await SemesterModel.delete(semesterId);

    if (!success) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    res.json({ success: true, message: 'Semester deleted successfully' });
  } catch (error) {
    console.error('Error deleting semester:', error);
    res.status(500).json({ success: false, message: 'Failed to delete semester' });
  }
});

// Enroll a student in a semester
router.post('/:semesterId/enrollments', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const semesterId = parseInt(req.params.semesterId);
    const { user_id, room_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    // Check if user has access
    const semester = await SemesterModel.findById(semesterId);
    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);
    if (decoded.role !== 'super_admin' && userHostelId !== semester.hostel_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const enrollment = await SemesterEnrollmentModel.enroll(semesterId, user_id, room_id || null);

    res.status(201).json({ success: true, enrollment });
  } catch (error) {
    console.error('Error enrolling student:', error);
    res.status(500).json({ success: false, message: 'Failed to enroll student' });
  }
});

// Get all enrollments for a semester
router.get('/:semesterId/enrollments', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const semesterId = parseInt(req.params.semesterId);
    const semester = await SemesterModel.findById(semesterId);

    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    // Check access
    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);
    if (decoded.role !== 'super_admin' && userHostelId !== semester.hostel_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const enrollments = await SemesterEnrollmentModel.findBySemester(semesterId);

    res.json({ success: true, enrollments });
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch enrollments' });
  }
});

// Get enrollments for current semester of a hostel
router.get('/hostel/:hostelId/enrollments/current', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const hostelId = parseInt(req.params.hostelId);
    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);

    if (decoded.role !== 'super_admin' && userHostelId !== hostelId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const currentSemester = await SemesterModel.findCurrentByHostelId(hostelId);

    if (!currentSemester) {
      return res.json({ success: true, enrollments: [], message: 'No current semester' });
    }

    const enrollments = await SemesterEnrollmentModel.findBySemester(currentSemester.id);

    res.json({ success: true, enrollments, semester: currentSemester });
  } catch (error) {
    console.error('Error fetching current enrollments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch enrollments' });
  }
});

// Update enrollment status
router.patch('/enrollments/:enrollmentId/status', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const enrollmentId = parseInt(req.params.enrollmentId);
    const { status } = req.body;

    const validStatuses = ['active', 'completed', 'dropped', 'transferred'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    // Check access
    const enrollment = await pool.query(
      `SELECT se.*, s.hostel_id 
       FROM semester_enrollments se
       JOIN semesters s ON se.semester_id = s.id
       WHERE se.id = $1`,
      [enrollmentId]
    );

    if (!enrollment.rows[0]) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }

    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);
    if (decoded.role !== 'super_admin' && userHostelId !== enrollment.rows[0].hostel_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const success = await SemesterEnrollmentModel.updateStatus(enrollmentId, status);

    if (!success) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }

    res.json({ success: true, message: 'Enrollment status updated successfully' });
  } catch (error) {
    console.error('Error updating enrollment status:', error);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

// Drop a student from a semester
router.post('/enrollments/:enrollmentId/drop', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const enrollmentId = parseInt(req.params.enrollmentId);

    // Check access
    const enrollment = await pool.query(
      `SELECT se.*, s.hostel_id 
       FROM semester_enrollments se
       JOIN semesters s ON se.semester_id = s.id
       WHERE se.id = $1`,
      [enrollmentId]
    );

    if (!enrollment.rows[0]) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }

    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);
    if (decoded.role !== 'super_admin' && userHostelId !== enrollment.rows[0].hostel_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const success = await SemesterEnrollmentModel.drop(enrollmentId);

    if (!success) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }

    res.json({ success: true, message: 'Student dropped successfully' });
  } catch (error) {
    console.error('Error dropping student:', error);
    res.status(500).json({ success: false, message: 'Failed to drop student' });
  }
});

// Transfer a student to a different semester
router.post('/enrollments/:enrollmentId/transfer', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const enrollmentId = parseInt(req.params.enrollmentId);
    const { new_semester_id } = req.body;

    if (!new_semester_id) {
      return res.status(400).json({ success: false, message: 'New semester ID is required' });
    }

    const newEnrollment = await SemesterEnrollmentModel.transfer(enrollmentId, new_semester_id);

    res.json({ success: true, enrollment: newEnrollment, message: 'Student transferred successfully' });
  } catch (error) {
    console.error('Error transferring student:', error);
    res.status(500).json({ success: false, message: 'Failed to transfer student' });
  }
});

// Enable/disable semester mode for a hostel
router.patch('/hostel/:hostelId/semester-mode', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const hostelId = parseInt(req.params.hostelId);
    const { semester_mode, default_semester_fee } = req.body;

    const updates: any = {};
    if (semester_mode !== undefined) {
      updates.semester_mode = semester_mode;
    }
    if (default_semester_fee !== undefined) {
      updates.default_semester_fee = default_semester_fee;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No updates provided' });
    }

    const fields = Object.keys(updates);
    const values = fields.map(field => updates[field]);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

    const result = await pool.query(
      `UPDATE hostels SET ${setClause} WHERE id = $1 RETURNING id, name, semester_mode, default_semester_fee`,
      [hostelId, ...values]
    );

    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: 'Hostel not found' });
    }

    res.json({ success: true, hostel: result.rows[0] });
  } catch (error) {
    console.error('Error updating semester mode:', error);
    res.status(500).json({ success: false, message: 'Failed to update semester mode' });
  }
});

// Rollover semester - create new semester based on previous one (Hostel Admin, Custodian, or Super Admin)
router.post('/:semesterId/rollover', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const semesterId = parseInt(req.params.semesterId);
    const semester = await SemesterModel.findById(semesterId);

    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    // Check access
    const userHostelId = await getHostelIdForUser(decoded.userId, decoded.role);
    if (decoded.role !== 'super_admin' && userHostelId !== semester.hostel_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { name, academic_year, start_date, end_date } = req.body;

    if (!name || !academic_year || !start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const start = new Date(start_date);
    const end = new Date(end_date);

    if (end <= start) {
      return res.status(400).json({ success: false, message: 'End date must be after start date' });
    }

    const newSemester = await SemesterService.rolloverSemester(
      semesterId,
      name,
      academic_year,
      start,
      end
    );

    res.status(201).json({ success: true, semester: newSemester, message: 'Semester rolled over successfully' });
  } catch (error) {
    console.error('Error rolling over semester:', error);
    res.status(500).json({ success: false, message: 'Failed to rollover semester' });
  }
});

export default router;

