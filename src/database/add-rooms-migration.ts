import pool from '../config/database';

async function addRoomsMigration() {
  try {
    console.log('Creating rooms table...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
        room_number VARCHAR(50) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        description TEXT,
        self_contained BOOLEAN DEFAULT false,
        status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance', 'reserved')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(hostel_id, room_number)
      );
    `);

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_rooms_hostel_id ON rooms(hostel_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
    `);

    console.log('✅ Rooms table created successfully');
  } catch (error) {
    console.error('❌ Error creating rooms table:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Execute the migration
addRoomsMigration()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

