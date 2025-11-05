import pool from '../config/database';
import bcrypt from 'bcryptjs';
import { CredentialGenerator } from '../utils/credentialGenerator';

async function recreateHostel() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Recreating hostel and admin...');
    
    await client.query('BEGIN');
    
    // Create hostel
    const hostelQuery = `
      INSERT INTO hostels (name, address, description, total_rooms, available_rooms, contact_phone, contact_email, status, university_id, region_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING id, name
    `;
    
    const hostelResult = await client.query(hostelQuery, [
      'Calton Hostel',
      'Kampala, Uganda',
      'A comfortable hostel for students',
      50,
      45,
      '+256700000000',
      'info@calton.com',
      'active',
      5, // Busitema University
      2  // Eastern Region
    ]);
    
    const hostel = hostelResult.rows[0];
    console.log('✅ Hostel created:', hostel.name, 'ID:', hostel.id);
    
    // Generate temporary password
    const temporaryPassword = CredentialGenerator.generatePatternPassword();
    console.log('🔐 Generated password:', temporaryPassword);
    
    // Hash password
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    
    // Create admin user
    const userQuery = `
      INSERT INTO users (email, name, password, role, hostel_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id, email, name, role, hostel_id
    `;
    
    const userResult = await client.query(userQuery, [
      'matthewkesh950@gmail.com',
      'Matthew Kesh',
      hashedPassword,
      'hostel_admin',
      hostel.id
    ]);
    
    const user = userResult.rows[0];
    console.log('✅ Admin user created:', user.name, user.email);
    
    await client.query('COMMIT');
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 HOSTEL AND ADMIN RECREATED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log('Hostel:', hostel.name);
    console.log('Admin:', user.name);
    console.log('Email:', user.email);
    console.log('Password:', temporaryPassword);
    console.log('='.repeat(60));
    console.log('You can now log in with these credentials!');
    console.log('='.repeat(60));
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error recreating hostel:', error);
  } finally {
    client.release();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  recreateHostel()
    .then(() => {
      console.log('🎉 Recreation completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Recreation failed:', error);
      process.exit(1);
    });
}

export default recreateHostel;
