import pool from '../config/database';

/**
 * Reset a specific migration by removing it from schema_migrations table
 */
async function resetMigration(migrationName: string): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM schema_migrations WHERE migration_name = $1',
      [migrationName]
    );
    
    if (result.rowCount && result.rowCount > 0) {
      console.log(`✅ Reset migration: ${migrationName}`);
    } else {
      console.log(`ℹ️  Migration ${migrationName} was not found in schema_migrations`);
    }
  } catch (error: any) {
    console.error(`❌ Failed to reset migration ${migrationName}:`, error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Run if executed directly
if (require.main === module) {
  const migrationName = process.argv[2];
  
  if (!migrationName) {
    console.error('Usage: ts-node reset-migration.ts <migration-name>');
    console.error('Example: ts-node reset-migration.ts 0001-initial-schema');
    process.exit(1);
  }
  
  resetMigration(migrationName)
    .then(() => {
      console.log('✅ Migration reset completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration reset failed:', error);
      process.exit(1);
    });
}

export default resetMigration;




















