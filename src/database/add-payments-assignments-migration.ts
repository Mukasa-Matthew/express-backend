import pool from '../config/database';

async function addPaymentsAssignmentsMigration() {
  try {
    console.log('Creating student_room_assignments table...');
    
    // Create student_room_assignments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_room_assignments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
        assigned_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_user_id ON student_room_assignments(user_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_room_id ON student_room_assignments(room_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_status ON student_room_assignments(status);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_user_status ON student_room_assignments(user_id, status);
    `);

    console.log('✅ Student room assignments table created successfully');
  } catch (error) {
    console.error('❌ Error creating student_room_assignments table:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Execute the migration
addPaymentsAssignmentsMigration()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

