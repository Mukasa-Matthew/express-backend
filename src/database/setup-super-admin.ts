import bcrypt from 'bcryptjs';
import pool from '../config/database';

async function setupSuperAdmin() {
  try {
    console.log('🔧 Setting up Super Admin...');

    // Check if super admin already exists
    const existingAdmin = await pool.query(
      'SELECT id FROM users WHERE role = $1',
      ['super_admin']
    );

    if (existingAdmin.rows.length > 0) {
      console.log('✅ Super Admin already exists');
      return;
    }

    // Get credentials from .env (required)
    const defaultEmail = process.env.SUPER_ADMIN_EMAIL;
    const defaultUsername = process.env.SUPER_ADMIN_USERNAME;
    const defaultPassword = process.env.SUPER_ADMIN_PASSWORD;
    const defaultName = process.env.SUPER_ADMIN_NAME;

    // Validate required environment variables
    if (!defaultEmail || !defaultUsername || !defaultPassword || !defaultName) {
      console.error('❌ Super Admin credentials missing in .env file!');
      console.error('Required variables:');
      console.error('  - SUPER_ADMIN_EMAIL');
      console.error('  - SUPER_ADMIN_USERNAME');
      console.error('  - SUPER_ADMIN_PASSWORD');
      console.error('  - SUPER_ADMIN_NAME');
      throw new Error('Super Admin credentials are required in .env file');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // Create super admin
    const result = await pool.query(
      `INSERT INTO users (name, email, username, password, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id, name, email, username, role`,
      [defaultName, defaultEmail, defaultUsername, hashedPassword, 'super_admin']
    );

    const admin = result.rows[0];

    console.log('🎉 Super Admin created successfully!');
    console.log('📧 Email:', admin.email);
    console.log('👤 Username:', admin.username);
    console.log('🔑 Password:', defaultPassword);
    console.log('⚠️  IMPORTANT: Change these credentials after first login!');

  } catch (error) {
    console.error('❌ Error setting up Super Admin:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupSuperAdmin()
    .then(() => {
      console.log('✅ Setup completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

export default setupSuperAdmin;
