import pool from '../config/database';

async function addAuditLogs() {
  try {
    console.log('Adding audit_logs table...');
    await pool.query('BEGIN');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        requester_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        target_hostel_id INTEGER REFERENCES hostels(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('success','failure')),
        message TEXT,
        ip_address VARCHAR(64),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query('COMMIT');
    console.log('✅ audit_logs table ready');
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('❌ Failed to add audit_logs table:', e);
  } finally {
    await pool.end();
  }
}

addAuditLogs();


