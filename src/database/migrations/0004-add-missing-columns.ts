import pool from '../../config/database';

/**
 * Migration to add missing columns:
 * - is_active to subscription_plans
 * - current_subscription_id to hostels
 * - Fix subscription_plans schema if needed
 */
export default async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Adding missing columns to subscription_plans and hostels...');
    
    await client.query('BEGIN');
    
    // Add is_active to subscription_plans if it doesn't exist
    await client.query(`
      ALTER TABLE subscription_plans 
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true
    `);
    
    // Update existing plans to be active if they don't have the column set
    await client.query(`
      UPDATE subscription_plans 
      SET is_active = true 
      WHERE is_active IS NULL
    `);
    
    // Add price_per_month and total_price if they don't exist (for older schemas)
    await client.query(`
      ALTER TABLE subscription_plans 
      ADD COLUMN IF NOT EXISTS price_per_month DECIMAL(10, 2),
      ADD COLUMN IF NOT EXISTS total_price DECIMAL(10, 2)
    `);
    
    // If price column exists but price_per_month doesn't, migrate data
    try {
      const checkPrice = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'subscription_plans' AND column_name = 'price'
      `);
      
      if (checkPrice.rows.length > 0) {
        // Migrate price to price_per_month if price_per_month is null
        await client.query(`
          UPDATE subscription_plans 
          SET price_per_month = price 
          WHERE price_per_month IS NULL AND price IS NOT NULL
        `);
        
        // Calculate total_price if not set
        await client.query(`
          UPDATE subscription_plans 
          SET total_price = price_per_month * duration_months 
          WHERE total_price IS NULL AND price_per_month IS NOT NULL AND duration_months IS NOT NULL
        `);
      }
    } catch (error: any) {
      // Price column might not exist, that's okay
      console.log('   Note: No price column migration needed');
    }
    
    // Add current_subscription_id to hostels if it doesn't exist
    await client.query(`
      ALTER TABLE hostels 
      ADD COLUMN IF NOT EXISTS current_subscription_id INTEGER
    `);
    
    // Add foreign key constraint if it doesn't exist
    try {
      await client.query(`
        ALTER TABLE hostels 
        ADD CONSTRAINT fk_hostels_current_subscription 
        FOREIGN KEY (current_subscription_id) REFERENCES hostel_subscriptions(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      // Constraint might already exist, that's okay
      if (error.code !== '42710' && error.code !== '42P16') {
        throw error;
      }
    }
    
    // Create index for current_subscription_id
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hostels_current_subscription_id 
      ON hostels(current_subscription_id) 
      WHERE current_subscription_id IS NOT NULL
    `);
    
    // Add missing columns to hostel_subscriptions table
    await client.query(`
      ALTER TABLE hostel_subscriptions 
      ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
      ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100)
    `);
    
    // Update existing subscriptions to have amount_paid = 0 if null
    await client.query(`
      UPDATE hostel_subscriptions 
      SET amount_paid = 0 
      WHERE amount_paid IS NULL
    `);
    
    await client.query('COMMIT');
    console.log('✅ Missing columns migration completed');
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Missing columns migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

