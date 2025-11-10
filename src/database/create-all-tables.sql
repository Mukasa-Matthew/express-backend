-- Complete database schema for RooMio Hostel Management System

-- Create hostels table first (no foreign key dependencies)
CREATE TABLE IF NOT EXISTS hostels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    description TEXT,
    total_rooms INTEGER NOT NULL DEFAULT 0,
    available_rooms INTEGER NOT NULL DEFAULT 0,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'suspended')),
    university_id INTEGER,
    region_id INTEGER,
    price_per_room INTEGER,
    occupancy_type VARCHAR(10) CHECK (occupancy_type IN ('male','female','mixed')),
    distance_from_campus DECIMAL(5,2),
    amenities TEXT,
    rules_and_regulations TEXT,
    is_published BOOLEAN DEFAULT FALSE,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create regions table
CREATE TABLE IF NOT EXISTS regions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    country VARCHAR(100) NOT NULL DEFAULT 'Uganda',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create universities table
CREATE TABLE IF NOT EXISTS universities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    code VARCHAR(20) UNIQUE,
    region_id INTEGER REFERENCES regions(id),
    address TEXT,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(100),
    website VARCHAR(200),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE,
    name VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'hostel_admin', 'tenant', 'user', 'custodian')),
    hostel_id INTEGER REFERENCES hostels(id) ON DELETE SET NULL,
    university_id INTEGER REFERENCES universities(id),
    profile_picture VARCHAR(500),
    password_is_temp BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on users email
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    room_number VARCHAR(50) NOT NULL,
    floor INTEGER DEFAULT 1,
    capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1 AND capacity <= 4),
    current_occupants INTEGER DEFAULT 0,
    price DECIMAL(10, 2) NOT NULL,
    amenities TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance', 'reserved')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(hostel_id, room_number)
);

-- Create students table (extends users)
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registration_number VARCHAR(100) UNIQUE NOT NULL,
    access_number VARCHAR(100) UNIQUE,
    course VARCHAR(255),
    year_of_study INTEGER,
    phone_number VARCHAR(20),
    guardian_name VARCHAR(255),
    guardian_phone VARCHAR(20),
    emergency_contact VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Create semesters table (needed before other tables)
CREATE TABLE IF NOT EXISTS semesters (
    id SERIAL PRIMARY KEY,
    hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    academic_year VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled', 'ended')),
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create student room assignments table
CREATE TABLE IF NOT EXISTS student_room_assignments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    semester_id INTEGER REFERENCES semesters(id),
    assigned_by INTEGER REFERENCES users(id),
    assignment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    checkout_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create payments table
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    semester_id INTEGER REFERENCES semesters(id),
    amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'card')),
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    transaction_id VARCHAR(255),
    currency VARCHAR(10) DEFAULT 'UGX',
    recorded_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    paid_by INTEGER REFERENCES users(id),
    receipt_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create inventory table
CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit VARCHAR(50) DEFAULT 'pieces',
    condition VARCHAR(50) DEFAULT 'good' CHECK (condition IN ('good', 'fair', 'poor', 'needs_repair')),
    location VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create custodians table
CREATE TABLE IF NOT EXISTS custodians (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, hostel_id)
);

-- Create subscription plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2),
    price_per_month DECIMAL(10, 2),
    total_price DECIMAL(10, 2),
    duration_months INTEGER NOT NULL DEFAULT 1,
    features JSONB DEFAULT '[]',
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create hostel subscriptions table
CREATE TABLE IF NOT EXISTS hostel_subscriptions (
    id SERIAL PRIMARY KEY,
    hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NOT NULL,
    amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
    payment_method VARCHAR(50),
    payment_reference VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    changes JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create semester enrollments table
CREATE TABLE IF NOT EXISTS semester_enrollments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    enrollment_status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (enrollment_status IN ('active', 'completed', 'dropped', 'transferred')),
    total_amount DECIMAL(10, 2) DEFAULT 0,
    amount_paid DECIMAL(10, 2) DEFAULT 0,
    balance DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, semester_id)
);

-- Add missing columns to hostels table if they don't exist (for existing databases)
ALTER TABLE hostels 
ADD COLUMN IF NOT EXISTS university_id INTEGER,
ADD COLUMN IF NOT EXISTS region_id INTEGER,
ADD COLUMN IF NOT EXISTS price_per_room INTEGER,
ADD COLUMN IF NOT EXISTS occupancy_type VARCHAR(10),
ADD COLUMN IF NOT EXISTS distance_from_campus DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS amenities TEXT,
ADD COLUMN IF NOT EXISTS rules_and_regulations TEXT,
ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS current_subscription_id INTEGER;

-- Add missing columns to hostel_subscriptions table if they don't exist (for existing databases)
ALTER TABLE hostel_subscriptions 
ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100);

-- Add constraint for occupancy_type (will fail silently if exists - handled by error code)
-- Note: PostgreSQL doesn't support IF NOT EXISTS for constraints, errors are caught and ignored

-- Create hostel_images table
CREATE TABLE IF NOT EXISTS hostel_images (
    id SERIAL PRIMARY KEY,
    hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    caption VARCHAR(255),
    is_primary BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for hostel_images
CREATE INDEX IF NOT EXISTS idx_hostel_images_hostel_id ON hostel_images(hostel_id);

-- Create index for published hostels
CREATE INDEX IF NOT EXISTS idx_hostels_is_published ON hostels(is_published) WHERE is_published = TRUE;

-- Create index for current_subscription_id
CREATE INDEX IF NOT EXISTS idx_hostels_current_subscription_id ON hostels(current_subscription_id) WHERE current_subscription_id IS NOT NULL;

-- Note: Super admin user is created automatically from .env variables on startup
-- See src/database/initialize.ts for super admin setup

-- Insert default macro regions
INSERT INTO regions (name, country) VALUES 
('Central', 'Uganda'),
('Eastern', 'Uganda'),
('Northern', 'Uganda'),
('Western', 'Uganda'),
('Fort Portal', 'Uganda'),
('Lira', 'Uganda'),
('Soroti', 'Uganda')
ON CONFLICT (name) DO NOTHING;
