import pool from '../config/database';

async function checkUser() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking user in database...');
    
    // Check if user exists
    const userQuery = "SELECT id, email, name, role, hostel_id, created_at FROM users WHERE email = $1";
    const userResult = await client.query(userQuery, ['matthewkesh950@gmail.com']);
    
    if (userResult.rows.length === 0) {
      console.log('❌ User not found in database');
      return;
    }
    
    const user = userResult.rows[0];
    console.log('✅ User found:');
    console.log('   ID:', user.id);
    console.log('   Email:', user.email);
    console.log('   Name:', user.name);
    console.log('   Role:', user.role);
    console.log('   Hostel ID:', user.hostel_id);
    console.log('   Created:', user.created_at);
    
    // Check if hostel exists
    if (user.hostel_id) {
      const hostelQuery = "SELECT id, name, status FROM hostels WHERE id = $1";
      const hostelResult = await client.query(hostelQuery, [user.hostel_id]);
      
      if (hostelResult.rows.length > 0) {
        const hostel = hostelResult.rows[0];
        console.log('✅ Associated hostel:');
        console.log('   ID:', hostel.id);
        console.log('   Name:', hostel.name);
        console.log('   Status:', hostel.status);
      } else {
        console.log('❌ Associated hostel not found');
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking user:', error);
  } finally {
    client.release();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  checkUser()
    .then(() => {
      console.log('🎉 Check completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Check failed:', error);
      process.exit(1);
    });
}

export default checkUser;
