import pool from '../config/database';

async function checkHostels() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking hostels in database...');
    
    // Check all hostels
    const hostelsQuery = "SELECT id, name, status, created_at FROM hostels ORDER BY created_at DESC";
    const hostelsResult = await client.query(hostelsQuery);
    
    if (hostelsResult.rows.length === 0) {
      console.log('❌ No hostels found in database');
      return;
    }
    
    console.log(`✅ Found ${hostelsResult.rows.length} hostels:`);
    hostelsResult.rows.forEach((hostel, index) => {
      console.log(`   ${index + 1}. ID: ${hostel.id}, Name: ${hostel.name}, Status: ${hostel.status}, Created: ${hostel.created_at}`);
    });
    
    // Check users with hostel_id
    const usersQuery = "SELECT id, email, name, role, hostel_id FROM users WHERE hostel_id IS NOT NULL";
    const usersResult = await client.query(usersQuery);
    
    console.log(`\n🔍 Users with hostel_id: ${usersResult.rows.length}`);
    usersResult.rows.forEach((user, index) => {
      console.log(`   ${index + 1}. ID: ${user.id}, Email: ${user.email}, Name: ${user.name}, Role: ${user.role}, Hostel ID: ${user.hostel_id}`);
    });
    
  } catch (error) {
    console.error('❌ Error checking hostels:', error);
  } finally {
    client.release();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  checkHostels()
    .then(() => {
      console.log('🎉 Check completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Check failed:', error);
      process.exit(1);
    });
}

export default checkHostels;
