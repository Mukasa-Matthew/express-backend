import pool from '../src/config/database';

async function deleteUserByEmail(email: string) {
  const client = await pool.connect();
  try {
    console.log(`🔍 Looking for user with email: ${email}`);
    
    // Find user by email
    const userResult = await client.query(
      'SELECT id, name, email, role, hostel_id FROM users WHERE email = $1',
      [email]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ User not found with this email');
      return;
    }

    const user = userResult.rows[0];
    console.log(`📋 Found user: ${user.name} (ID: ${user.id}, Role: ${user.role})`);

    await client.query('BEGIN');

    // Delete from custodians table if exists
    const custodianResult = await client.query(
      'DELETE FROM custodians WHERE user_id = $1 RETURNING id',
      [user.id]
    );
    if (custodianResult.rowCount && custodianResult.rowCount > 0) {
      console.log(`✅ Deleted from custodians table`);
    }

    // Delete from users table
    await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    console.log(`✅ Deleted user from users table`);

    await client.query('COMMIT');
    console.log(`✅ Successfully deleted user ${user.name} (${email})`);
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Error deleting user:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Get email from command line arguments
const email = process.argv[2];

if (!email) {
  console.error('❌ Please provide an email address');
  console.log('Usage: npm run delete-user <email>');
  console.log('Example: npm run delete-user samanthakabeho@gmail.com');
  process.exit(1);
}

deleteUserByEmail(email)
  .then(() => {
    console.log('✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });

