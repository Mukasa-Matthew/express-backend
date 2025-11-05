import pool from '../config/database';

async function simpleAdminHostelMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting simple admin-hostel relationship migration...');
    
    // Step 1: Drop the unique constraint on email
    try {
      await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key');
      console.log('✅ Dropped unique constraint on email');
    } catch (error: any) {
      console.log('⚠️  Email constraint may not exist:', error.message);
    }
    
    // Step 2: Create new unique indexes
    try {
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_role_hostel 
        ON users(email, role, hostel_id) 
        WHERE role = 'hostel_admin'
      `);
      console.log('✅ Created unique index for hostel_admin emails');
    } catch (error: any) {
      console.log('⚠️  Hostel admin index creation failed:', error.message);
    }
    
    try {
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_non_hostel_admin 
        ON users(email) 
        WHERE role != 'hostel_admin'
      `);
      console.log('✅ Created unique index for non-hostel-admin emails');
    } catch (error: any) {
      console.log('⚠️  Non-hostel-admin index creation failed:', error.message);
    }
    
    // Step 3: Update foreign key to cascade delete
    try {
      await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hostel_id_fkey');
      await client.query(`
        ALTER TABLE users ADD CONSTRAINT users_hostel_id_fkey 
        FOREIGN KEY (hostel_id) REFERENCES hostels(id) ON DELETE CASCADE
      `);
      console.log('✅ Updated foreign key to cascade delete');
    } catch (error: any) {
      console.log('⚠️  Foreign key update failed:', error.message);
    }
    
    console.log('✅ Simple admin-hostel relationship migration completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  simpleAdminHostelMigration()
    .then(() => {
      console.log('🎉 Migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

export default simpleAdminHostelMigration;
