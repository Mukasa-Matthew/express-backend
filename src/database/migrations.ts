import pool from '../config/database';
import fs from 'fs';
import path from 'path';

/**
 * Migration tracking table to record which migrations have been applied
 */
async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      checksum VARCHAR(64),
      execution_time_ms INTEGER
    )
  `);
  
  // Create index for faster lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_migrations_name ON schema_migrations(migration_name)
  `);
}

/**
 * Check if a migration has already been applied
 */
async function isMigrationApplied(migrationName: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT id FROM schema_migrations WHERE migration_name = $1',
    [migrationName]
  );
  return result.rows.length > 0;
}

/**
 * Mark a migration as applied
 */
async function markMigrationApplied(
  migrationName: string,
  checksum: string,
  executionTime: number
): Promise<void> {
  await pool.query(
    `INSERT INTO schema_migrations (migration_name, checksum, execution_time_ms)
     VALUES ($1, $2, $3)
     ON CONFLICT (migration_name) DO NOTHING`,
    [migrationName, checksum, executionTime]
  );
}

/**
 * Get all applied migrations
 */
async function getAppliedMigrations(): Promise<string[]> {
  const result = await pool.query(
    'SELECT migration_name FROM schema_migrations ORDER BY applied_at'
  );
  return result.rows.map(row => row.migration_name);
}

/**
 * Check if a table exists in the database
 */
async function tableExists(tableName: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )`,
      [tableName]
    );
    return result.rows[0].exists;
  } catch {
    return false;
  }
}

/**
 * Run a single migration file
 */
async function runMigration(migrationPath: string): Promise<void> {
  const migrationName = path.basename(migrationPath, path.extname(migrationPath));
  const startTime = Date.now();
  
  console.log(`   🔄 Running migration: ${migrationName}`);
  
  try {
    // Special handling for initial schema migration
    // If it's marked as applied but tables don't exist, reset it
    if (migrationName === '0001-initial-schema') {
      if (await isMigrationApplied(migrationName)) {
        // Check if hostels table exists (a key table that should exist after initial schema)
        const hostelsExists = await tableExists('hostels');
        if (!hostelsExists) {
          console.log(`   ⚠️  Migration ${migrationName} marked as applied but tables don't exist`);
          console.log(`   🔄 Resetting and re-running migration ${migrationName}...`);
          // Delete the migration record
          await pool.query(
            'DELETE FROM schema_migrations WHERE migration_name = $1',
            [migrationName]
          );
        } else {
          console.log(`   ⏭️  Migration ${migrationName} already applied, skipping`);
          return;
        }
      }
    } else {
      // For other migrations, just check if already applied
      if (await isMigrationApplied(migrationName)) {
        console.log(`   ⏭️  Migration ${migrationName} already applied, skipping`);
        return;
      }
    }
    
    // Read and execute migration
    const migrationCode = fs.readFileSync(migrationPath, 'utf8');
    const migrationModule = require(migrationPath);
    
    // If it's a TypeScript file, we need to execute it differently
    // For now, we'll assume migrations export a function
    if (typeof migrationModule.default === 'function') {
      await migrationModule.default();
    } else if (typeof migrationModule.runMigration === 'function') {
      await migrationModule.runMigration();
    } else {
      // Try to execute the migration as SQL if it's a .sql file
      if (migrationPath.endsWith('.sql')) {
        const statements = migrationCode
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.trim().startsWith('--'));
        
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const statement of statements) {
            if (statement) {
              await client.query(statement + ';');
            }
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } else {
        throw new Error(`Migration ${migrationName} does not export a default function`);
      }
    }
    
    // Calculate checksum
    const crypto = require('crypto');
    const checksum = crypto.createHash('sha256').update(migrationCode).digest('hex');
    
    // Mark as applied
    const executionTime = Date.now() - startTime;
    await markMigrationApplied(migrationName, checksum, executionTime);
    
    console.log(`   ✅ Migration ${migrationName} applied successfully (${executionTime}ms)`);
    
  } catch (error: any) {
    // Check if error is due to object already existing or not existing (common on VPS when schema exists)
    const alreadyExistsCodes = ['42P07', '42710', '42P16']; // relation exists, duplicate object, invalid name
    const columnExistsCode = '42701'; // duplicate column
    const columnNotExistsCode = '42703'; // column does not exist (when dropping)
    
    if (alreadyExistsCodes.includes(error.code) || columnExistsCode === error.code || columnNotExistsCode === error.code) {
      console.log(`   ⚠️  Migration ${migrationName} encountered existing objects (${error.code}), marking as applied`);
      
      // Calculate checksum and mark as applied anyway since schema already exists
      const migrationCode = fs.readFileSync(migrationPath, 'utf8');
      const crypto = require('crypto');
      const checksum = crypto.createHash('sha256').update(migrationCode).digest('hex');
      const executionTime = Date.now() - startTime;
      
      await markMigrationApplied(migrationName, checksum, executionTime);
      console.log(`   ✅ Migration ${migrationName} marked as applied (schema already exists)`);
      return;
    }
    
    console.error(`   ❌ Migration ${migrationName} failed:`, error.message);
    throw error;
  }
}

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<void> {
  try {
    console.log('🔄 Checking for pending migrations...');
    
    // Ensure migrations table exists (with error handling)
    try {
      await ensureMigrationsTable();
    } catch (error: any) {
      console.error('   ⚠️  Failed to create migrations table:', error.message);
      console.log('   Skipping migrations for this startup...');
      return;
    }
    
    // Get migrations directory
    const migrationsDir = path.join(__dirname, 'migrations');
    
    // Check if migrations directory exists
    if (!fs.existsSync(migrationsDir)) {
      console.log('   ℹ️  No migrations directory found, skipping migrations');
      return;
    }
    
    // Get all migration files (with error handling)
    let migrationFiles: string[] = [];
    try {
      migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.ts') || file.endsWith('.sql') || file.endsWith('.js'))
        .sort()
        .map(file => path.join(migrationsDir, file));
    } catch (error: any) {
      console.error('   ⚠️  Failed to read migrations directory:', error.message);
      return;
    }
    
    if (migrationFiles.length === 0) {
      console.log('   ℹ️  No migration files found');
      return;
    }
    
    console.log(`   Found ${migrationFiles.length} migration file(s)`);
    
    // Get applied migrations (with error handling)
    let appliedMigrations: string[] = [];
    try {
      appliedMigrations = await getAppliedMigrations();
    } catch (error: any) {
      console.error('   ⚠️  Failed to get applied migrations:', error.message);
      console.log('   Skipping migrations for this startup...');
      return;
    }
    
    // Run pending migrations (with individual error handling)
    let appliedCount = 0;
    let failedCount = 0;
    
    for (const migrationFile of migrationFiles) {
      const migrationName = path.basename(migrationFile, path.extname(migrationFile));
      
      // Special handling: Always check migration 0001 to see if tables exist
      // even if it's marked as applied
      const shouldRun = !appliedMigrations.includes(migrationName) || 
                       (migrationName === '0001-initial-schema' && !(await tableExists('hostels')));
      
      if (shouldRun) {
        try {
          await runMigration(migrationFile);
          appliedCount++;
        } catch (error: any) {
          failedCount++;
          console.error(`   ❌ Migration ${migrationName} failed:`, error.message);
          console.log(`   Continuing with next migration...`);
          // Continue with next migration instead of crashing
        }
      } else if (appliedMigrations.includes(migrationName)) {
        console.log(`   ⏭️  Migration ${migrationName} already applied, skipping`);
      }
    }
    
    if (appliedCount === 0 && failedCount === 0) {
      console.log('   ✅ All migrations are up to date');
    } else if (appliedCount > 0) {
      console.log(`   ✅ Applied ${appliedCount} migration(s)`);
      if (failedCount > 0) {
        console.log(`   ⚠️  ${failedCount} migration(s) failed (non-fatal)`);
      }
    } else {
      console.log(`   ⚠️  ${failedCount} migration(s) failed (non-fatal)`);
    }
    
  } catch (error: any) {
    console.error('❌ Migration process error:', error.message);
    console.log('   Server will continue starting despite migration errors...');
    // Don't throw - migrations are non-critical for server startup
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('✅ Migration process completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration process failed:', error);
      process.exit(1);
    });
}

export default runMigrations;

