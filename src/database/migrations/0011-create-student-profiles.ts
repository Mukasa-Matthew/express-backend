import pool from '../../config/database';

/**
 * Migration to create student_profiles table
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Creating student_profiles table...');
    
    await client.query('BEGIN');
    
    // Create student_profiles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        gender VARCHAR(20),
        date_of_birth DATE,
        access_number VARCHAR(50),
        phone VARCHAR(30),
        whatsapp VARCHAR(30),
        emergency_contact TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_profiles_access_number 
      ON student_profiles(access_number)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_profiles_phone 
      ON student_profiles(phone)
    `);

    await client.query('COMMIT');
    console.log('✅ Student profiles table migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Student profiles table migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}


