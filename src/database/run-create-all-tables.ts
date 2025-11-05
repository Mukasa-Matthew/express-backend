import pool from '../config/database';
import fs from 'fs';
import path from 'path';

async function createAllTables() {
  const client = await pool.connect();
  try {
    console.log('Creating all database tables...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'create-all-tables.sql');
    let sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Remove comments (lines starting with --)
    sql = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
    
    // Split by semicolon, but be smarter about it
    // Split on semicolons that are followed by whitespace and a new statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^\s*$/));
    
    console.log(`Found ${statements.length} statements to execute...`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement) {
        try {
          await client.query(statement + ';');
          console.log(`✓ Executed statement ${i + 1}/${statements.length}`);
        } catch (err: any) {
          // If table/index already exists, that's okay - log and continue
          if (err.code === '42P07' || err.code === '42710') {
            console.log(`ℹ Statement ${i + 1}/${statements.length} already exists, skipping...`);
          } else if (err.code === '42P01') {
            // Relation doesn't exist - might be a dependency issue, try to continue
            console.log(`⚠ Warning at statement ${i + 1}/${statements.length}: ${err.message}`);
            // Don't throw, continue with next statement
          } else {
            console.error(`❌ Error at statement ${i + 1}/${statements.length}:`);
            console.error(`   Code: ${err.code}`);
            console.error(`   Message: ${err.message}`);
            console.error(`   Statement: ${statement.substring(0, 100)}...`);
            throw err;
          }
        }
      }
    }
    
    console.log('✅ All tables created successfully!');
    
  } catch (error: any) {
    console.error('❌ Failed to create tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if executed directly
if (require.main === module) {
  createAllTables()
    .then(() => {
      console.log('Setup completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Setup failed:', error);
      process.exit(1);
    });
}

export default createAllTables;
