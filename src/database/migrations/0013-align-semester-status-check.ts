import pool from '../../config/database';

/**
 * Some deployments still have the original semesters.status CHECK constraint that only
 * allowed the values ('upcoming', 'active', 'ended', 'cancelled'). Newer code writes
 * the value 'completed', which causes a constraint violation during the automated
 * semester scheduler. This migration refreshes the constraint so that both historic
 * ('ended') and current ('completed') values are accepted.
 */
export default async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('Updating semesters.status check constraint to allow completed status...');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE semesters
      DROP CONSTRAINT IF EXISTS semesters_status_check
    `);

    await client.query(`
      ALTER TABLE semesters
      ADD CONSTRAINT semesters_status_check
      CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled', 'ended'))
    `);

    await client.query('COMMIT');
    console.log('✅ semesters.status constraint updated');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update semesters.status constraint:', error.message);
    throw error;
  } finally {
    client.release();
  }
}


