import pool from '../../config/database';

/**
 * Migration to ensure hostels table has a booking_fee column
 * Older databases may be missing this newer field which is now
 * required by multiple endpoints.
 */
export default async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('Ensuring hostels.booking_fee column exists...');

    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE hostels
      ADD COLUMN IF NOT EXISTS booking_fee INTEGER
    `);

    await client.query('COMMIT');
    console.log('✅ booking_fee column check completed');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add booking_fee column:', error.message);
    throw error;
  } finally {
    client.release();
  }
}


