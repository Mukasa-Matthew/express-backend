-- Update admin-hostel relationship to allow same email across different hostels
-- and ensure proper cascade deletion

-- First, drop the unique constraint on email
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

-- Create a new unique constraint that allows same email for different roles
-- but ensures unique email per hostel for hostel_admin role
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_role_hostel 
ON users(email, role, hostel_id) 
WHERE role = 'hostel_admin';

-- For non-hostel-admin roles, ensure email is still unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_non_hostel_admin 
ON users(email) 
WHERE role != 'hostel_admin';

-- Update the foreign key constraint to cascade delete
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hostel_id_fkey;
ALTER TABLE users ADD CONSTRAINT users_hostel_id_fkey 
FOREIGN KEY (hostel_id) REFERENCES hostels(id) ON DELETE CASCADE;

-- Add a check constraint to ensure hostel_admin has a hostel_id
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hostel_admin_check;
ALTER TABLE users ADD CONSTRAINT users_hostel_admin_check 
CHECK (
  (role = 'hostel_admin' AND hostel_id IS NOT NULL) OR 
  (role != 'hostel_admin')
);
