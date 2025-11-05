import fs from 'fs';
import path from 'path';
import pool from '../config/database';

async function migrateAdminHostelRelationship() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting admin-hostel relationship migration...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'update-admin-hostel-relationship.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await client.query(statement);
          console.log(`✅ Executed: ${statement.substring(0, 50)}...`);
        } catch (error: any) {
          // Ignore errors for constraints that don't exist
          if (error.code === '42703' || error.code === '42P01') {
            console.log(`⚠️  Skipped (constraint/index doesn't exist): ${statement.substring(0, 50)}...`);
          } else {
            console.error(`❌ Error executing statement: ${statement}`);
            console.error(error.message);
          }
        }
      }
    }
    
    console.log('✅ Admin-hostel relationship migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateAdminHostelRelationship()
    .then(() => {
      console.log('🎉 Migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

export default migrateAdminHostelRelationship;
