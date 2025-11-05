import pool from '../config/database';

async function addInventoryMigration() {
  try {
    console.log('Creating inventory_items table...');
    
    await pool.query(`
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
      );
    `);

    // Create indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_inventory_items_hostel_id ON inventory_items(hostel_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_inventory_items_status ON inventory_items(status);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);');

    console.log('✅ Inventory items table created successfully');
  } catch (error) {
    console.error('❌ Error creating inventory_items table:', error);
    throw error;
  }
  // Note: Don't close the pool if the server is running
}

// Run if this file is executed directly
if (require.main === module) {
  addInventoryMigration()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

export default addInventoryMigration;



