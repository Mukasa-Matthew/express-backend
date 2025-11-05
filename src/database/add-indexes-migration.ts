import pool from '../config/database';

async function createIndex(sql: string) {
  try {
    await pool.query(sql);
    console.log('OK:', sql);
  } catch (e) {
    console.warn('Index create warning:', (e as any)?.message || e);
  }
}

async function run() {
  const client = await pool.connect();
  try {
    console.log('Adding indexes (no transaction, using CONCURRENTLY IF NOT EXISTS)...');

    await createIndex(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_hostel_role ON users(hostel_id, role)`);
    await createIndex(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_hostel ON payments(hostel_id)`);
    await createIndex(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_user ON payments(user_id)`);
    await createIndex(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rooms_hostel_status ON rooms(hostel_id, status)`);
    await createIndex(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sra_user_status ON student_room_assignments(user_id, status)`);
    await createIndex(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_hostel ON inventory_items(hostel_id)`);
    await createIndex(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_hostel_spent ON expenses(hostel_id, spent_at)`);

    console.log('Indexes added/ensured');
  } catch (e) {
    console.error('Indexes migration failed:', e);
  } finally {
    client.release();
    process.exit(0);
  }
}

run();

