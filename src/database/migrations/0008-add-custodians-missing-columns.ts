import pool from '../../config/database';

/**
 * Migration to add missing columns to custodians table:
 * - phone (VARCHAR(30))
 * - location (TEXT)
 * - national_id_image_path (TEXT)
 * - status (VARCHAR(20)) if missing
 * - updated_at (TIMESTAMP) if missing
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding missing columns to custodians table...');
    
    await client.query('BEGIN');
    
    // Add phone column if it doesn't exist
    await client.query(`
      ALTER TABLE custodians 
      ADD COLUMN IF NOT EXISTS phone VARCHAR(30)
    `);
    
    // Add location column if it doesn't exist
    await client.query(`
      ALTER TABLE custodians 
      ADD COLUMN IF NOT EXISTS location TEXT
    `);
    
    // Add national_id_image_path column if it doesn't exist
    await client.query(`
      ALTER TABLE custodians 
      ADD COLUMN IF NOT EXISTS national_id_image_path TEXT
    `);
    
    // Add status column if it doesn't exist
    const statusCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'status'
    `);
    
    if (statusCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE custodians 
        ADD COLUMN status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended'))
      `);
    }
    
    // Add updated_at column if it doesn't exist
    const updatedAtCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'updated_at'
    `);
    
    if (updatedAtCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE custodians 
        ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      `);
    }
    
    // Ensure user_id and hostel_id are NOT NULL if they're nullable
    // Check if they're nullable and update if needed
    const userIdCheck = await client.query(`
      SELECT is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'user_id'
    `);
    
    if (userIdCheck.rows.length > 0 && userIdCheck.rows[0].is_nullable === 'YES') {
      // Only make NOT NULL if there are no NULL values
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM custodians WHERE user_id IS NULL) THEN
            ALTER TABLE custodians ALTER COLUMN user_id SET NOT NULL;
          END IF;
        END $$;
      `);
    }
    
    const hostelIdCheck = await client.query(`
      SELECT is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'custodians' AND column_name = 'hostel_id'
    `);
    
    if (hostelIdCheck.rows.length > 0 && hostelIdCheck.rows[0].is_nullable === 'YES') {
      // Only make NOT NULL if there are no NULL values
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM custodians WHERE hostel_id IS NULL) THEN
            ALTER TABLE custodians ALTER COLUMN hostel_id SET NOT NULL;
          END IF;
        END $$;
      `);
    }
    
    await client.query('COMMIT');
    console.log('✅ Custodians missing columns migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Custodians missing columns migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}





