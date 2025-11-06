import pool from '../config/database';
import bcrypt from 'bcryptjs';

async function fixSuperAdmin() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Checking and fixing Super Admin account...\n');
    
    // Get credentials from .env or use defaults
    const email = process.env.SUPER_ADMIN_EMAIL || 'mattewmukasa0@gmail.com';
    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPER_ADMIN_PASSWORD || '1100211Matt.';
    const name = process.env.SUPER_ADMIN_NAME || 'Super Admin';
    
    console.log('📧 Email:', email);
    console.log('👤 Username:', username);
    console.log('🔐 Password:', password);
    console.log('📛 Name:', name);
    console.log('');
    
    // Check if super admin exists
    const existingQuery = "SELECT id, email, username, name, role FROM users WHERE role = 'super_admin' OR lower(email) = lower($1)";
    const existingResult = await client.query(existingQuery, [email]);
    
    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      console.log('✅ Found existing super admin:');
      console.log('   ID:', existing.id);
      console.log('   Email:', existing.email);
      console.log('   Username:', existing.username || 'N/A');
      console.log('   Name:', existing.name);
      console.log('');
      
      // Update password to ensure it's correct
      const hashedPassword = await bcrypt.hash(password, 10);
      await client.query(
        'UPDATE users SET password = $1, email = $2, username = $3, name = $4, updated_at = NOW() WHERE id = $5',
        [hashedPassword, email, username, name, existing.id]
      );
      
      console.log('✅ Super Admin password and details updated!');
      console.log('');
      console.log('='.repeat(60));
      console.log('🔐 SUPER ADMIN CREDENTIALS');
      console.log('='.repeat(60));
      console.log('Email:', email);
      console.log('Username:', username);
      console.log('Password:', password);
      console.log('='.repeat(60));
      console.log('You can now log in with these credentials!');
      console.log('='.repeat(60));
    } else {
      console.log('⚠️  No super admin found. Creating new one...');
      
      // Create super admin
      const hashedPassword = await bcrypt.hash(password, 10);
      const insertQuery = `
        INSERT INTO users (email, username, name, password, role, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id, email, username, name, role
      `;
      
      const insertResult = await client.query(insertQuery, [
        email,
        username,
        name,
        hashedPassword,
        'super_admin'
      ]);
      
      const newAdmin = insertResult.rows[0];
      console.log('✅ Super Admin created successfully!');
      console.log('');
      console.log('='.repeat(60));
      console.log('🔐 SUPER ADMIN CREDENTIALS');
      console.log('='.repeat(60));
      console.log('Email:', newAdmin.email);
      console.log('Username:', newAdmin.username);
      console.log('Password:', password);
      console.log('='.repeat(60));
      console.log('You can now log in with these credentials!');
      console.log('='.repeat(60));
    }
    
  } catch (error) {
    console.error('❌ Error fixing super admin:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  fixSuperAdmin()
    .then(() => {
      console.log('\n✅ Fix completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Fix failed:', error);
      process.exit(1);
    });
}

export default fixSuperAdmin;




