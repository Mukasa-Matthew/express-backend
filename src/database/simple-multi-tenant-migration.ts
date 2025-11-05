import pool from '../config/database';

async function simpleMultiTenantMigration() {
  try {
    console.log('Starting simple multi-tenant migration...');
    
    await pool.query('BEGIN');
    
    // Create regions table
    console.log('Creating regions table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS regions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        country VARCHAR(100) NOT NULL DEFAULT 'Uganda',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create universities table
    console.log('Creating universities table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS universities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        code VARCHAR(20) UNIQUE,
        region_id INTEGER REFERENCES regions(id),
        address TEXT,
        contact_phone VARCHAR(20),
        contact_email VARCHAR(100),
        website VARCHAR(200),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add new columns to existing tables
    console.log('Adding university_id to hostels...');
    await pool.query(`
      ALTER TABLE hostels 
      ADD COLUMN IF NOT EXISTS university_id INTEGER REFERENCES universities(id),
      ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES regions(id)
    `);
    
    console.log('Adding university_id to users...');
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS university_id INTEGER REFERENCES universities(id)
    `);
    
    // Update user roles constraint
    console.log('Updating user roles constraint...');
    await pool.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check
    `);
    await pool.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'university_admin', 'hostel_admin', 'user'))
    `);
    
    // Insert default regions
    console.log('Inserting default regions...');
    await pool.query(`
      INSERT INTO regions (name, country) VALUES 
      ('Kampala', 'Uganda'),
      ('Jinja', 'Uganda'),
      ('Mbarara', 'Uganda'),
      ('Gulu', 'Uganda'),
      ('Masaka', 'Uganda'),
      ('Mbale', 'Uganda'),
      ('Arua', 'Uganda'),
      ('Fort Portal', 'Uganda'),
      ('Lira', 'Uganda'),
      ('Soroti', 'Uganda')
      ON CONFLICT (name) DO NOTHING
    `);
    
    // Insert sample universities
    console.log('Inserting sample universities...');
    await pool.query(`
      INSERT INTO universities (name, code, region_id, address, contact_email) VALUES 
      ('Makerere University', 'MAK', 1, 'Kampala, Uganda', 'info@mak.ac.ug'),
      ('Kyambogo University', 'KYU', 1, 'Kampala, Uganda', 'info@kyu.ac.ug'),
      ('Mbarara University of Science and Technology', 'MUST', 3, 'Mbarara, Uganda', 'info@must.ac.ug'),
      ('Gulu University', 'GU', 4, 'Gulu, Uganda', 'info@gu.ac.ug'),
      ('Busitema University', 'BU', 2, 'Busitema, Uganda', 'info@busitema.ac.ug'),
      ('Uganda Christian University', 'UCU', 1, 'Mukono, Uganda', 'info@ucu.ac.ug')
      ON CONFLICT (code) DO NOTHING
    `);
    
    // Create indexes
    console.log('Creating indexes...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hostels_university_id ON hostels(university_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hostels_region_id ON hostels(region_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_university_id ON users(university_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_universities_region_id ON universities(region_id)
    `);
    
    await pool.query('COMMIT');
    console.log('✅ Simple multi-tenant migration completed successfully!');
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Simple multi-tenant migration failed:', error);
  } finally {
    await pool.end();
    console.log('Migration completed');
  }
}

simpleMultiTenantMigration();
