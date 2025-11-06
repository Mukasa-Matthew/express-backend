import prisma from '../lib/prisma';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Initialize the database using Prisma migrations and setup super admin
 */
export async function initializeDatabase(): Promise<void> {
  try {
    console.log('🔧 Initializing database with Prisma...');
    
    // Test database connection
    await prisma.$connect();
    console.log('✅ Connected to PostgreSQL database via Prisma');
    
    // Run Prisma migrations (they should be run via CLI: npx prisma migrate deploy)
    // But we can check if we need to run them
    try {
      // Check if we can query the database
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ Database connection verified');
    } catch (error) {
      console.warn('⚠️  Database connection issue - ensure migrations are run');
      throw error;
    }
    
    // Setup super admin user
    await setupSuperAdmin();
    
    console.log('✅ Database initialization completed successfully!');
    
  } catch (error: any) {
    console.error('❌ Database initialization failed:', error);
    throw error;
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
    } else {
      console.error('❌ Failed to create super admin:', error);
      throw error;
    }
  }
}

export default initializeDatabase;

