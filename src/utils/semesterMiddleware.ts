import pool from '../config/database';

/**
 * Middleware to check if user has an active semester before allowing data recording
 * This ensures proper organization of data by semester
 */
export async function requireActiveSemester(userId: number, hostelId: number): Promise<{ success: boolean; message?: string; semesterId?: number }> {
  try {
    // Check if there's a current active semester for this hostel
    const result = await pool.query(
      `SELECT id FROM semesters 
       WHERE hostel_id = $1 AND is_current = true AND status = 'active'
       LIMIT 1`,
      [hostelId]
    );

    if (!result.rows[0]) {
      return {
        success: false,
        message: 'No active semester found. Please create and activate a semester before recording data.'
      };
    }

    return {
      success: true,
      semesterId: result.rows[0].id
    };
  } catch (error) {
    console.error('Error checking active semester:', error);
    return {
      success: false,
      message: 'Failed to verify active semester'
    };
  }
}



