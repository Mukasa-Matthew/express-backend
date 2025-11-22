import pool from '../config/database';
import bcrypt from 'bcryptjs';
import { CredentialGenerator } from './credentialGenerator';

export interface StudentRegistrationData {
  name: string;
  email: string;
  phone?: string;
  gender?: string;
  dateOfBirth?: Date | string;
  registrationNumber?: string;
  course?: string;
  accessNumber?: string;
  guardianName?: string;
  guardianPhone?: string;
  emergencyContact?: string;
  hostelId: number;
  roomId: number;
  semesterId: number;
  initialPaymentAmount: number;
  currency?: string;
}

export interface RegistrationResult {
  userId: number;
  studentId?: number;
  enrollmentId: number;
  assignmentId: number;
  paymentId: number;
  isNewUser: boolean;
}

/**
 * Unified Student Registration Service
 * Prevents duplicate user creation and consolidates registration logic
 */
export class StudentRegistrationService {
  /**
   * Register or update a student
   * Checks for existing user by email/phone before creating new one
   */
  static async registerStudent(
    data: StudentRegistrationData,
    registeredBy: number,
    client: any
  ): Promise<RegistrationResult> {
    // Check for existing user by email first
    const existingUserResult = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [data.email]
    );

    let userId: number;
    let isNewUser = false;

    if (existingUserResult.rows.length > 0) {
      const existingUser = existingUserResult.rows[0];

      // Validate existing user can be used
      if (existingUser.role !== 'user') {
        throw new Error('Email already exists for another account type');
      }

      // Check hostel assignment
      if (existingUser.hostel_id && existingUser.hostel_id !== data.hostelId) {
        throw new Error('Email already registered under a different hostel');
      }

      // Update user if needed
      userId = existingUser.id;
      if (!existingUser.hostel_id) {
        await client.query(
          'UPDATE users SET hostel_id = $1 WHERE id = $2',
          [data.hostelId, userId]
        );
      }
      if (data.name && data.name !== existingUser.name) {
        await client.query(
          'UPDATE users SET name = $1 WHERE id = $2',
          [data.name, userId]
        );
      }
    } else {
      // Create new user
      const randomPassword = CredentialGenerator.generatePatternPassword();
      const hashed = await bcrypt.hash(randomPassword, 10);
      const userResult = await client.query(
        `INSERT INTO users (email, name, password, role, hostel_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'user', $4, NOW(), NOW())
         RETURNING id`,
        [data.email, data.name, hashed, data.hostelId]
      );
      userId = userResult.rows[0].id;
      isNewUser = true;
    }

    // Create or update student profile
    const hasStudentsTable = await this.checkTableExists(client, 'students');
    const hasStudentProfilesTable = await this.checkTableExists(client, 'student_profiles');

    let studentId: number | undefined;

    if (hasStudentProfilesTable) {
      const profileResult = await client.query(
        'SELECT user_id FROM student_profiles WHERE user_id = $1',
        [userId]
      );

      if (profileResult.rows.length === 0) {
        await client.query(
          `INSERT INTO student_profiles (
            user_id, access_number, phone, whatsapp, emergency_contact,
            gender, date_of_birth, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [
            userId,
            data.accessNumber || null,
            data.phone || null,
            null, // whatsapp - not in StudentRegistrationData
            data.emergencyContact || null,
            data.gender || null,
            data.dateOfBirth ? new Date(data.dateOfBirth) : null,
          ]
        );
      } else {
        await client.query(
          `UPDATE student_profiles
           SET access_number = COALESCE($2, access_number),
               phone = COALESCE($3, phone),
               emergency_contact = COALESCE($4, emergency_contact),
               gender = COALESCE($5, gender),
               date_of_birth = COALESCE($6, date_of_birth),
               updated_at = NOW()
           WHERE user_id = $1`,
          [
            userId,
            data.accessNumber || null,
            data.phone || null,
            data.emergencyContact || null,
            data.gender || null,
            data.dateOfBirth ? new Date(data.dateOfBirth) : null,
          ]
        );
      }
    } else if (hasStudentsTable) {
      const studentResult = await client.query(
        'SELECT user_id FROM students WHERE user_id = $1',
        [userId]
      );

      if (studentResult.rows.length === 0) {
        const insertResult = await client.query(
          `INSERT INTO students (
            user_id, registration_number, course, phone_number, emergency_contact,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          RETURNING id`,
          [
            userId,
            data.registrationNumber || `REG-${userId}`,
            data.course || null,
            data.phone || null,
            data.emergencyContact || null,
          ]
        );
        studentId = insertResult.rows[0]?.id;
      } else {
        await client.query(
          `UPDATE students
           SET registration_number = COALESCE($2, registration_number),
               course = COALESCE($3, course),
               phone_number = COALESCE($4, phone_number),
               emergency_contact = COALESCE($5, emergency_contact),
               updated_at = NOW()
           WHERE user_id = $1`,
          [
            userId,
            data.registrationNumber || null,
            data.course || null,
            data.phone || null,
            data.emergencyContact || null,
          ]
        );
      }
    }

    // Get room details and calculate expected price
    const roomResult = await client.query(
      'SELECT price, capacity, gender_allowed FROM rooms WHERE id = $1',
      [data.roomId]
    );
    if (roomResult.rows.length === 0) {
      throw new Error('Room not found');
    }
    const room = roomResult.rows[0];
    // Ensure price is parsed as a number (handle both numeric and text types)
    const roomPrice = room.price;
    const expectedPrice = typeof roomPrice === 'number' ? roomPrice : parseFloat(String(roomPrice || '0'));

    // Check gender compatibility if gender is provided
    if (data.gender && room.gender_allowed && room.gender_allowed !== 'both') {
      const studentGender = data.gender.toLowerCase();
      const roomGender = room.gender_allowed.toLowerCase();
      if (studentGender !== roomGender) {
        throw new Error(`This room is allocated for ${roomGender} students only. Your gender (${studentGender}) does not match.`);
      }
    }

    // Create semester enrollment
    // Ensure all numeric values are properly cast to avoid type mismatch errors
    const totalAmount = typeof expectedPrice === 'number' ? expectedPrice : parseFloat(String(expectedPrice || '0'));
    const amountPaid = typeof data.initialPaymentAmount === 'number' ? data.initialPaymentAmount : parseFloat(String(data.initialPaymentAmount || '0'));
    const balance = Math.max(0, totalAmount - amountPaid);
    
    // Check if room_id column exists in semester_enrollments
    const roomIdColumnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'semester_enrollments'
        AND column_name = 'room_id'
    `);
    const hasRoomIdColumn = roomIdColumnCheck.rows.length > 0;
    
    let enrollmentQuery: string;
    let enrollmentParams: any[];
    
    if (hasRoomIdColumn) {
      enrollmentQuery = `INSERT INTO semester_enrollments (
        user_id, semester_id, room_id, enrollment_status,
        total_amount, amount_paid, balance, enrollment_date, created_at, updated_at
      ) VALUES ($1, $2, $3, 'active', $4::numeric, $5::numeric, $6::numeric, NOW(), NOW(), NOW())
      ON CONFLICT (user_id, semester_id)
      DO UPDATE SET
        room_id = EXCLUDED.room_id,
        total_amount = EXCLUDED.total_amount,
        amount_paid = EXCLUDED.amount_paid,
        balance = EXCLUDED.balance,
        updated_at = NOW()
      RETURNING id`;
      enrollmentParams = [
        userId,
        data.semesterId,
        data.roomId,
        totalAmount,
        amountPaid,
        balance,
      ];
    } else {
      enrollmentQuery = `INSERT INTO semester_enrollments (
        user_id, semester_id, enrollment_status,
        total_amount, amount_paid, balance, enrollment_date, created_at, updated_at
      ) VALUES ($1, $2, 'active', $3::numeric, $4::numeric, $5::numeric, NOW(), NOW(), NOW())
      ON CONFLICT (user_id, semester_id)
      DO UPDATE SET
        total_amount = EXCLUDED.total_amount,
        amount_paid = EXCLUDED.amount_paid,
        balance = EXCLUDED.balance,
        updated_at = NOW()
      RETURNING id`;
      enrollmentParams = [
        userId,
        data.semesterId,
        totalAmount,
        amountPaid,
        balance,
      ];
    }
    
    const enrollmentResult = await client.query(enrollmentQuery, enrollmentParams);
    const enrollmentId = enrollmentResult.rows[0].id;

    // Create room assignment
    const assignmentColumns = await this.getAssignmentColumns(client);
    const assignmentUserIdColumn = assignmentColumns.has('student_id')
      ? 'student_id'
      : assignmentColumns.has('user_id')
      ? 'user_id'
      : null;

    if (assignmentUserIdColumn) {
      // Check what date column exists (assignment_date or assigned_at)
      const dateColumnCheck = await client.query(
        `SELECT column_name 
         FROM information_schema.columns 
         WHERE table_name = 'student_room_assignments' 
         AND column_name IN ('assignment_date', 'assigned_at')`
      );
      const dateColumn = dateColumnCheck.rows.length > 0 
        ? dateColumnCheck.rows[0].column_name 
        : 'assigned_at'; // Default to assigned_at if neither exists
      
      // Check if assignment already exists
      const existingAssignment = await client.query(
        `SELECT id FROM student_room_assignments
         WHERE ${assignmentUserIdColumn} = $1 AND room_id = $2 AND semester_id = $3 AND status = 'active'`,
        [userId, data.roomId, data.semesterId]
      );

      let assignmentId: number;
      if (existingAssignment.rows.length > 0) {
        assignmentId = existingAssignment.rows[0].id;
      } else {
        const assignmentResult = await client.query(
          `INSERT INTO student_room_assignments (
            ${assignmentUserIdColumn}, room_id, semester_id, assigned_by,
            ${dateColumn}, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, NOW(), 'active', NOW(), NOW())
          RETURNING id`,
          [userId, data.roomId, data.semesterId, registeredBy]
        );
        assignmentId = assignmentResult.rows[0].id;
      }

      // Record initial payment FIRST (student must have payment to be counted as registered)
      // Check if payments table has hostel_id column
      const paymentColumnsCheck = await client.query(
        `SELECT column_name 
         FROM information_schema.columns 
         WHERE table_name = 'payments' 
         AND column_name = 'hostel_id'`
      );
      const hasHostelIdColumn = paymentColumnsCheck.rows.length > 0;
      
      // Build payment INSERT query dynamically based on table structure
      const paymentColumns = [assignmentUserIdColumn, 'semester_id', 'amount', 'payment_method', 'currency', 'recorded_by', 'created_at', 'updated_at'];
      const paymentValues = [userId, data.semesterId, data.initialPaymentAmount, 'cash', data.currency || 'UGX', registeredBy];
      const paymentPlaceholders = paymentValues.map((_, i) => `$${i + 1}`);
      
      if (hasHostelIdColumn && data.hostelId) {
        paymentColumns.splice(1, 0, 'hostel_id'); // Insert after user_id column
        paymentValues.splice(1, 0, data.hostelId); // Insert hostel_id value
        // Rebuild placeholders after inserting hostel_id
        paymentPlaceholders.length = 0;
        paymentPlaceholders.push(...paymentValues.map((_, i) => `$${i + 1}`));
      }
      
      const paymentResult = await client.query(
        `INSERT INTO payments (
          ${paymentColumns.join(', ')}
        ) VALUES (${paymentPlaceholders.join(', ')}, NOW(), NOW())
        RETURNING id`,
        paymentValues
      );
      const paymentId = paymentResult.rows[0].id;

      // Update room occupancy AFTER payment is recorded
      // This ensures only registered students (with balance + payment) are counted
      await this.updateRoomOccupancy(client, data.roomId);

      return {
        userId,
        studentId,
        enrollmentId,
        assignmentId,
        paymentId,
        isNewUser,
      };
    } else {
      throw new Error('Student room assignments table structure not supported');
    }
  }

  /**
   * Update room occupancy based on active assignments
   * Only counts students who are fully registered (have balance + payment)
   */
  static async updateRoomOccupancy(client: any, roomId: number): Promise<void> {
    // Count active assignments for this room, but only for registered students
    // A student is "registered" if they have:
    // 1. A semester enrollment with balance (even if zero)
    // 2. At least one payment recorded
    const assignmentColumns = await this.getAssignmentColumns(client);
    const assignmentUserIdColumn = assignmentColumns.has('student_id')
      ? 'student_id'
      : assignmentColumns.has('user_id')
      ? 'user_id'
      : null;

    if (!assignmentUserIdColumn) return;

    const countResult = await client.query(
      `SELECT COUNT(DISTINCT sra.${assignmentUserIdColumn}) as count
       FROM student_room_assignments sra
       INNER JOIN semester_enrollments se ON se.user_id = sra.${assignmentUserIdColumn}
       WHERE sra.room_id = $1 
         AND sra.status = 'active'
         AND se.balance IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM payments p 
           WHERE p.user_id = sra.${assignmentUserIdColumn}
           AND (p.semester_id = se.semester_id OR p.semester_id IS NULL)
         )`,
      [roomId]
    );

    const activeCount = parseInt(countResult.rows[0]?.count || '0', 10);

    // Get room capacity
    const roomResult = await client.query(
      'SELECT capacity FROM rooms WHERE id = $1',
      [roomId]
    );
    const roomCapacity = roomResult.rows[0]?.capacity;
    // Ensure capacity is parsed as integer (handle both numeric and text types)
    const capacity = typeof roomCapacity === 'number' ? roomCapacity : parseInt(String(roomCapacity || '1'), 10);

    // Update room occupancy and status
    // Ensure both values are integers for comparison
    const activeCountInt = typeof activeCount === 'number' ? activeCount : parseInt(String(activeCount || '0'), 10);
    const capacityInt = typeof capacity === 'number' ? capacity : parseInt(String(capacity || '1'), 10);
    
    await client.query(
      `UPDATE rooms
       SET current_occupants = $1::integer,
           status = CASE
             WHEN $1::integer >= $2::integer THEN 'occupied'
             WHEN $1::integer > 0 THEN 'partially_occupied'
             ELSE 'available'
           END,
           updated_at = NOW()
       WHERE id = $3`,
      [activeCountInt, capacityInt, roomId]
    );
  }

  private static async checkTableExists(client: any, tableName: string): Promise<boolean> {
    const result = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    return result.rows.length > 0;
  }

  private static async getAssignmentColumns(client: any): Promise<Set<string>> {
    const result = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'student_room_assignments'`
    );
    return new Set(result.rows.map((row: any) => row.column_name));
  }
}

