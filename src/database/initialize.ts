import prisma from '../lib/prisma';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Temporary pool connection for running SQL file if needed
const tempPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'lts_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

/**
 * Initialize the database using Prisma migrations and setup super admin
 * Falls back to SQL file if Prisma migrations haven't been run
 */
export async function initializeDatabase(): Promise<void> {
  try {
    console.log('🔧 Initializing database with Prisma...');
    
    // Test database connection
    await prisma.$connect();
    console.log('✅ Connected to PostgreSQL database via Prisma');
    
    // Check if database tables exist by trying to query a table
    let tablesExist = false;
    try {
      await prisma.$queryRaw`SELECT 1 FROM users LIMIT 1`;
      tablesExist = true;
      console.log('✅ Database tables exist');
    } catch (error: any) {
      if (error.code === 'P2021' || error.code === '42P01' || error.message?.includes('does not exist')) {
        console.log('⚠️  Database tables do not exist');
        console.log('📋 Creating tables from SQL file...');
        
        // Fallback: Create tables using SQL file
        await createTablesFromSQL();
        
        // Disconnect and reconnect Prisma to refresh schema cache
        await prisma.$disconnect();
        await prisma.$connect();
        console.log('✅ Prisma Client reconnected');
        
        // Verify tables exist now
        try {
          await prisma.$queryRaw`SELECT 1 FROM users LIMIT 1`;
          tablesExist = true;
          console.log('✅ Verified: Database tables now exist');
        } catch (verifyError: any) {
          throw new Error('Tables were created but verification failed. Please check database manually.');
        }
        
        // Mark Prisma migration as applied
        await markPrismaMigrationAsApplied();
        
        console.log('✅ Tables created successfully');
      } else {
        throw error;
      }
    }
    
    // Only setup super admin if tables exist
    if (tablesExist) {
      // Ensure database schema matches Prisma schema
      await ensureSchemaMatches();
      await setupSuperAdmin();
    }
    
    console.log('✅ Database initialization completed successfully!');
    
  } catch (error: any) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  }
}

/**
 * Create tables from SQL file as fallback
 */
async function createTablesFromSQL(): Promise<void> {
  const client = await tempPool.connect();
  try {
    // Find SQL file - check both compiled (dist) and source (src) locations
    let sqlPath: string;
    const compiledPath = path.join(__dirname, 'create-all-tables.sql');
    const sourcePath = path.join(__dirname, '../../src/database/create-all-tables.sql');
    const altPath = path.join(process.cwd(), 'src/database/create-all-tables.sql');
    
    if (fs.existsSync(compiledPath)) {
      sqlPath = compiledPath;
    } else if (fs.existsSync(sourcePath)) {
      sqlPath = sourcePath;
    } else if (fs.existsSync(altPath)) {
      sqlPath = altPath;
    } else {
      throw new Error(`SQL file not found. Checked:\n- ${compiledPath}\n- ${sourcePath}\n- ${altPath}`);
    }
    
    console.log(`📄 Reading SQL file from: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Remove single-line comments (-- ...) but keep SQL structure
    let cleanedSql = sql
      .split('\n')
      .map(line => {
        // Remove single-line comments, but preserve the line structure
        const commentIndex = line.indexOf('--');
        if (commentIndex >= 0) {
          const beforeComment = line.substring(0, commentIndex).trim();
          return beforeComment ? beforeComment : '';
        }
        return line.trim();
      })
      .filter(line => line.length > 0) // Remove empty lines
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
    
    // Split into individual statements (pg client doesn't support multi-statement queries)
    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 10); // Filter out very short fragments and empty statements
    
    console.log(`📝 Executing ${statements.length} SQL statements...`);
    
    let successCount = 0;
    let errorCount = 0;
    const criticalErrors: string[] = [];
    
    // Execute each statement individually
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        await client.query(statement);
        successCount++;
        if ((i + 1) % 10 === 0) {
          console.log(`   ... executed ${i + 1}/${statements.length} statements`);
        }
      } catch (err: any) {
        // Ignore "already exists" errors - these are expected
        if (err.code === '42P07' || err.code === '42710' || err.code === '42P16') {
          successCount++; // Already exists is OK
        } else if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          successCount++; // Also OK
        } else {
          errorCount++;
          // Track critical errors
          const errorMsg = `Statement ${i + 1}: ${err.message.substring(0, 100)}`;
          criticalErrors.push(errorMsg);
          if (criticalErrors.length <= 3) {
            // Only show first 3 errors to avoid spam
            console.warn(`⚠️  SQL Error (${err.code}): ${errorMsg}`);
          }
        }
      }
    }
    
    console.log(`✅ Executed ${successCount} statements successfully${errorCount > 0 ? `, ${errorCount} errors` : ''}`);
    
    // If we have too many critical errors, something is wrong
    if (errorCount > statements.length * 0.5) {
      throw new Error(`Too many SQL errors (${errorCount}/${statements.length}). First errors: ${criticalErrors.slice(0, 3).join('; ')}`);
    }
    
    // Verify tables were actually created by checking for users table
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    if (!result.rows[0]?.exists) {
      throw new Error('Tables were not created successfully. users table does not exist.');
    }
    
    console.log('✅ Verified: users table exists');
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Mark Prisma migration as applied (since tables already exist)
 */
async function markPrismaMigrationAsApplied(): Promise<void> {
  try {
    // Ensure _prisma_migrations table exists
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS _prisma_migrations (
        id VARCHAR(36) PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        finished_at TIMESTAMP,
        migration_name VARCHAR(255) NOT NULL,
        logs TEXT,
        rolled_back_at TIMESTAMP,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        applied_steps_count INTEGER NOT NULL DEFAULT 0
      )
    `;
    
    // Mark init migration as applied
    const migrationId = '0000000000000000';
    const migrationName = 'init';
    
    await prisma.$executeRaw`
      INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
      VALUES (${migrationId}, '', ${migrationName}, NOW(), 1)
      ON CONFLICT (id) DO NOTHING
    `;
    
    console.log('✅ Prisma migration marked as applied');
  } catch (error: any) {
    // If migration already marked, that's fine
    if (error.code !== '23505') {
      console.warn('⚠️  Could not mark migration as applied:', error.message);
    }
  }
}

/**
 * Ensure database schema matches Prisma schema by adding missing columns
 */
async function ensureSchemaMatches(): Promise<void> {
  try {
    console.log('🔍 Checking database schema compatibility...');
    
    // Check if university_id column exists in users table
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'users' 
      AND column_name = 'university_id'
    `;
    
    const result = await tempPool.query(checkColumnQuery);
    
    if (result.rows.length === 0) {
      console.log('📝 Adding missing university_id column to users table...');
      
      // Check if universities table exists first
      const universitiesTableCheck = await tempPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'universities'
        )
      `);
      
      if (universitiesTableCheck.rows[0]?.exists) {
        // Add university_id column with foreign key
        await tempPool.query(`
          ALTER TABLE users 
          ADD COLUMN IF NOT EXISTS university_id INTEGER REFERENCES universities(id)
        `);
        console.log('✅ Added university_id column to users table');
      } else {
        // Add university_id column without foreign key (universities table doesn't exist yet)
        await tempPool.query(`
          ALTER TABLE users 
          ADD COLUMN IF NOT EXISTS university_id INTEGER
        `);
        console.log('✅ Added university_id column to users table (without foreign key)');
      }
    } else {
      console.log('✅ university_id column already exists');
    }
    
    // Check for other potentially missing columns
    // Check username column
    const usernameCheck = await tempPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'users' 
      AND column_name = 'username'
    `);
    
    if (usernameCheck.rows.length === 0) {
      console.log('📝 Adding missing username column to users table...');
      await tempPool.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS username VARCHAR(100)
      `);
      // Add unique constraint separately
      try {
        await tempPool.query(`
          ALTER TABLE users 
          ADD CONSTRAINT users_username_unique UNIQUE (username)
        `);
      } catch (err: any) {
        // Constraint might already exist, ignore
        if (!err.message.includes('already exists')) {
          throw err;
        }
      }
      console.log('✅ Added username column to users table');
    }
    
    // Check profile_picture column
    const profilePictureCheck = await tempPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'users' 
      AND column_name = 'profile_picture'
    `);
    
    if (profilePictureCheck.rows.length === 0) {
      console.log('📝 Adding missing profile_picture column to users table...');
      await tempPool.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(500)
      `);
      console.log('✅ Added profile_picture column to users table');
    }
    
    console.log('✅ Database schema check completed');
  } catch (error: any) {
    console.warn('⚠️  Schema check warning:', error.message);
    // Don't throw - allow the app to continue even if schema check fails
  }
}

/**
 * Setup super admin user from environment variables
 */
async function setupSuperAdmin(): Promise<void> {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'matthewmukasa0@gmail.com';
  const superAdminName = process.env.SUPER_ADMIN_NAME || 'Matthew Mukasa';
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || '1100211Matt.';

  try {
    // First verify table exists
    try {
      await prisma.$queryRaw`SELECT 1 FROM users LIMIT 1`;
    } catch (verifyError: any) {
      if (verifyError.code === 'P2021' || verifyError.code === '42P01') {
        throw new Error('users table does not exist. Tables were not created properly.');
      }
      throw verifyError;
    }
    
    // Check if super admin already exists
    const existingAdmin = await prisma.user.findFirst({
      where: {
        email: superAdminEmail,
        role: 'super_admin',
      },
    });

    if (existingAdmin) {
      console.log('✅ Super Admin already exists');
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

    // Create super admin
    await prisma.user.create({
      data: {
        email: superAdminEmail,
        name: superAdminName,
        password: hashedPassword,
        role: 'super_admin',
      },
    });

    console.log('✅ Super Admin created successfully');
  } catch (error: any) {
    // If super admin already exists (unique constraint), that's fine
    if (error.code === 'P2002') {
      console.log('✅ Super Admin already exists');
    } else if (error.code === 'P2021' || error.code === '42P01') {
      // Table doesn't exist
      console.error('❌ Cannot create super admin: users table does not exist');
      throw new Error('Database tables do not exist. Please check SQL file execution.');
    } else {
      console.error('❌ Failed to create super admin:', error.message);
      throw error;
    }
  }
}

export default initializeDatabase;
