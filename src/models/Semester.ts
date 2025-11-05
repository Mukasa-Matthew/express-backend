import pool from '../config/database';

export interface GlobalSemester {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Semester {
  id: number;
  hostel_id: number;
  global_semester_id: number | null;
  name: string;
  academic_year: string;
  start_date: Date;
  end_date: Date;
  is_current: boolean;
  status: 'upcoming' | 'active' | 'completed' | 'cancelled';
  created_at: Date;
  updated_at: Date;
}

export interface CreateSemesterData {
  hostel_id: number;
  global_semester_id?: number | null;
  name: string;
  academic_year: string;
  start_date: Date;
  end_date: Date;
}

export interface CreateGlobalSemesterData {
  name: string;
  description?: string | null;
}

export interface SemesterEnrollment {
  id: number;
  semester_id: number;
  user_id: number;
  room_id: number | null;
  enrollment_date: Date;
  enrollment_status: 'active' | 'completed' | 'dropped' | 'transferred';
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SemesterStats {
  semester_id: number;
  semester_name: string;
  total_students: number;
  active_students: number;
  completed_students: number;
  total_revenue: number;
  total_payments: number;
  outstanding_balance: number;
  occupancy_rate: number;
}

export class GlobalSemesterModel {
  /**
   * Create a new global semester template
   */
  static async create(globalSemesterData: CreateGlobalSemesterData): Promise<GlobalSemester> {
    const result = await pool.query(
      `INSERT INTO global_semesters (name, description)
       VALUES ($1, $2)
       RETURNING *`,
      [globalSemesterData.name, globalSemesterData.description || null]
    );
    return result.rows[0];
  }

  /**
   * Find all global semesters
   */
  static async findAll(): Promise<GlobalSemester[]> {
    const result = await pool.query(
      'SELECT * FROM global_semesters ORDER BY name ASC'
    );
    return result.rows;
  }

  /**
   * Find global semester by ID
   */
  static async findById(id: number): Promise<GlobalSemester | null> {
    const result = await pool.query('SELECT * FROM global_semesters WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  /**
   * Update global semester
   */
  static async update(id: number, updates: Partial<GlobalSemester>): Promise<GlobalSemester | null> {
    const fields = Object.keys(updates).filter(key => key !== 'id' && key !== 'created_at' && key !== 'updated_at');
    const values = fields.map(field => updates[field as keyof GlobalSemester]);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    
    if (fields.length === 0) return null;
    
    const result = await pool.query(
      `UPDATE global_semesters SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    return result.rows[0] || null;
  }

  /**
   * Delete (hard delete) global semester
   */
  static async delete(id: number): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM global_semesters WHERE id = $1',
      [id]
    );
    return (result.rowCount || 0) > 0;
  }
}

export class SemesterModel {
  /**
   * Create a new semester for a hostel
   */
  static async create(semesterData: CreateSemesterData): Promise<Semester> {
    const result = await pool.query(
      `INSERT INTO semesters (hostel_id, global_semester_id, name, academic_year, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'upcoming')
       RETURNING *`,
      [
        semesterData.hostel_id,
        semesterData.global_semester_id || null,
        semesterData.name,
        semesterData.academic_year,
        semesterData.start_date,
        semesterData.end_date
      ]
    );
    return result.rows[0];
  }

  /**
   * Find semester by ID
   */
  static async findById(id: number): Promise<Semester | null> {
    const result = await pool.query('SELECT * FROM semesters WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  /**
   * Find all semesters for a hostel
   */
  static async findByHostelId(hostelId: number): Promise<Semester[]> {
    const result = await pool.query(
      'SELECT * FROM semesters WHERE hostel_id = $1 ORDER BY start_date DESC',
      [hostelId]
    );
    return result.rows;
  }

  /**
   * Find current active semester for a hostel
   */
  static async findCurrentByHostelId(hostelId: number): Promise<Semester | null> {
    const result = await pool.query(
      `SELECT * FROM semesters 
       WHERE hostel_id = $1 AND is_current = true AND status = 'active'
       ORDER BY start_date DESC LIMIT 1`,
      [hostelId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get upcoming semesters for a hostel
   */
  static async findUpcomingByHostelId(hostelId: number): Promise<Semester[]> {
    const result = await pool.query(
      `SELECT * FROM semesters 
       WHERE hostel_id = $1 AND status = 'upcoming'
       ORDER BY start_date ASC`,
      [hostelId]
    );
    return result.rows;
  }

  /**
   * Set a semester as current (automatically unsets others)
   */
  static async setAsCurrent(semesterId: number, hostelId: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Unset all current semesters for this hostel
      await client.query(
        'UPDATE semesters SET is_current = false WHERE hostel_id = $1',
        [hostelId]
      );

      // Set this semester as current
      await client.query(
        'UPDATE semesters SET is_current = true, status = $1 WHERE id = $2',
        ['active', semesterId]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update semester status
   */
  static async updateStatus(id: number, status: Semester['status']): Promise<boolean> {
    const result = await pool.query(
      'UPDATE semesters SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, id]
    );
    return (result.rowCount || 0) > 0;
  }

  /**
   * Delete a semester
   */
  static async delete(id: number): Promise<boolean> {
    const result = await pool.query('DELETE FROM semesters WHERE id = $1', [id]);
    return (result.rowCount || 0) > 0;
  }

  /**
   * Get semester statistics
   */
  static async getStatistics(semesterId: number): Promise<SemesterStats | null> {
    const result = await pool.query(
      `SELECT 
        s.id as semester_id,
        s.name as semester_name,
        COUNT(DISTINCT se.user_id) as total_students,
        COUNT(DISTINCT CASE WHEN se.enrollment_status = 'active' THEN se.user_id END) as active_students,
        COUNT(DISTINCT CASE WHEN se.enrollment_status = 'completed' THEN se.user_id END) as completed_students,
        COALESCE(SUM(p.amount), 0) as total_revenue,
        COUNT(DISTINCT p.id) as total_payments
      FROM semesters s
      LEFT JOIN semester_enrollments se ON s.id = se.semester_id
      LEFT JOIN payments p ON s.id = p.semester_id
      WHERE s.id = $1
      GROUP BY s.id, s.name`,
      [semesterId]
    );

    if (!result.rows[0]) return null;

    const stats = result.rows[0];
    return {
      semester_id: stats.semester_id,
      semester_name: stats.semester_name,
      total_students: parseInt(stats.total_students) || 0,
      active_students: parseInt(stats.active_students) || 0,
      completed_students: parseInt(stats.completed_students) || 0,
      total_revenue: parseFloat(stats.total_revenue) || 0,
      total_payments: parseInt(stats.total_payments) || 0,
      outstanding_balance: 0, // Will be calculated separately
      occupancy_rate: 0 // Will be calculated separately
    };
  }
}

export class SemesterEnrollmentModel {
  /**
   * Enroll a student in a semester
   */
  static async enroll(
    semesterId: number,
    userId: number,
    roomId: number | null = null
  ): Promise<SemesterEnrollment> {
    const result = await pool.query(
      `INSERT INTO semester_enrollments (semester_id, user_id, room_id, enrollment_status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (semester_id, user_id) 
       DO UPDATE SET enrollment_status = 'active', updated_at = NOW()
       RETURNING *`,
      [semesterId, userId, roomId]
    );
    return result.rows[0];
  }

  /**
   * Get enrollment by semester and user
   */
  static async findBySemesterAndUser(
    semesterId: number,
    userId: number
  ): Promise<SemesterEnrollment | null> {
    const result = await pool.query(
      'SELECT * FROM semester_enrollments WHERE semester_id = $1 AND user_id = $2',
      [semesterId, userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all enrollments for a semester
   */
  static async findBySemester(semesterId: number): Promise<SemesterEnrollment[]> {
    const result = await pool.query(
      `SELECT 
        se.*,
        u.name as user_name,
        u.email as user_email,
        r.room_number as room_number
       FROM semester_enrollments se
       LEFT JOIN users u ON se.user_id = u.id
       LEFT JOIN rooms r ON se.room_id = r.id
       WHERE se.semester_id = $1 
       ORDER BY se.created_at DESC`,
      [semesterId]
    );
    return result.rows;
  }

  /**
   * Get all enrollments for a user across semesters
   */
  static async findByUser(userId: number): Promise<SemesterEnrollment[]> {
    const result = await pool.query(
      `SELECT se.*, s.name as semester_name, s.start_date, s.end_date
       FROM semester_enrollments se
       JOIN semesters s ON se.semester_id = s.id
       WHERE se.user_id = $1
       ORDER BY s.start_date DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Update enrollment status
   */
  static async updateStatus(
    id: number,
    status: SemesterEnrollment['enrollment_status']
  ): Promise<boolean> {
    const result = await pool.query(
      `UPDATE semester_enrollments 
       SET enrollment_status = $1, updated_at = NOW(),
           completed_at = CASE WHEN $1 IN ('completed', 'dropped', 'transferred') THEN NOW() ELSE completed_at END
       WHERE id = $2`,
      [status, id]
    );
    return (result.rowCount || 0) > 0;
  }

  /**
   * Transfer student to different semester
   */
  static async transfer(
    enrollmentId: number,
    newSemesterId: number
  ): Promise<SemesterEnrollment> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get old enrollment
      const oldEnrollment = await client.query(
        'SELECT * FROM semester_enrollments WHERE id = $1',
        [enrollmentId]
      );

      if (!oldEnrollment.rows[0]) {
        throw new Error('Enrollment not found');
      }

      // Update old enrollment
      await client.query(
        `UPDATE semester_enrollments 
         SET enrollment_status = 'transferred', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [enrollmentId]
      );

      // Create new enrollment
      const result = await client.query(
        `INSERT INTO semester_enrollments (semester_id, user_id, room_id, enrollment_status)
         VALUES ($1, $2, $3, 'active')
         RETURNING *`,
        [newSemesterId, oldEnrollment.rows[0].user_id, oldEnrollment.rows[0].room_id]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Drop a student from a semester
   */
  static async drop(enrollmentId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE semester_enrollments 
       SET enrollment_status = 'dropped', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [enrollmentId]
    );
    return (result.rowCount || 0) > 0;
  }
}

