import pool from '../config/database';

/**
 * Middleware to check if user has an active semester before allowing data recording
 * This ensures proper organization of data by semester
 */
export async function requireActiveSemester(userId: number, hostelId: number): Promise<{ success: boolean; message?: string; semesterId?: number }> {
  const strictMode = (process.env.REQUIRE_ACTIVE_SEMESTER || '').toLowerCase() === 'true';

  try {
    // Verify semesters table exists (older databases might not have it)
    const tableCheck = await pool.query(
      `SELECT EXISTS (
         SELECT 1 
         FROM information_schema.tables 
         WHERE table_schema = 'public' 
           AND table_name = 'semesters'
       ) AS exists`
    );

    const hasSemestersTable = tableCheck.rows[0]?.exists === true;

    if (!hasSemestersTable) {
      if (strictMode) {
        return {
          success: false,
          message: 'Semester tracking is not configured. Please run the latest migrations to enable it.'
        };
      }

      console.warn('[Semesters] Table missing; skipping active semester enforcement.');
      return { success: true };
    }

    // Check if there's a current active semester for this hostel
    const result = await pool.query(
      `SELECT id FROM semesters 
       WHERE hostel_id = $1 AND is_current = true AND status = 'active'
       LIMIT 1`,
      [hostelId]
    );

    const activeSemesterId = result.rows[0]?.id;

    if (!activeSemesterId) {
      const message = 'No active semester found. Please create and activate a semester before recording data.';

      if (strictMode) {
        return { success: false, message };
      }

      console.warn(`[Semesters] ${message} (hostel_id=${hostelId}). Proceeding without semester linkage.`);
      return { success: true, message };
    }

    return {
      success: true,
      semesterId: activeSemesterId
    };
  } catch (error) {
    console.error('Error checking active semester:', error);

    if (strictMode) {
      return {
        success: false,
        message: 'Failed to verify active semester'
      };
    }

    console.warn('[Semesters] Failed to verify active semester, continuing without enforcement.');
    return { success: true };
  }
}



