// Quick setup script for fresh database
// Run: node setup-database.js

const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Setting up database with Prisma migrations...\n');

try {
  // Change to backend directory
  process.chdir(__dirname);

  console.log('📋 Step 1: Generating Prisma Client...');
  execSync('npx prisma generate', { stdio: 'inherit' });

  console.log('\n📋 Step 2: Creating initial migration...');
  try {
    execSync('npx prisma migrate dev --name init', { stdio: 'inherit' });
  } catch (error) {
    console.log('⚠️  Migration creation may have failed. Trying to apply existing migrations...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  }

  console.log('\n✅ Database setup complete!');
  console.log('📋 Next step: Start your server with "npm run dev"');
  
} catch (error) {
  console.error('\n❌ Setup failed:', error.message);
  console.log('\n📋 Manual steps:');
  console.log('   1. Run: npx prisma migrate dev --name init');
  console.log('   2. Run: npm run dev');
  process.exit(1);
}





