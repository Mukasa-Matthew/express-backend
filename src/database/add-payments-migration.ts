import pool from '../config/database';

async function addPaymentsMigration() {
  try {
    console.log('Creating payments table...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'UGX',
        purpose VARCHAR(100),
        payment_method VARCHAR(50),
        payment_reference VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_hostel_id ON payments(hostel_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
    `);

    console.log('✅ Payments table created successfully');
  } catch (error) {
    console.error('❌ Error creating payments table:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Execute the migration
addPaymentsMigration()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

