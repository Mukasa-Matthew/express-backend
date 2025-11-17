import pool from '../../config/database';

export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Creating announcements and notifications tables...');
    await client.query('BEGIN');

    // Create announcements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        published_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Create notifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT false,
        read_at TIMESTAMP,
        link VARCHAR(500),
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Add indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_announcements_hostel_id ON announcements(hostel_id);
      CREATE INDEX IF NOT EXISTS idx_announcements_is_active ON announcements(is_active);
      CREATE INDEX IF NOT EXISTS idx_announcements_published_at ON announcements(published_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
    `);

    await client.query('COMMIT');
    console.log('✅ announcements and notifications tables created successfully');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to create announcements and notifications tables:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

