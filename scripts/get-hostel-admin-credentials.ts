import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'lts_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function getHostelAdminCredentials(hostelId?: number, adminEmail?: string) {
  try {
    let query = '';
    let params: any[] = [];

    if (hostelId) {
      // Get by hostel ID
      query = `
        SELECT 
          u.id,
          u.email,
          u.name,
          u.username,
          h.name as hostel_name,
          h.id as hostel_id
        FROM users u
        JOIN hostels h ON u.hostel_id = h.id
        WHERE h.id = $1 AND u.role = 'hostel_admin'
        LIMIT 1
      `;
      params = [hostelId];
    } else if (adminEmail) {
      // Get by admin email
      query = `
        SELECT 
          u.id,
          u.email,
          u.name,
          u.username,
          h.name as hostel_name,
          h.id as hostel_id
        FROM users u
        JOIN hostels h ON u.hostel_id = h.id
        WHERE u.email = $1 AND u.role = 'hostel_admin'
        LIMIT 1
      `;
      params = [adminEmail];
    } else {
      // List all hostel admins
      query = `
        SELECT 
          u.id,
          u.email,
          u.name,
          u.username,
          h.name as hostel_name,
          h.id as hostel_id
        FROM users u
        JOIN hostels h ON u.hostel_id = h.id
        WHERE u.role = 'hostel_admin'
        ORDER BY h.name, u.name
      `;
      params = [];
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      console.log('❌ No hostel admin found');
      process.exit(1);
    }

    console.log('\n' + '='.repeat(70));
    console.log('📋 HOSTEL ADMIN CREDENTIALS');
    console.log('='.repeat(70));
    
    result.rows.forEach((admin: any, index: number) => {
      if (index > 0) console.log('\n' + '-'.repeat(70));
      console.log(`Hostel: ${admin.hostel_name} (ID: ${admin.hostel_id})`);
      console.log(`Admin Name: ${admin.name}`);
      console.log(`Email: ${admin.email}`);
      console.log(`Username: ${admin.email} (email is used as username)`);
      console.log('\n⚠️  Password cannot be retrieved (it\'s hashed)');
      console.log('   You need to reset the password using the resend-credentials endpoint');
      console.log('   Or check the server logs when the hostel was created');
    });
    
    console.log('='.repeat(70));
    console.log('\n💡 To reset password and send new credentials:');
    console.log('   POST /api/hostels/:hostel_id/resend-credentials');
    console.log('   (Requires super_admin authentication)\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Get arguments from command line
const args = process.argv.slice(2);
const hostelIdArg = args.find(arg => arg.startsWith('--hostel-id='));
const emailArg = args.find(arg => arg.startsWith('--email='));

const hostelId = hostelIdArg ? parseInt(hostelIdArg.split('=')[1]) : undefined;
const adminEmail = emailArg ? emailArg.split('=')[1] : undefined;

getHostelAdminCredentials(hostelId, adminEmail);











































