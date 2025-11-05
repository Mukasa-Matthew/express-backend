import pool from '../config/database';
import fs from 'fs';
import path from 'path';

async function migrateMultiTenant() {
  try {
    console.log('Starting multi-tenant migration...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, '../../src/database/multi-tenant-schema.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    await pool.query('BEGIN');
    
    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        await pool.query(statement);
      }
    }
    
    await pool.query('COMMIT');
    console.log('✅ Multi-tenant migration completed successfully!');
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Multi-tenant migration failed:', error);
  } finally {
    await pool.end();
    console.log('Migration completed');
  }
}

migrateMultiTenant();
