import pool from '../../config/database';

/**
 * Migration to create semester management tables:
 * - global_semesters (templates)
 * - semesters (instances for hostels)
 * - semester_enrollments (student enrollments)
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Creating semester management tables...');
    
    await client.query('BEGIN');
    
    // Create global_semesters table - Templates created by Super Admin
    await client.query(`
      CREATE TABLE IF NOT EXISTS global_semesters (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create semesters table - Actual semester instances for hostels
    await client.query(`
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
      )
    `);

    // Add global_semester_id column if semesters table already exists without it
    await client.query(`
      ALTER TABLE semesters 
      ADD COLUMN IF NOT EXISTS global_semester_id INTEGER REFERENCES global_semesters(id)
    `);

    // Create semester_enrollments table for tracking students per semester
    await client.query(`
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
      )
    `);

    // Add missing columns to semester_enrollments if table already exists
    await client.query(`
      ALTER TABLE semester_enrollments 
      ADD COLUMN IF NOT EXISTS room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS enrollment_date DATE DEFAULT CURRENT_DATE,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP
    `);

    // Add semester_id to student_room_assignments for historical tracking (if table exists)
    try {
      await client.query(`
        ALTER TABLE student_room_assignments 
        ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      // Table might not exist yet, that's okay
      console.log('   Note: student_room_assignments table not found, skipping');
    }

    // Add semester_id to payments for tracking payments per semester (if table exists)
    try {
      await client.query(`
        ALTER TABLE payments 
        ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      // Table might not exist yet, that's okay
      console.log('   Note: payments table not found, skipping');
    }

    // Add semester_id to expenses for tracking expenses per semester (if table exists)
    try {
      await client.query(`
        ALTER TABLE expenses 
        ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      // Table might not exist yet, that's okay
      console.log('   Note: expenses table not found, skipping');
    }

    // Add semester_mode flag to hostels to enable/disable semester management
    await client.query(`
      ALTER TABLE hostels 
      ADD COLUMN IF NOT EXISTS semester_mode BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS default_semester_fee DECIMAL(10,2)
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_global_semesters_is_active ON global_semesters(is_active)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_hostel_id ON semesters(hostel_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_global_semester_id ON semesters(global_semester_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_status ON semesters(status)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_is_current ON semesters(is_current)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_semesters_dates ON semesters(start_date, end_date)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_semester_enrollments_semester_id ON semester_enrollments(semester_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_semester_enrollments_user_id ON semester_enrollments(user_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_semester_enrollments_status ON semester_enrollments(enrollment_status)
    `);

    await client.query('COMMIT');
    console.log('✅ Semester management tables migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Semester management tables migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}


