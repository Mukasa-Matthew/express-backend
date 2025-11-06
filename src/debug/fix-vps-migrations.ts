import pool from '../config/database';
import fs from 'fs';
import path from 'path';

/**
 * Fix migration state on VPS when database already has schema
 * This marks all migrations as applied without running them
 */
async function fixVPSMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔧 Fixing VPS migration state...\n');

    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64),
        execution_time_ms INTEGER
      )
    `);

    // Get migrations directory
    const migrationsDir = path.join(__dirname, '../database/migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      console.log('❌ Migrations directory not found:', migrationsDir);
      return;
    }

    // Get all migration files
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => (file.endsWith('.ts') || file.endsWith('.sql')) && file.startsWith('0'))
      .sort();

    console.log(`📋 Found ${migrationFiles.length} migration file(s)\n`);

    // Check which migrations are already recorded
    const appliedMigrations = await client.query(`
      SELECT migration_name FROM schema_migrations
    `);
    const appliedNames = appliedMigrations.rows.map((r: any) => r.migration_name);

    // Mark migrations as applied
    let markedCount = 0;
    for (const file of migrationFiles) {
      const migrationName = path.basename(file, path.extname(file));
      
      if (!appliedNames.includes(migrationName)) {
        const migrationPath = path.join(migrationsDir, file);
        
        // Calculate checksum from file content
        let checksum = 'manual-fix';
        try {
          const migrationCode = fs.readFileSync(migrationPath, 'utf8');
          const crypto = require('crypto');
          checksum = crypto.createHash('sha256').update(migrationCode).digest('hex');
        } catch (error) {
          console.log(`   ⚠️  Could not read ${migrationName} for checksum, using placeholder`);
        }
        
        // Mark as applied with current timestamp
        await client.query(`
          INSERT INTO schema_migrations (migration_name, checksum, execution_time_ms)
          VALUES ($1, $2, $3)
          ON CONFLICT (migration_name) DO NOTHING
        `, [migrationName, checksum, 0]);
        
        console.log(`   ✅ Marked ${migrationName} as applied`);
        markedCount++;
      } else {
        console.log(`   ⏭️  ${migrationName} already recorded`);
      }
    }

    console.log(`\n✅ Marked ${markedCount} migration(s) as applied`);
    console.log('   Next time migrations run, they will be skipped.\n');
    console.log('💡 You can now run "npm run migrate" without errors.\n');

  } catch (error: any) {
    console.error('❌ Error fixing migration state:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  fixVPSMigrations()
    .then(() => {
      console.log('✅ Fix complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Failed:', error);
      process.exit(1);
    });
}

export default fixVPSMigrations;




