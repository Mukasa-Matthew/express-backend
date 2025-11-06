import pool from '../../config/database';

/**
 * Migration to create inventory_items table for tracking hostel inventory
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Creating inventory_items table...');
    
    await client.query('BEGIN');
    
    // Create inventory_items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id SERIAL PRIMARY KEY,
        hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        quantity INTEGER DEFAULT 0,
        unit VARCHAR(50),
        category VARCHAR(100),
        purchase_price DECIMAL(10,2),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'depleted', 'damaged', 'disposed')),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inventory_items_hostel_id ON inventory_items(hostel_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inventory_items_status ON inventory_items(status)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category)
    `);

    await client.query('COMMIT');
    console.log('✅ Inventory items table migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Inventory items table migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}



