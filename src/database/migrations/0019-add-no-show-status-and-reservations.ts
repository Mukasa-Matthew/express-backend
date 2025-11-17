import pool from '../../config/database';

export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding no_show status to public_hostel_bookings and creating room_reservations table...');
    await client.query('BEGIN');

    // 1. Add 'no_show' status to public_hostel_bookings
    // First, drop existing constraint if it exists
    const constraintCheck = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public_hostel_bookings'::regclass
        AND contype = 'c'
        AND conname LIKE '%status%'
    `);

    if (constraintCheck.rows.length > 0) {
      for (const row of constraintCheck.rows) {
        try {
          await client.query(`
            ALTER TABLE public_hostel_bookings
            DROP CONSTRAINT IF EXISTS ${row.conname}
          `);
        } catch (error: any) {
          // Ignore if constraint doesn't exist
          if (error.code !== '42704') {
            throw error;
          }
        }
      }
    }

    // Add new constraint allowing 'no_show' status
    await client.query(`
      ALTER TABLE public_hostel_bookings
      ADD CONSTRAINT check_booking_status
      CHECK (status IN ('pending', 'booked', 'checked_in', 'cancelled', 'no_show', 'expired'))
    `);

    // 2. Create room_reservations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_reservations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        current_semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
        reserved_for_semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'confirmed', 'cancelled', 'expired')),
        reservation_date TIMESTAMP NOT NULL DEFAULT NOW(),
        confirmed_at TIMESTAMP,
        expires_at TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, reserved_for_semester_id, room_id)
      );
    `);

    // Add indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_room_reservations_user_id ON room_reservations(user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_room_reservations_room_id ON room_reservations(room_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_room_reservations_reserved_semester ON room_reservations(reserved_for_semester_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_room_reservations_status ON room_reservations(status);
    `);

    await client.query('COMMIT');
    console.log('✅ no_show status and room_reservations table migration completed');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ no_show status and room_reservations table migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

