import pool from '../config/database';

async function addProfilePictureColumn() {
  try {
    console.log('Adding profile_picture column to users table...');
    
    // Check if column already exists
    const checkQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'profile_picture'
    `;
    
    const checkResult = await pool.query(checkQuery);
    
    if (checkResult.rows.length === 0) {
      // Add the column
      const alterQuery = `
        ALTER TABLE users 
        ADD COLUMN profile_picture VARCHAR(255) NULL
      `;
      
      await pool.query(alterQuery);
      console.log('✅ profile_picture column added successfully');
    } else {
      console.log('✅ profile_picture column already exists');
    }
    
  } catch (error) {
    console.error('❌ Error adding profile_picture column:', error);
    throw error;
  }
}

// Run the migration
addProfilePictureColumn()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
