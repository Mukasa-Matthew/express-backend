ALTER TABLE hostels
  ADD COLUMN IF NOT EXISTS booking_fee NUMERIC(10,2);

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

CREATE INDEX IF NOT EXISTS idx_public_bookings_hostel_id ON public_hostel_bookings(hostel_id);
CREATE INDEX IF NOT EXISTS idx_public_bookings_university_id ON public_hostel_bookings(university_id);
CREATE INDEX IF NOT EXISTS idx_public_bookings_semester_id ON public_hostel_bookings(semester_id);
CREATE INDEX IF NOT EXISTS idx_public_bookings_status ON public_hostel_bookings(status);
CREATE INDEX IF NOT EXISTS idx_public_bookings_verification_code ON public_hostel_bookings(verification_code);

CREATE TABLE IF NOT EXISTS public_booking_payments (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES public_hostel_bookings(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  method VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'completed',
  reference VARCHAR(100),
  notes TEXT,
  recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_booking_payments_booking_id ON public_booking_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_public_booking_payments_method ON public_booking_payments(method);
