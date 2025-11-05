import pool from '../config/database';

async function deleteAllAdminsAndCustodians() {
  const client = await pool.connect();
  
  try {
    console.log('🗑️  Starting deletion of all hostel admins and custodians...');
    
    await client.query('BEGIN');

    // Get all custodians
    const custodiansResult = await client.query(
      'SELECT c.id, c.user_id, u.email, u.name FROM custodians c JOIN users u ON u.id = c.user_id'
    );
    
    console.log(`📋 Found ${custodiansResult.rows.length} custodians:`);
    custodiansResult.rows.forEach((row: any) => {
      console.log(`   - ${row.email} (${row.name})`);
    });

    // Get all hostel admins
    const adminsResult = await client.query(
      "SELECT id, email, name, hostel_id FROM users WHERE role = 'hostel_admin'"
    );
    
    console.log(`📋 Found ${adminsResult.rows.length} hostel admins:`);
    adminsResult.rows.forEach((row: any) => {
      console.log(`   - ${row.email} (${row.name}) - Hostel ID: ${row.hostel_id || 'N/A'}`);
    });

    // Delete custodian users first
    let deletedCustodians = 0;
    for (const row of custodiansResult.rows) {
      await client.query('DELETE FROM users WHERE id = $1', [row.user_id]);
      deletedCustodians++;
      console.log(`   ✓ Deleted custodian user: ${row.email}`);
    }

    // Delete custodians table entries (should be handled by CASCADE, but let's be explicit)
    await client.query('DELETE FROM custodians');
    console.log(`   ✓ Deleted ${custodiansResult.rows.length} custodian records`);

    // Delete hostel admin users
    let deletedAdmins = 0;
    for (const row of adminsResult.rows) {
      await client.query('DELETE FROM users WHERE id = $1', [row.id]);
      deletedAdmins++;
      console.log(`   ✓ Deleted hostel admin: ${row.email}`);
    }

    await client.query('COMMIT');

    console.log('\n✅ Successfully deleted:');
    console.log(`   - ${deletedCustodians} custodian users`);
    console.log(`   - ${deletedAdmins} hostel admin users`);
    console.log('✅ Transaction committed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error deleting admins and custodians:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  deleteAllAdminsAndCustodians()
    .then(() => {
      console.log('\n🎉 Cleanup completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Cleanup failed:', error);
      process.exit(1);
    });
}

export default deleteAllAdminsAndCustodians;

