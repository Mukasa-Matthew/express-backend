import pool from '../config/database';

async function addUsernameMigration() {
  try {
    console.log('Adding username column to users table...');
    
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;
    `);

    // Create index for username lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);

    console.log('✅ Username column added successfully');
  } catch (error) {
    console.error('❌ Error adding username column:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Execute the migration
addUsernameMigration()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

