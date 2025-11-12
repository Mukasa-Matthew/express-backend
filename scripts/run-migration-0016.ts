/**
 * Quick script to run migration 0016-extend-public-bookings
 * This creates the public_hostel_bookings table if it doesn't exist
 */

import { runMigrations } from '../src/database/migrations';

async function main() {
  try {
    console.log('🔄 Running migration 0016-extend-public-bookings...');
    await runMigrations();
    console.log('✅ Migration completed successfully!');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

main();

