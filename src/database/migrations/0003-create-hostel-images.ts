import pool from '../../config/database';

/**
 * Migration to create hostel_images table
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Creating hostel_images table...');
    
    await client.query('BEGIN');
    
    // Create hostel_images table
    await client.query(`
      CREATE TABLE IF NOT EXISTS hostel_images (
        id SERIAL PRIMARY KEY,
        hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
        image_url VARCHAR(500) NOT NULL,
        caption VARCHAR(255),
        is_primary BOOLEAN DEFAULT FALSE,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hostel_images_hostel_id ON hostel_images(hostel_id)
    `);
    
    // Create index for published hostels
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hostels_is_published ON hostels(is_published) WHERE is_published = TRUE
    `);
    
    await client.query('COMMIT');
    console.log('✅ Hostel images migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Hostel images migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}





