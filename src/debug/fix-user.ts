import pool from '../config/database';

async function fixUser() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Fixing user issue...');
    
    // Delete the user without hostel_id (ID 4)
    const deleteQuery = "DELETE FROM users WHERE id = $1 AND hostel_id IS NULL";
    const deleteResult = await client.query(deleteQuery, [4]);
    
    if (deleteResult.rowCount && deleteResult.rowCount > 0) {
      console.log('✅ Deleted duplicate user without hostel_id');
    } else {
      console.log('⚠️  No duplicate user found to delete');
    }
    
    // Verify the correct user exists
    const userQuery = "SELECT id, email, name, role, hostel_id FROM users WHERE email = $1 AND hostel_id IS NOT NULL";
    const userResult = await client.query(userQuery, ['matthewkesh950@gmail.com']);
    
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      console.log('✅ Correct user found:');
      console.log('   ID:', user.id);
      console.log('   Email:', user.email);
      console.log('   Name:', user.name);
      console.log('   Role:', user.role);
      console.log('   Hostel ID:', user.hostel_id);
    } else {
      console.log('❌ No user with hostel_id found');
    }
    
  } catch (error) {
    console.error('❌ Error fixing user:', error);
  } finally {
    client.release();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  fixUser()
    .then(() => {
      console.log('🎉 Fix completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Fix failed:', error);
      process.exit(1);
    });
}

export default fixUser;
