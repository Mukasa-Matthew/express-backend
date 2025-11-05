import pool from '../config/database';

async function addCustodianStatusMigration() {
  try {
    console.log('Adding status column to custodians table...');
    
    await pool.query(`
      ALTER TABLE custodians 
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended'));
    `);

    console.log('✅ Status column added to custodians table successfully');
  } catch (error) {
    console.error('❌ Error adding status column to custodians:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Execute the migration
addCustodianStatusMigration()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

