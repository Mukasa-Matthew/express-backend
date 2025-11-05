import pool from '../config/database';

async function updateHostelConstraint() {
  try {
    console.log('Updating hostel status constraint...');
    
    // Drop the existing constraint
    await pool.query('ALTER TABLE hostels DROP CONSTRAINT IF EXISTS hostels_status_check');
    console.log('✓ Dropped existing constraint');
    
    // Add the new constraint with suspended status
    await pool.query(`
      ALTER TABLE hostels 
      ADD CONSTRAINT hostels_status_check 
      CHECK (status IN ('active', 'inactive', 'maintenance', 'suspended'))
    `);
    console.log('✓ Added new constraint with suspended status');
    
    console.log('✅ Constraint update completed successfully!');
    
  } catch (error) {
    console.error('❌ Constraint update failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run update if this file is executed directly
if (require.main === module) {
  updateHostelConstraint()
    .then(() => {
      console.log('Constraint update completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Constraint update failed:', error);
      process.exit(1);
    });
}

export default updateHostelConstraint;
