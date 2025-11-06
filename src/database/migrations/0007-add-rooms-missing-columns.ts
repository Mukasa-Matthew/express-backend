import pool from '../../config/database';

/**
 * Migration to add missing columns to rooms table:
 * - description (TEXT)
 * - self_contained (BOOLEAN)
 * - capacity (INTEGER, if missing)
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding missing columns to rooms table...');
    
    await client.query('BEGIN');
    
    // Add description column if it doesn't exist
    await client.query(`
      ALTER TABLE rooms 
      ADD COLUMN IF NOT EXISTS description TEXT
    `);
    
    // Add self_contained column if it doesn't exist
    await client.query(`
      ALTER TABLE rooms 
      ADD COLUMN IF NOT EXISTS self_contained BOOLEAN DEFAULT false
    `);
    
    // Add capacity column if it doesn't exist (check first to avoid errors)
    const capacityCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'rooms' AND column_name = 'capacity'
    `);
    
    if (capacityCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE rooms 
        ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1 AND capacity <= 4)
      `);
    } else {
      // Ensure capacity has the check constraint if it exists
      try {
        await client.query(`
          ALTER TABLE rooms 
          DROP CONSTRAINT IF EXISTS rooms_capacity_check
        `);
        await client.query(`
          ALTER TABLE rooms 
          ADD CONSTRAINT rooms_capacity_check CHECK (capacity >= 1 AND capacity <= 4)
        `);
      } catch (error: any) {
        // Constraint might already exist with a different name, that's okay
        console.log('   Note: Capacity constraint handling skipped');
      }
    }
    
    await client.query('COMMIT');
    console.log('✅ Rooms missing columns migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Rooms missing columns migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}



