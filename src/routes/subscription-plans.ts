import express from 'express';
import jwt from 'jsonwebtoken';
import { SubscriptionPlanModel, HostelSubscriptionModel } from '../models/SubscriptionPlan';
import { UserModel } from '../models/User';
import pool from '../config/database';

const router = express.Router();

// Helper function to verify token
function verifyToken(req: express.Request): any {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
  } catch {
    return null;
  }
}

// Get all subscription plans
router.get('/', async (req, res) => {
  try {
    const plans = await SubscriptionPlanModel.findAll();
    res.json({ success: true, plans });
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subscription plans' });
  }
});

// Get subscription plan by ID
router.get('/:id', async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    const plan = await SubscriptionPlanModel.findById(planId);
    
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Subscription plan not found' });
    }
    
    res.json({ success: true, plan });
  } catch (error) {
    console.error('Error fetching subscription plan:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subscription plan' });
  }
});

// Create new subscription plan (Super Admin only)
router.post('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { name, description, duration_months, price_per_month } = req.body;
    
    if (!name || !description || duration_months === undefined || price_per_month === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Validate and parse numbers
    const duration = Number(duration_months);
    const pricePerMonth = Number(price_per_month);

    if (isNaN(duration) || isNaN(pricePerMonth)) {
      return res.status(400).json({ success: false, message: 'Duration and price must be valid numbers' });
    }

    if (duration < 1) {
      return res.status(400).json({ success: false, message: 'Duration must be at least 1 month' });
    }

    if (pricePerMonth < 0) {
      return res.status(400).json({ success: false, message: 'Price per month must be 0 or greater' });
    }

    const total_price = duration * pricePerMonth;
    
    const plan = await SubscriptionPlanModel.create({
      name: name.trim(),
      description: description.trim(),
      duration_months: duration,
      price_per_month: pricePerMonth,
      total_price,
      is_active: true
    });

    res.status(201).json({ success: true, plan });
  } catch (error: any) {
    console.error('Error creating subscription plan:', error);
    
    // Handle database constraint violations
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: 'A subscription plan with this name already exists' });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create subscription plan' 
    });
  }
});

// Update subscription plan (Super Admin only)
router.put('/:id', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const planId = parseInt(req.params.id);
    const updates = req.body;
    
    // Recalculate total price if duration or price per month changes
    if (updates.duration_months || updates.price_per_month) {
      const existingPlan = await SubscriptionPlanModel.findById(planId);
      if (existingPlan) {
        const duration = updates.duration_months || existingPlan.duration_months;
        const pricePerMonth = updates.price_per_month || existingPlan.price_per_month;
        updates.total_price = duration * pricePerMonth;
      }
    }

    const plan = await SubscriptionPlanModel.update(planId, updates);
    
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Subscription plan not found' });
    }

    res.json({ success: true, plan });
  } catch (error) {
    console.error('Error updating subscription plan:', error);
    res.status(500).json({ success: false, message: 'Failed to update subscription plan' });
  }
});

// Delete subscription plan (Super Admin only)
router.delete('/:id', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const planId = parseInt(req.params.id);
    const success = await SubscriptionPlanModel.delete(planId);
    
    if (!success) {
      return res.status(404).json({ success: false, message: 'Subscription plan not found' });
    }

    res.json({ success: true, message: 'Subscription plan deleted successfully' });
  } catch (error) {
    console.error('Error deleting subscription plan:', error);
    res.status(500).json({ success: false, message: 'Failed to delete subscription plan' });
  }
});

// Get hostel subscriptions
router.get('/hostel/:hostelId', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const hostelId = parseInt(req.params.hostelId);
    const subscriptions = await HostelSubscriptionModel.findByHostelId(hostelId);
    
    res.json({ success: true, subscriptions });
  } catch (error) {
    console.error('Error fetching hostel subscriptions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch hostel subscriptions' });
  }
});

// Create hostel subscription
router.post('/hostel/:hostelId/subscribe', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const hostelId = parseInt(req.params.hostelId);
    const { plan_id, payment_method, payment_reference } = req.body;
    
    if (!plan_id) {
      return res.status(400).json({ success: false, message: 'Plan ID is required' });
    }

    const plan = await SubscriptionPlanModel.findById(plan_id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Subscription plan not found' });
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + plan.duration_months);

    const subscription = await HostelSubscriptionModel.create({
      hostel_id: hostelId,
      plan_id: plan_id,
      start_date: startDate,
      end_date: endDate,
      amount_paid: plan.total_price,
      status: 'active',
      payment_method: payment_method || 'cash',
      payment_reference: payment_reference || `REF-${Date.now()}`
    });

    res.status(201).json({ success: true, subscription });
  } catch (error) {
    console.error('Error creating hostel subscription:', error);
    res.status(500).json({ success: false, message: 'Failed to create hostel subscription' });
  }
});

// Get expired subscriptions
router.get('/expired/all', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded || decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const expiredSubscriptions = await HostelSubscriptionModel.getExpiredSubscriptions();
    res.json({ success: true, expiredSubscriptions });
  } catch (error) {
    console.error('Error fetching expired subscriptions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch expired subscriptions' });
  }
});

// Renew subscription for a hostel
router.post('/hostel/:hostelId/renew', async (req, res) => {
  try {
    const { hostelId } = req.params;
    const { plan_id, payment_method = 'cash', payment_reference } = req.body;

    // Check if user is super admin
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const user = await UserModel.findById(decoded.userId);
    
    if (!user || user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!plan_id) {
      return res.status(400).json({ success: false, message: 'Plan ID is required' });
    }

    // Get the plan details
    const plan = await SubscriptionPlanModel.findById(plan_id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Subscription plan not found' });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create new subscription
      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + plan.duration_months);

      const subscription = await HostelSubscriptionModel.create({
        hostel_id: parseInt(hostelId),
        plan_id: plan_id,
        start_date: startDate,
        end_date: endDate,
        amount_paid: plan.total_price, // Assume full payment for renewal
        status: 'active',
        payment_method: payment_method,
        payment_reference: payment_reference || `RENEWAL-${hostelId}-${Date.now()}`
      });

      // Update hostel's current subscription
      await client.query(
        'UPDATE hostels SET current_subscription_id = $1 WHERE id = $2',
        [subscription.id, hostelId]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Subscription renewed successfully',
        subscription: {
          id: subscription.id,
          plan_name: plan.name,
          start_date: subscription.start_date,
          end_date: subscription.end_date,
          amount_paid: subscription.amount_paid,
          status: subscription.status
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error renewing subscription:', error);
    res.status(500).json({ success: false, message: 'Failed to renew subscription' });
  }
});

export default router;
