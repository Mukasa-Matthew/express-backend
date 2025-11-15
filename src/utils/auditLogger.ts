import pool from '../config/database';

export interface AuditLogData {
  userId?: number | null;
  action: string;
  resourceType?: string | null;
  resourceId?: number | null;
  changes?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Audit Logger - Logs all critical actions in the system
 * Used for tracking user actions, changes, and system events
 */
export class AuditLogger {
  /**
   * Log an action to the audit log
   */
  static async log(data: AuditLogData): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO audit_logs (
          user_id, 
          action, 
          entity_type, 
          entity_id, 
          changes, 
          ip_address, 
          user_agent, 
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          data.userId || null,
          data.action,
          data.resourceType || null,
          data.resourceId || null,
          data.changes ? JSON.stringify(data.changes) : null,
          data.ipAddress || null,
          data.userAgent || null,
        ]
      );
    } catch (error) {
      // Don't throw - audit logging should not break the main flow
      console.error('Failed to write audit log:', error);
    }
  }

  /**
   * Log user creation
   */
  static async logUserCreation(
    userId: number,
    userData: { email: string; role: string; name: string },
    createdBy?: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId: createdBy || null,
      action: 'user_created',
      resourceType: 'user',
      resourceId: userId,
      changes: {
        created_user: {
          email: userData.email,
          role: userData.role,
          name: userData.name,
        },
      },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log user role change
   */
  static async logRoleChange(
    userId: number,
    oldRole: string,
    newRole: string,
    changedBy?: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId: changedBy || null,
      action: 'role_changed',
      resourceType: 'user',
      resourceId: userId,
      changes: {
        old_role: oldRole,
        new_role: newRole,
      },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log password reset
   */
  static async logPasswordReset(
    userId: number,
    resetBy?: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId: resetBy || userId,
      action: 'password_reset',
      resourceType: 'user',
      resourceId: userId,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log password change
   */
  static async logPasswordChange(
    userId: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId,
      action: 'password_changed',
      resourceType: 'user',
      resourceId: userId,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log payment recording
   */
  static async logPayment(
    paymentId: number,
    userId: number,
    amount: number,
    method: string,
    recordedBy?: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId: recordedBy || null,
      action: 'payment_recorded',
      resourceType: 'payment',
      resourceId: paymentId,
      changes: {
        student_id: userId,
        amount,
        method,
      },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log room assignment
   */
  static async logRoomAssignment(
    assignmentId: number,
    studentId: number,
    roomId: number,
    assignedBy: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId: assignedBy,
      action: 'room_assigned',
      resourceType: 'room_assignment',
      resourceId: assignmentId,
      changes: {
        student_id: studentId,
        room_id: roomId,
      },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log booking status change
   */
  static async logBookingStatusChange(
    bookingId: number,
    oldStatus: string,
    newStatus: string,
    changedBy?: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId: changedBy || null,
      action: 'booking_status_changed',
      resourceType: 'booking',
      resourceId: bookingId,
      changes: {
        old_status: oldStatus,
        new_status: newStatus,
      },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log booking creation
   */
  static async logBookingCreation(
    bookingId: number,
    hostelId: number,
    createdBy?: number,
    source: string = 'online',
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId: createdBy || null,
      action: 'booking_created',
      resourceType: 'booking',
      resourceId: bookingId,
      changes: {
        hostel_id: hostelId,
        source,
      },
      ipAddress,
      userAgent,
    });
  }
}

