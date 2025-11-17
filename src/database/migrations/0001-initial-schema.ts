/**
 * Initial schema migration
 * Creates all base tables from create-all-tables.sql
 */
import createAllTables from '../run-create-all-tables';

export default async function runMigration() {
  console.log('Creating initial schema tables...');
  
  // Actually create all tables to ensure they exist
  // This is necessary when running migrations directly (not on server startup)
  await createAllTables();
  
  console.log('Initial schema migration completed');
}

