import pool from '../config/database';

async function addPublicWebsiteMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding public website features...');
    
    await client.query('BEGIN');
    
    // Add is_published column to hostels table
    console.log('Adding is_published column to hostels...');
    await client.query(`
      ALTER TABLE hostels 
      ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
      ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8)
    `);
    
    // Create hostel_images table
    console.log('Creating hostel_images table...');
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
    
    // Create index for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hostel_images_hostel_id ON hostel_images(hostel_id)
    `);
    
    // Create index for published hostels
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hostels_is_published ON hostels(is_published) WHERE is_published = TRUE
    `);
    
    await client.query('COMMIT');
    console.log('✅ Public website migration completed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Public website migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if called directly
if (require.main === module) {
  addPublicWebsiteMigration()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default addPublicWebsiteMigration;

