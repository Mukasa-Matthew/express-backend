import pool from '../config/database';

async function deleteAllNonSuperAdminUsers() {
  const client = await pool.connect();
  
  try {
    console.log('🗑️  Starting deletion of all non-super-admin users...');
    
    await client.query('BEGIN');

    // Get all users except super_admin
    const usersResult = await client.query(
      "SELECT id, email, name, role, hostel_id FROM users WHERE role != 'super_admin'"
    );
    
    console.log(`📋 Found ${usersResult.rows.length} non-super-admin users:`);
    usersResult.rows.forEach((row: any, index: number) => {
      console.log(`   ${index + 1}. ${row.email} (${row.name}) - Role: ${row.role} - Hostel ID: ${row.hostel_id || 'N/A'}`);
    });

    if (usersResult.rows.length === 0) {
      console.log('   No users to delete.');
      await client.query('COMMIT');
      return;
    }

    // Delete all custodians first (to avoid FK constraint issues)
    await client.query('DELETE FROM custodians');
    console.log('   ✓ Deleted all custodian records');

    // Delete all non-super-admin users
    let deletedCount = 0;
    for (const row of usersResult.rows) {
      await client.query('DELETE FROM users WHERE id = $1', [row.id]);
      deletedCount++;
      console.log(`   ✓ Deleted: ${row.email} (${row.role})`);
    }

    await client.query('COMMIT');

    console.log(`\n✅ Successfully deleted ${deletedCount} non-super-admin users`);
    console.log('✅ Transaction committed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error deleting users:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  deleteAllNonSuperAdminUsers()
    .then(() => {
      console.log('\n🎉 Cleanup completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Cleanup failed:', error);
      process.exit(1);
    });
}

export default deleteAllNonSuperAdminUsers;

