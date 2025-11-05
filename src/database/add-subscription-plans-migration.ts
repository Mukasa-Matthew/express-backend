import pool from '../config/database';

async function addSubscriptionPlansMigration() {
  try {
    console.log('Adding subscription plans system...');

    // Create subscription_plans table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        duration_months INTEGER NOT NULL,
        price_per_month DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create hostel_subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hostel_subscriptions (
        id SERIAL PRIMARY KEY,
        hostel_id INTEGER REFERENCES hostels(id) ON DELETE CASCADE,
        plan_id INTEGER REFERENCES subscription_plans(id),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        amount_paid DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
        payment_method VARCHAR(50),
        payment_reference VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Add subscription_id to hostels table
    await pool.query(`
      ALTER TABLE hostels 
      ADD COLUMN IF NOT EXISTS current_subscription_id INTEGER REFERENCES hostel_subscriptions(id);
    `);

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hostel_subscriptions_hostel_id ON hostel_subscriptions(hostel_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hostel_subscriptions_status ON hostel_subscriptions(status);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hostel_subscriptions_end_date ON hostel_subscriptions(end_date);
    `);

    console.log('✅ Subscription plans system added successfully');
  } catch (error) {
    console.error('❌ Error adding subscription plans system:', error);
    throw error;
  }
}

// Execute the migration
addSubscriptionPlansMigration()
  .then(() => console.log('Migration completed successfully'))
  .catch((err) => console.error('Migration failed:', err));
