import pool from '../config/database';

async function addRoomsSelfContained() {
  try {
    console.log('Adding self_contained to rooms...');
    await pool.query('BEGIN');
    await pool.query(`
      ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS self_contained BOOLEAN DEFAULT false
    `);
    await pool.query('COMMIT');
    console.log('✅ self_contained added to rooms');
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('❌ Failed to add self_contained to rooms:', e);
  } finally {
    await pool.end();
  }
}

addRoomsSelfContained();


