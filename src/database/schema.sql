-- Create database (run this manually in PostgreSQL)
-- CREATE DATABASE lts_portal;

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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create users table with foreign key to hostels
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'hostel_admin', 'tenant', 'user')),
    hostel_id INTEGER REFERENCES hostels(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Insert super admin user (password is hashed version of '1100211Matt.')
INSERT INTO users (email, name, password, role) VALUES
('matthewmukasa0@gmail.com', 'Matthew Mukasa', '$2a$10$/Wo3t/HwO7WujTd2YeclEeUvq8rUOBy.0cEHv3WxPscYwwpqMZyc2', 'super_admin')
ON CONFLICT (email) DO NOTHING;
