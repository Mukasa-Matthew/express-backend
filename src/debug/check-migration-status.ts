import pool from '../config/database';

/**
 * Check the status of migrations vs database schema
 */
async function checkMigrationStatus() {
  const client = await pool.connect();
  try {
    console.log('🔍 Checking migration status...\n');

    // Check if schema_migrations table exists
    const migrationsTableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'schema_migrations'
      )
    `);

    if (!migrationsTableExists.rows[0].exists) {
      console.log('❌ schema_migrations table does not exist!');
      console.log('   Run migrations first to create it.\n');
      return;
    }

    // Get all applied migrations
    const appliedMigrations = await client.query(`
      SELECT migration_name, applied_at 
      FROM schema_migrations 
      ORDER BY applied_at
    `);

    console.log('📋 Applied Migrations:');
    if (appliedMigrations.rows.length === 0) {
      console.log('   ⚠️  No migrations have been recorded as applied\n');
    } else {
      appliedMigrations.rows.forEach((row: any) => {
        console.log(`   ✅ ${row.migration_name} (applied at: ${row.applied_at})`);
      });
      console.log('');
    }

    // Check for common tables
    console.log('🗄️  Database Tables Status:');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const commonTables = ['users', 'hostels', 'subscription_plans', 'students', 'payments', 'rooms'];
    const existingTables = tables.rows.map((r: any) => r.table_name);

    commonTables.forEach(table => {
      if (existingTables.includes(table)) {
        console.log(`   ✅ ${table} - EXISTS`);
      } else {
        console.log(`   ❌ ${table} - MISSING`);
      }
    });

    console.log('\n📊 Total tables in database:', existingTables.length);
    console.log('📋 Total migrations applied:', appliedMigrations.rows.length);

    // Check if migrations table exists but no migrations are recorded
    if (appliedMigrations.rows.length === 0 && existingTables.length > 0) {
      console.log('\n⚠️  WARNING: Database has tables but no migrations are recorded!');
      console.log('   This means migrations were run manually or from another system.');
      console.log('   You may need to manually mark migrations as applied.\n');
    }

  } catch (error: any) {
    console.error('❌ Error checking migration status:', error.message);
  } finally {
    client.release();
  }
}

// Run if executed directly
if (require.main === module) {
  checkMigrationStatus()
    .then(() => {
      console.log('\n✅ Check complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Failed:', error);
      process.exit(1);
    });
}

export default checkMigrationStatus;




