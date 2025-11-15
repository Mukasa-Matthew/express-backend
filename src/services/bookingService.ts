import pool from '../config/database';

/**
 * Booking Service - Handles booking-related automated tasks
 */
export class BookingService {
  /**
   * Auto-expire pending bookings that are older than the specified timeout
   * Default: 30 minutes
   */
  static async expirePendingBookings(timeoutMinutes: number = 30): Promise<void> {
    try {
      const timeoutMs = timeoutMinutes * 60 * 1000;
      const cutoffTime = new Date(Date.now() - timeoutMs);

      const result = await pool.query(
        `UPDATE public_hostel_bookings
         SET status = 'expired',
             updated_at = NOW()
         WHERE status = 'pending'
           AND payment_status = 'pending'
           AND created_at < $1
         RETURNING id, hostel_id, student_name, student_email`,
        [cutoffTime]
      );

      if (result.rows.length > 0) {
        console.log(`✅ Expired ${result.rows.length} pending booking(s)`);
        
        // Optionally notify admins about expired bookings
        // This can be implemented if needed
      }
    } catch (error) {
      console.error('❌ Error expiring pending bookings:', error);
    }
  }

  /**
   * Get booking statistics for a hostel
   */
  static async getBookingStats(hostelId: number): Promise<{
    total: number;
    pending: number;
    booked: number;
    checkedIn: number;
    expired: number;
  }> {
    try {
      const result = await pool.query(
        `SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'booked') as booked,
          COUNT(*) FILTER (WHERE status = 'checked_in') as checked_in,
          COUNT(*) FILTER (WHERE status = 'expired') as expired
         FROM public_hostel_bookings
         WHERE hostel_id = $1`,
        [hostelId]
      );

      const row = result.rows[0];
      return {
        total: parseInt(row.total || '0', 10),
        pending: parseInt(row.pending || '0', 10),
        booked: parseInt(row.booked || '0', 10),
        checkedIn: parseInt(row.checked_in || '0', 10),
        expired: parseInt(row.expired || '0', 10),
      };
    } catch (error) {
      console.error('Error getting booking stats:', error);
      return {
        total: 0,
        pending: 0,
        booked: 0,
        checkedIn: 0,
        expired: 0,
      };
    }
  }
}


