import pool from '../config/database';

async function addExpensesMigration() {
  try {
    console.log('Creating expenses table...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(12, 2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'UGX',
        category VARCHAR(100),
        description TEXT,
        spent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_expenses_hostel_id ON expenses(hostel_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_expenses_spent_at ON expenses(spent_at);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);');

    console.log('✅ Expenses table created successfully');
  } catch (error) {
    console.error('❌ Error creating expenses table:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Execute the migration
addExpensesMigration()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

