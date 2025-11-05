import { runMigrations } from './migrations';
import setupSuperAdmin from './setup-super-admin';

/**
 * Initialize the database by running migrations and setting up the super admin
 */
export async function initializeDatabase(): Promise<void> {
  try {
    console.log('🔧 Initializing database...');
    
    // Run migrations to create/update database schema
    await runMigrations();
    
    // Setup super admin user
    await setupSuperAdmin();
    
    console.log('✅ Database initialization completed successfully!');
    
  } catch (error: any) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

export default initializeDatabase;
