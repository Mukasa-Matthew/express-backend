import pool from '../../config/database';

export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding distance_walk_time column to hostels table...');
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE hostels
      ADD COLUMN IF NOT EXISTS distance_walk_time VARCHAR(255)
    `);
    await client.query('COMMIT');
    console.log('✅ distance_walk_time column added successfully');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add distance_walk_time column:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

