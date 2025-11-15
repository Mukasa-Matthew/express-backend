import pool from '../../config/database';

/**
 * Migration 0017: Add gender allocation to rooms
 * Adds gender_allowed column to rooms table
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add gender_allowed column to rooms table
    await client.query(`
      ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS gender_allowed VARCHAR(20) DEFAULT 'both'
      CHECK (gender_allowed IN ('male', 'female', 'both'))
    `);

    // Create index for better query performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rooms_gender_allowed 
      ON rooms(gender_allowed)
    `);

    await client.query('COMMIT');
    console.log('✅ Migration 0017 completed: Added gender_allowed to rooms');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration 0017 failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

