import pool from '../config/database';

async function addSemesterManagementMigration() {
  try {
    console.log('Adding semester management system...');

    await pool.query('BEGIN');

    // Create global_semesters table - Templates created by Super Admin
    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_semesters (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create semesters table - Actual semester instances for hostels
    await pool.query(`
      CREATE TABLE IF NOT EXISTS semesters (
        id SERIAL PRIMARY KEY,
        hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
        global_semester_id INTEGER REFERENCES global_semesters(id),
        name VARCHAR(100) NOT NULL,
        academic_year VARCHAR(20) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        is_current BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT valid_dates CHECK (end_date > start_date)
      );
    `);

    // Create semester_enrollments table for tracking students per semester
    await pool.query(`
      CREATE TABLE IF NOT EXISTS semester_enrollments (
        id SERIAL PRIMARY KEY,
        semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
        enrollment_date DATE DEFAULT CURRENT_DATE,
        enrollment_status VARCHAR(20) DEFAULT 'active' CHECK (enrollment_status IN ('active', 'completed', 'dropped', 'transferred')),
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(semester_id, user_id)
      );
    `);

    // Add semester_id to student_room_assignments for historical tracking
    await pool.query(`
      ALTER TABLE student_room_assignments 
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL;
    `);

    // Add semester_id to payments for tracking payments per semester
    await pool.query(`
      ALTER TABLE payments 
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL;
    `);

    // Add semester_id to expenses for tracking expenses per semester
    await pool.query(`
      ALTER TABLE expenses 
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL;
    `);

    // Add semester_mode flag to hostels to enable/disable semester management
    await pool.query(`
      ALTER TABLE hostels 
      ADD COLUMN IF NOT EXISTS semester_mode BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS default_semester_fee DECIMAL(10,2);
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_global_semesters_is_active ON global_semesters(is_active);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_hostel_id ON semesters(hostel_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_global_semester_id ON semesters(global_semester_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_status ON semesters(status);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_is_current ON semesters(is_current);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_dates ON semesters(start_date, end_date);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_semester_enrollments_semester_id ON semester_enrollments(semester_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_semester_id ON payments(semester_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_expenses_semester_id ON expenses(semester_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_semester_enrollments_user_id ON semester_enrollments(user_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_semester_enrollments_status ON semester_enrollments(enrollment_status);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_student_room_assignments_semester_id ON student_room_assignments(semester_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_semester_id ON payments(semester_id);
    `);

    await pool.query('COMMIT');
    console.log('✅ Semester management system added successfully');
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Failed to add semester management system:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  addSemesterManagementMigration()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default addSemesterManagementMigration;

