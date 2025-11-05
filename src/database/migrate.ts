import pool from '../config/database';

async function migrateDatabase() {
  try {
    console.log('Starting database migration...');
    
    // Drop the existing users table and recreate with new constraints
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    console.log('✓ Dropped existing users table');
    
    // Recreate users table with new role constraints
    const createUsersTable = `
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'hostel_admin', 'tenant', 'user')),
        hostel_id INTEGER REFERENCES hostels(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await pool.query(createUsersTable);
    console.log('✓ Recreated users table with new constraints');
    
    // Recreate index
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    console.log('✓ Recreated email index');
    
    // Insert super admin user
    await pool.query(`
      INSERT INTO users (email, name, password, role) VALUES
      ('matthewmukasa0@gmail.com', 'Matthew Mukasa', '$2a$10$/Wo3t/HwO7WujTd2YeclEeUvq8rUOBy.0cEHv3WxPscYwwpqMZyc2', 'super_admin')
    `);
    console.log('✓ Inserted super admin user');
    
    console.log('✅ Database migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateDatabase()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export default migrateDatabase;
