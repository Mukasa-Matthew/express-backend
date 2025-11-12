import pool from '../../config/database';

/**
 * Migration to expand universities.image_url column to TEXT to support large image URLs/base64 data.
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Expanding universities.image_url column to TEXT...');

    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE universities
      ALTER COLUMN image_url TYPE TEXT
    `);

    await client.query('COMMIT');
    console.log('✅ universities.image_url column expanded to TEXT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to expand universities.image_url column:', error.message);
    throw error;
  } finally {
    client.release();
  }
}















