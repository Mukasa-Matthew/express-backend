import pool from '../config/database';
import fs from 'fs';
import path from 'path';

async function setupDatabase() {
  try {
    console.log('Setting up database...');
    
    // Read and execute schema from source directory
    const schemaPath = path.join(__dirname, '../../src/database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = schema.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        await pool.query(statement);
        console.log('✓ Executed:', statement.substring(0, 50) + '...');
      }
    }
    
    console.log('✅ Database setup completed successfully!');
    
    // Test the connection
    const result = await pool.query('SELECT COUNT(*) FROM users');
    console.log(`📊 Users in database: ${result.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupDatabase()
    .then(() => {
      console.log('Setup completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Setup failed:', error);
      process.exit(1);
    });
}

export default setupDatabase;
