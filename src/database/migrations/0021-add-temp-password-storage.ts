import pool from '../../config/database';

export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Creating temporary_password_storage table...');
    await client.query('BEGIN');

    // Create table to store temporary passwords (plain text) for custodian viewing
    await client.query(`
      CREATE TABLE IF NOT EXISTS temporary_password_storage (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        temporary_password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE(user_id)
      );
    `);

    // Add index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_temp_password_user_id ON temporary_password_storage(user_id);
    `);

    await client.query('COMMIT');
    console.log('✅ temporary_password_storage table created successfully');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to create temporary_password_storage table:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

