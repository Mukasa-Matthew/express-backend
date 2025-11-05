import pool from '../config/database';

export interface SubscriptionPlan {
  id: number;
  name: string;
  description: string;
  duration_months: number;
  price_per_month: number;
  total_price: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface HostelSubscription {
  id: number;
  hostel_id: number;
  plan_id: number;
  start_date: Date;
  end_date: Date;
  amount_paid: number;
  status: 'active' | 'expired' | 'cancelled';
  payment_method?: string;
  payment_reference?: string;
  created_at: Date;
  updated_at: Date;
}

export class SubscriptionPlanModel {
  static async findAll(): Promise<SubscriptionPlan[]> {
    const result = await pool.query(
      'SELECT * FROM subscription_plans WHERE is_active = true ORDER BY duration_months ASC'
    );
    return result.rows;
  }

  static async findById(id: number): Promise<SubscriptionPlan | null> {
    const result = await pool.query(
      'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true',
      [id]
    );
    return result.rows[0] || null;
  }

  static async create(plan: Omit<SubscriptionPlan, 'id' | 'created_at' | 'updated_at'>): Promise<SubscriptionPlan> {
    const result = await pool.query(
      `INSERT INTO subscription_plans (name, description, duration_months, price, price_per_month, total_price, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [plan.name, plan.description, plan.duration_months, plan.total_price, plan.price_per_month, plan.total_price, plan.is_active]
    );
    return result.rows[0];
  }

  static async update(id: number, updates: Partial<SubscriptionPlan>): Promise<SubscriptionPlan | null> {
    const fields = Object.keys(updates).filter(key => key !== 'id' && key !== 'created_at' && key !== 'updated_at');
    const values = fields.map(field => updates[field as keyof SubscriptionPlan]);
    
    // If total_price is being updated, also update price to match
    if (updates.total_price !== undefined && !fields.includes('price')) {
      fields.push('price');
      values.push(updates.total_price);
    }
    
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    
    if (fields.length === 0) return null;
    
    const result = await pool.query(
      `UPDATE subscription_plans SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    return result.rows[0] || null;
  }

  static async delete(id: number): Promise<boolean> {
    const result = await pool.query(
      'UPDATE subscription_plans SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );
    return (result.rowCount || 0) > 0;
  }
}

export class HostelSubscriptionModel {
  static async create(subscription: Omit<HostelSubscription, 'id' | 'created_at' | 'updated_at'>): Promise<HostelSubscription> {
    const result = await pool.query(
      `INSERT INTO hostel_subscriptions (hostel_id, plan_id, start_date, end_date, amount_paid, status, payment_method, payment_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [subscription.hostel_id, subscription.plan_id, subscription.start_date, subscription.end_date, 
       subscription.amount_paid, subscription.status, subscription.payment_method, subscription.payment_reference]
    );
    return result.rows[0];
  }

  static async findByHostelId(hostelId: number): Promise<HostelSubscription[]> {
    const result = await pool.query(
      `SELECT hs.*, sp.name as plan_name, sp.duration_months, sp.total_price
       FROM hostel_subscriptions hs
       JOIN subscription_plans sp ON hs.plan_id = sp.id
       WHERE hs.hostel_id = $1
       ORDER BY hs.created_at DESC`,
      [hostelId]
    );
    return result.rows;
  }

  static async findActiveByHostelId(hostelId: number): Promise<HostelSubscription | null> {
    const result = await pool.query(
      `SELECT hs.*, sp.name as plan_name, sp.duration_months, sp.total_price
       FROM hostel_subscriptions hs
       JOIN subscription_plans sp ON hs.plan_id = sp.id
       WHERE hs.hostel_id = $1 AND hs.status = 'active' AND hs.end_date > NOW()
       ORDER BY hs.end_date DESC
       LIMIT 1`,
      [hostelId]
    );
    return result.rows[0] || null;
  }

  static async updateStatus(id: number, status: 'active' | 'expired' | 'cancelled'): Promise<boolean> {
    const result = await pool.query(
      'UPDATE hostel_subscriptions SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, id]
    );
    return (result.rowCount || 0) > 0;
  }

  static async getExpiredSubscriptions(): Promise<HostelSubscription[]> {
    const result = await pool.query(
      `SELECT hs.*, sp.name as plan_name, h.name as hostel_name
       FROM hostel_subscriptions hs
       JOIN subscription_plans sp ON hs.plan_id = sp.id
       JOIN hostels h ON hs.hostel_id = h.id
       WHERE hs.status = 'active' AND hs.end_date < NOW()`
    );
    return result.rows;
  }
}
