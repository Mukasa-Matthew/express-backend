import pool from '../config/database';

async function addCustodianMigration() {
  try {
    console.log('Starting custodian migration...');

    // 1) Update users.role constraint to include 'custodian'
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'users_role_check'
        ) THEN
          ALTER TABLE users DROP CONSTRAINT users_role_check;
        END IF;
      END$$;
    `);

    await pool.query(`
      ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin','hostel_admin','tenant','user','custodian'));
    `);

    // 2) Create custodians table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custodians (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        hostel_id INTEGER REFERENCES hostels(id) ON DELETE CASCADE,
        phone VARCHAR(30),
        location TEXT,
        national_id_image_path TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_custodians_hostel_id ON custodians(hostel_id);`);

    console.log('✅ Custodian migration complete');
  } catch (e) {
    console.error('❌ Custodian migration failed:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  addCustodianMigration();
}

export default addCustodianMigration;



