import pool from '../config/database';

async function updateHostelSchema() {
  try {
    console.log('Updating hostel schema with new fields...');
    
    await pool.query('BEGIN');
    
    // Add new columns to hostels table
    console.log('Adding new columns to hostels table...');
    await pool.query(`
      ALTER TABLE hostels 
      ADD COLUMN IF NOT EXISTS distance_from_campus DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS amenities TEXT,
      ADD COLUMN IF NOT EXISTS price_per_room INTEGER,
      ADD COLUMN IF NOT EXISTS rules_and_regulations TEXT,
      ADD COLUMN IF NOT EXISTS occupancy_type VARCHAR(10) CHECK (occupancy_type IN ('male','female','mixed'))
    `);
    
    await pool.query('COMMIT');
    console.log('✅ Hostel schema updated successfully!');
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Hostel schema update failed:', error);
  } finally {
    await pool.end();
    console.log('Schema update completed');
  }
}

updateHostelSchema();
