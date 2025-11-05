import pool from '../../config/database';

/**
 * Migration to fix student_room_assignments table:
 * - Rename student_id to user_id if student_id exists
 * - Add user_id if missing
 * - Ensure semester_id exists
 * - Ensure all other required columns exist
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Fixing student_room_assignments table...');
    
    await client.query('BEGIN');
    
    // Check if student_id column exists (old schema)
    const studentIdCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'student_room_assignments' AND column_name = 'student_id'
    `);
    
    // Check if user_id column exists
    const userIdCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'student_room_assignments' AND column_name = 'user_id'
    `);
    
    // If student_id exists but user_id doesn't, rename it
    if (studentIdCheck.rows.length > 0 && userIdCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE student_room_assignments 
        RENAME COLUMN student_id TO user_id
      `);
      console.log('   Renamed student_id to user_id');
    } else if (userIdCheck.rows.length === 0) {
      // If neither exists, add user_id
      await client.query(`
        ALTER TABLE student_room_assignments 
        ADD COLUMN user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('   Added user_id column');
    }
    
    // Ensure semester_id column exists
    await client.query(`
      ALTER TABLE student_room_assignments 
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL
    `);
    
    // Ensure assigned_at column exists (some schemas use assignment_date)
    const assignedAtCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'student_room_assignments' 
      AND column_name IN ('assigned_at', 'assignment_date')
    `);
    
    if (assignedAtCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE student_room_assignments 
        ADD COLUMN assigned_at TIMESTAMP DEFAULT NOW()
      `);
    } else if (assignedAtCheck.rows[0].column_name === 'assignment_date') {
      // Rename assignment_date to assigned_at if it exists
      try {
        await client.query(`
          ALTER TABLE student_room_assignments 
          RENAME COLUMN assignment_date TO assigned_at
        `);
        console.log('   Renamed assignment_date to assigned_at');
      } catch (error: any) {
        // Column might already be renamed, that's okay
        console.log('   Note: assignment_date/assigned_at already correct');
      }
    }
    
    // Ensure ended_at column exists (some schemas use checkout_date)
    const endedAtCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'student_room_assignments' 
      AND column_name IN ('ended_at', 'checkout_date')
    `);
    
    if (endedAtCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE student_room_assignments 
        ADD COLUMN ended_at TIMESTAMP
      `);
    } else if (endedAtCheck.rows[0].column_name === 'checkout_date') {
      // Rename checkout_date to ended_at if it exists
      try {
        await client.query(`
          ALTER TABLE student_room_assignments 
          RENAME COLUMN checkout_date TO ended_at
        `);
        console.log('   Renamed checkout_date to ended_at');
      } catch (error: any) {
        // Column might already be renamed, that's okay
        console.log('   Note: checkout_date/ended_at already correct');
      }
    }
    
    // Ensure status column has correct values
    // Update status constraint if needed (active, ended, cancelled vs active, completed, cancelled)
    const statusCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'student_room_assignments' AND column_name = 'status'
    `);
    
    if (statusCheck.rows.length > 0) {
      // Try to update status values if they're using old values
      try {
        await client.query(`
          UPDATE student_room_assignments 
          SET status = 'ended' 
          WHERE status = 'completed'
        `);
      } catch (error: any) {
        // That's okay, might not have any completed records
      }
    }
    
    // Ensure created_at and updated_at exist
    await client.query(`
      ALTER TABLE student_room_assignments 
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);
    
    // Create indexes if they don't exist
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_user_id 
      ON student_room_assignments(user_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_room_id 
      ON student_room_assignments(room_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_status 
      ON student_room_assignments(status)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_semester_id 
      ON student_room_assignments(semester_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_user_status 
      ON student_room_assignments(user_id, status)
    `);
    
    await client.query('COMMIT');
    console.log('✅ Student room assignments table migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Student room assignments table migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}


