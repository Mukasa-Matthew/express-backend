import pool from '../config/database';
import bcrypt from 'bcryptjs';
import { CredentialGenerator } from '../utils/credentialGenerator';

async function generateNewCredentials() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Generating new credentials for hostel admin...');
    
    // Get the user
    const userQuery = "SELECT id, email, name FROM users WHERE email = $1 AND hostel_id IS NOT NULL";
    const userResult = await client.query(userQuery, ['matthewkesh950@gmail.com']);
    
    if (userResult.rows.length === 0) {
      console.log('❌ User not found');
      return;
    }
    
    const user = userResult.rows[0];
    console.log('✅ User found:', user.name, user.email);
    
    // Generate new password
    const newPassword = CredentialGenerator.generatePatternPassword();
    console.log('🔐 New password generated:', newPassword);
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update the user's password
    const updateQuery = "UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2";
    await client.query(updateQuery, [hashedPassword, user.id]);
    
    console.log('✅ Password updated in database');
    
    // Get hostel info
    const hostelQuery = "SELECT name FROM hostels WHERE id = (SELECT hostel_id FROM users WHERE id = $1)";
    const hostelResult = await client.query(hostelQuery, [user.id]);
    
    if (hostelResult.rows.length > 0) {
      const hostel = hostelResult.rows[0];
      console.log('✅ Hostel:', hostel.name);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🔐 NEW LOGIN CREDENTIALS');
    console.log('='.repeat(60));
    console.log('Email:', user.email);
    console.log('Password:', newPassword);
    console.log('='.repeat(60));
    console.log('You can now use these credentials to log in!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error generating credentials:', error);
  } finally {
    client.release();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  generateNewCredentials()
    .then(() => {
      console.log('🎉 Credentials generated!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Failed to generate credentials:', error);
      process.exit(1);
    });
}

export default generateNewCredentials;
