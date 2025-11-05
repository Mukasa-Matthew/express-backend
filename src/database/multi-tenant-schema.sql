-- Multi-tenant LTS Portal Database Schema
-- Supports universities, regions, and proper tenant isolation

-- Create regions table for proper geographic organization
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
    code VARCHAR(20) UNIQUE, -- e.g., "MAK", "KYU", "MUBS"
    region_id INTEGER REFERENCES regions(id),
    address TEXT,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(100),
    website VARCHAR(200),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Update hostels table to include university relationship
ALTER TABLE hostels 
ADD COLUMN IF NOT EXISTS university_id INTEGER REFERENCES universities(id),
ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES regions(id);

-- Update users table to include university relationship
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS university_id INTEGER REFERENCES universities(id);

-- Create university_admins table for university-level administrators
CREATE TABLE IF NOT EXISTS university_admins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    university_id INTEGER REFERENCES universities(id) ON DELETE CASCADE,
    permissions JSONB DEFAULT '{}', -- Store specific permissions
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, university_id)
);

-- Insert default macro regions only
INSERT INTO regions (name, country) VALUES 
('Central', 'Uganda'),
('Eastern', 'Uganda'),
('Northern', 'Uganda'),
('Western', 'Uganda'),
('Fort Portal', 'Uganda'),
('Lira', 'Uganda'),
('Soroti', 'Uganda')
ON CONFLICT (name) DO NOTHING;

-- Insert sample universities
INSERT INTO universities (name, code, region_id, address, contact_email) VALUES 
('Makerere University', 'MAK', 1, 'Kampala, Uganda', 'info@mak.ac.ug'),
('Kyambogo University', 'KYU', 1, 'Kampala, Uganda', 'info@kyu.ac.ug'),
('Mbarara University of Science and Technology', 'MUST', 3, 'Mbarara, Uganda', 'info@must.ac.ug'),
('Gulu University', 'GU', 4, 'Gulu, Uganda', 'info@gu.ac.ug'),
('Busitema University', 'BU', 2, 'Busitema, Uganda', 'info@busitema.ac.ug'),
('Uganda Christian University', 'UCU', 1, 'Mukono, Uganda', 'info@ucu.ac.ug')
ON CONFLICT (code) DO NOTHING;

-- Update user roles to include university_admin
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'university_admin', 'hostel_admin', 'user'));

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_hostels_university_id ON hostels(university_id);
CREATE INDEX IF NOT EXISTS idx_hostels_region_id ON hostels(region_id);
CREATE INDEX IF NOT EXISTS idx_users_university_id ON users(university_id);
CREATE INDEX IF NOT EXISTS idx_universities_region_id ON universities(region_id);
