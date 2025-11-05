import pool from '../config/database';

async function removeDefaultPlans() {
  try {
    console.log('Removing default subscription plans...');

    // List of default plan names to remove
    const defaultPlanNames = [
      'Semester Plan',
      'Half Year Plan',
      'Full Year Plan'
    ];

    for (const planName of defaultPlanNames) {
      const result = await pool.query(
        'DELETE FROM subscription_plans WHERE name = $1',
        [planName]
      );
      
      if (result.rowCount && result.rowCount > 0) {
        console.log(`✓ Removed: ${planName}`);
      } else {
        console.log(`- Not found: ${planName}`);
      }
    }

    console.log('✅ Default subscription plans removed successfully');
  } catch (error) {
    console.error('❌ Error removing default subscription plans:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Execute the cleanup
removeDefaultPlans()
  .then(() => {
    console.log('Cleanup completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });

