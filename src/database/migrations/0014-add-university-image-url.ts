import pool from '../../config/database';

/**
 * Migration to add image_url column to universities table.
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding image_url column to universities table...');

    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE universities
      ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)
    `);

    await client.query('COMMIT');
    console.log('✅ image_url column added to universities');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add image_url column to universities:', error.message);
    throw error;
  } finally {
    client.release();
  }
}






