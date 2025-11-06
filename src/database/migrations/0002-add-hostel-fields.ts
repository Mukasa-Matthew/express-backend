import pool from '../../config/database';

/**
 * Migration to add missing fields to hostels table
 * This ensures backward compatibility with existing databases
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding missing fields to hostels table...');
    
    await client.query('BEGIN');
    
    // Add missing columns if they don't exist
    await client.query(`
      ALTER TABLE hostels 
      ADD COLUMN IF NOT EXISTS university_id INTEGER,
      ADD COLUMN IF NOT EXISTS region_id INTEGER,
      ADD COLUMN IF NOT EXISTS price_per_room INTEGER,
      ADD COLUMN IF NOT EXISTS occupancy_type VARCHAR(10),
      ADD COLUMN IF NOT EXISTS distance_from_campus DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS amenities TEXT,
      ADD COLUMN IF NOT EXISTS rules_and_regulations TEXT,
      ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
      ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8)
    `);
    
    // Add constraint for occupancy_type if it doesn't exist
    try {
      await client.query(`
        ALTER TABLE hostels 
        ADD CONSTRAINT hostels_occupancy_type_check 
        CHECK (occupancy_type IS NULL OR occupancy_type IN ('male','female','mixed'))
      `);
    } catch (error: any) {
      // Constraint might already exist, that's okay
      if (error.code !== '42710') {
        throw error;
      }
    }
    
    // Add foreign key constraints if they don't exist
    try {
      await client.query(`
        ALTER TABLE hostels 
        ADD CONSTRAINT fk_hostels_university 
        FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      if (error.code !== '42710' && error.code !== '42P16') {
        throw error;
      }
    }
    
    try {
      await client.query(`
        ALTER TABLE hostels 
        ADD CONSTRAINT fk_hostels_region 
        FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      if (error.code !== '42710' && error.code !== '42P16') {
        throw error;
      }
    }
    
    await client.query('COMMIT');
    console.log('✅ Hostel fields migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Hostel fields migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}










