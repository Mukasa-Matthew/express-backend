ALTER TABLE hostels ADD COLUMN IF NOT EXISTS booking_fee INTEGER;

CREATE TABLE IF NOT EXISTS public_hostel_bookings (
  id SERIAL PRIMARY KEY,
  hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  university_id INTEGER REFERENCES universities(id) ON DELETE SET NULL,
  student_name VARCHAR(255) NOT NULL,
  student_email VARCHAR(255),
  student_phone VARCHAR(30) NOT NULL,
  gender VARCHAR(20),
  course VARCHAR(100),
  preferred_check_in TIMESTAMPTZ,
  stay_duration VARCHAR(100),
  notes TEXT,
  booking_fee INTEGER NOT NULL,
  payment_phone VARCHAR(30),
  payment_reference VARCHAR(100),
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_bookings_hostel_id ON public_hostel_bookings(hostel_id);
CREATE INDEX IF NOT EXISTS idx_public_bookings_university_id ON public_hostel_bookings(university_id);
