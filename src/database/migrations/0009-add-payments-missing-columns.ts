import pool from '../../config/database';

/**
 * Migration to add missing columns to payments table:
 * - hostel_id (INTEGER, references hostels)
 * - user_id (INTEGER, if missing - may need to rename from student_id)
 * - purpose (VARCHAR(100))
 * - semester_id (INTEGER, references semesters) if missing
 * - Ensure all necessary columns exist
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding missing columns to payments table...');
    
    await client.query('BEGIN');
    
    // Check if student_id column exists (old schema)
    const studentIdCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payments' AND column_name = 'student_id'
    `);
    
    // Check if user_id column exists
    const userIdCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payments' AND column_name = 'user_id'
    `);
    
    // If student_id exists but user_id doesn't, rename it
    if (studentIdCheck.rows.length > 0 && userIdCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE payments 
        RENAME COLUMN student_id TO user_id
      `);
      console.log('   Renamed student_id to user_id');
    } else if (userIdCheck.rows.length === 0) {
      // If neither exists, add user_id
      await client.query(`
        ALTER TABLE payments 
        ADD COLUMN user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('   Added user_id column');
    }
    
    // Add hostel_id column if it doesn't exist
    const hostelIdCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payments' AND column_name = 'hostel_id'
    `);
    
    if (hostelIdCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE payments 
        ADD COLUMN hostel_id INTEGER REFERENCES hostels(id) ON DELETE CASCADE
      `);
      
      // Try to populate hostel_id from users table for existing records
      try {
        await client.query(`
          UPDATE payments p
          SET hostel_id = u.hostel_id
          FROM users u
          WHERE p.user_id = u.id AND p.hostel_id IS NULL AND u.hostel_id IS NOT NULL
        `);
        console.log('   Populated hostel_id from users table for existing records');
      } catch (error: any) {
        console.log('   Note: Could not populate hostel_id from users (may have NULL values)');
      }
      
      // Make it NOT NULL after populating (only if no NULL values remain)
      try {
        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM payments WHERE hostel_id IS NULL) THEN
              ALTER TABLE payments ALTER COLUMN hostel_id SET NOT NULL;
            END IF;
          END $$;
        `);
      } catch (error: any) {
        console.log('   Note: hostel_id may remain nullable if NULL values exist');
      }
    }
    
    // Add purpose column if it doesn't exist
    await client.query(`
      ALTER TABLE payments 
      ADD COLUMN IF NOT EXISTS purpose VARCHAR(100)
    `);
    
    // Add semester_id column if it doesn't exist
    const semesterIdCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payments' AND column_name = 'semester_id'
    `);
    
    if (semesterIdCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE payments 
        ADD COLUMN semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL
      `);
    }
    
    // Ensure currency column exists
    await client.query(`
      ALTER TABLE payments 
      ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'UGX'
    `);
    
    // Create index on hostel_id if it doesn't exist
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_hostel_id ON payments(hostel_id)
    `);
    
    // Create index on semester_id if it doesn't exist
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_semester_id ON payments(semester_id)
    `);
    
    await client.query('COMMIT');
    console.log('✅ Payments missing columns migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Payments missing columns migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}








