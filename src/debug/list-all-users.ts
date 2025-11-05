import pool from '../config/database';

async function listAllUsers() {
  const client = await pool.connect();
  
  try {
    console.log('📋 Listing all users in database...\n');
    
    const result = await client.query(
      'SELECT id, email, name, role, hostel_id, created_at FROM users ORDER BY created_at DESC'
    );
    
    console.log(`Found ${result.rows.length} users:\n`);
    
    if (result.rows.length === 0) {
      console.log('No users found in database.');
      return;
    }
    
    result.rows.forEach((user: any, index: number) => {
      console.log(`${index + 1}. ${user.email}`);
      console.log(`   Name: ${user.name}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Hostel ID: ${user.hostel_id || 'N/A'}`);
      console.log(`   Created: ${user.created_at}`);
      console.log('');
    });
    
    // Group by role
    const byRole: { [key: string]: number } = {};
    result.rows.forEach((user: any) => {
      byRole[user.role] = (byRole[user.role] || 0) + 1;
    });
    
    console.log('\n📊 Users by role:');
    Object.entries(byRole).forEach(([role, count]) => {
      console.log(`   ${role}: ${count}`);
    });
    
  } catch (error) {
    console.error('❌ Error listing users:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  listAllUsers()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Failed:', error);
      process.exit(1);
    });
}

export default listAllUsers;

