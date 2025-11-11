import pool from '../../config/database';

/**
 * Migration to enhance public hostel bookings and introduce payment tracking.
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Extending public_hostel_bookings table and creating payments table...');
    await client.query('BEGIN');

    const tableCheck = await client.query(
      `SELECT to_regclass('public.public_hostel_bookings') AS table_name`
    );
    const tableExists = !!tableCheck.rows[0]?.table_name;

    if (!tableExists) {
      console.log('   public_hostel_bookings table missing; creating fresh table with new schema...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS public_hostel_bookings (
          id SERIAL PRIMARY KEY,
          hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
          university_id INTEGER REFERENCES universities(id) ON DELETE SET NULL,
          semester_id INTEGER REFERENCES semesters(id) ON DELETE SET NULL,
          room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
          source VARCHAR(30) NOT NULL DEFAULT 'online',
          created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          student_name VARCHAR(255) NOT NULL,
          student_email VARCHAR(255),
          student_phone VARCHAR(30) NOT NULL,
          whatsapp VARCHAR(30),
          gender VARCHAR(20),
          date_of_birth DATE,
          registration_number VARCHAR(100),
          course VARCHAR(100),
          preferred_check_in TIMESTAMPTZ,
          stay_duration VARCHAR(100),
          emergency_contact VARCHAR(100),
          notes TEXT,
          currency VARCHAR(10) NOT NULL DEFAULT 'UGX',
          booking_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
          amount_due NUMERIC(10,2) NOT NULL DEFAULT 0,
          amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
          payment_phone VARCHAR(30),
          payment_reference VARCHAR(100),
          payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          verification_code VARCHAR(50),
          verification_issued_at TIMESTAMPTZ,
          confirmed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_public_bookings_hostel_id ON public_hostel_bookings(hostel_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_public_bookings_university_id ON public_hostel_bookings(university_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_public_bookings_semester_id ON public_hostel_bookings(semester_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_public_bookings_status ON public_hostel_bookings(status);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_public_bookings_verification_code ON public_hostel_bookings(verification_code);
      `);
    } else {
      // Ensure new columns exist on public_hostel_bookings
      await client.query(`
        ALTER TABLE public_hostel_bookings
          ADD COLUMN IF NOT EXISTS semester_id INTEGER,
          ADD COLUMN IF NOT EXISTS room_id INTEGER,
          ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'online',
          ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER,
          ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(30),
          ADD COLUMN IF NOT EXISTS date_of_birth DATE,
          ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100),
          ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(100),
          ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'UGX',
          ADD COLUMN IF NOT EXISTS amount_due NUMERIC(10, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS verification_code VARCHAR(50),
          ADD COLUMN IF NOT EXISTS verification_issued_at TIMESTAMP;
      `);

      // Convert booking_fee to NUMERIC if it was stored as integer previously
      await client.query(`
        ALTER TABLE public_hostel_bookings
          ALTER COLUMN booking_fee TYPE NUMERIC(10, 2)
          USING booking_fee::NUMERIC(10, 2);
      `);

      // Backfill amount_due with booking_fee where amount_due is still zero
      await client.query(`
        UPDATE public_hostel_bookings
        SET amount_due = booking_fee
        WHERE (amount_due IS NULL OR amount_due = 0) AND booking_fee IS NOT NULL;
      `);

      // Create indexes for faster lookups
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_public_bookings_semester_id ON public_hostel_bookings(semester_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_public_bookings_status ON public_hostel_bookings(status);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_public_bookings_verification_code ON public_hostel_bookings(verification_code);
      `);

      // Add foreign key constraints (if they don't already exist)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'fk_public_bookings_semester'
              AND table_name = 'public_hostel_bookings'
          ) THEN
            ALTER TABLE public_hostel_bookings
              ADD CONSTRAINT fk_public_bookings_semester
              FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'fk_public_bookings_room'
              AND table_name = 'public_hostel_bookings'
          ) THEN
            ALTER TABLE public_hostel_bookings
              ADD CONSTRAINT fk_public_bookings_room
              FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'fk_public_bookings_created_by'
              AND table_name = 'public_hostel_bookings'
          ) THEN
            ALTER TABLE public_hostel_bookings
              ADD CONSTRAINT fk_public_bookings_created_by
              FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);
    }

    // Ensure public_booking_payments table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public_booking_payments (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES public_hostel_bookings(id) ON DELETE CASCADE,
        amount NUMERIC(10, 2) NOT NULL,
        method VARCHAR(30) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'completed',
        reference VARCHAR(100),
        notes TEXT,
        recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        recorded_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_public_booking_payments_booking_id
      ON public_booking_payments(booking_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_public_booking_payments_method
      ON public_booking_payments(method);
    `);

    console.log('✅ public_hostel_bookings extended and payment tracking enabled');
    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to extend public bookings:', error.message);
    throw error;
  } finally {
    client.release();
  }
}


