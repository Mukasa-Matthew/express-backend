import pool from '../config/database';

async function addStudentProfilesMigration() {
  try {
    console.log('Creating student_profiles table...');
    
    await pool.query(`
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
      );
    `);

    // Indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_student_profiles_access_number ON student_profiles(access_number);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone);');

    console.log('✅ Student profiles table created successfully');
  } catch (error) {
    console.error('❌ Error creating student_profiles table:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Execute the migration
addStudentProfilesMigration()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

