import express, { Request } from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';
import { requireActiveSemester } from '../utils/semesterMiddleware';

const router = express.Router();

async function getHostelId(userId: number, role: string): Promise<number | null> {
  if (role === 'hostel_admin') {
    const u = await UserModel.findById(userId);
    return u?.hostel_id || null;
  }
  if (role === 'custodian') {
    const r = await pool.query('SELECT hostel_id FROM custodians WHERE user_id = $1', [userId]);
    return r.rows[0]?.hostel_id || null;
  }
  return null;
}

// List inventory items
router.get('/', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try { decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret'); } catch { return res.status(401).json({ success: false, message: 'Invalid token' }); }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) return res.status(401).json({ success: false, message: 'Unauthorized' });
    
    // Determine target hostel id
    let targetHostelId: number | null = null;
    if (currentUser.role === 'hostel_admin' || currentUser.role === 'custodian') {
      targetHostelId = await getHostelId(currentUser.id, currentUser.role);
      if (!targetHostelId) {
        console.error(`[Inventory] User ${currentUser.id} (${currentUser.role}) has no hostel_id assigned`);
        return res.status(403).json({ success: false, message: 'Forbidden: no hostel assigned' });
      }
    } else if (currentUser.role === 'super_admin') {
      // Super admin can optionally filter by hostel_id
      const q = req.query.hostel_id as string | undefined;
      targetHostelId = q ? parseInt(q) : null;
    } else {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limitRaw = Math.max(1, parseInt((req.query.limit as string) || '20', 10));
    const limit = Math.min(100, limitRaw);
    const offset = (page - 1) * limit;
    
    // Check if inventory_items table exists, otherwise use inventory table
    let tableName = 'inventory_items';
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'inventory_items'
      )
    `);
    
    if (!tableCheck.rows[0]?.exists) {
      // Use inventory table with column mapping
      tableName = 'inventory';
    }
    
    let query = `SELECT * FROM ${tableName}`;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (targetHostelId) {
      query += ` WHERE hostel_id = $${paramIndex}`;
      params.push(targetHostelId);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const r = await pool.query(query, params);
    
    // Map columns if using inventory table (different column names)
    let mappedRows = r.rows;
    if (tableName === 'inventory') {
      mappedRows = r.rows.map(row => ({
        id: row.id,
        hostel_id: row.hostel_id,
        name: row.item_name || row.name,
        quantity: row.quantity,
        unit: row.unit,
        category: row.category,
        purchase_price: null, // inventory table doesn't have this
        status: row.condition || 'active',
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));
    }
    
    res.json({ success: true, data: mappedRows, page, limit });
  } catch (e) {
    console.error('List inventory error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Create inventory item
router.post('/', async (req: Request, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try { decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret'); } catch { return res.status(401).json({ success: false, message: 'Invalid token' }); }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser || (currentUser.role !== 'hostel_admin' && currentUser.role !== 'custodian')) return res.status(403).json({ success: false, message: 'Forbidden' });
    const hostelId = await getHostelId(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });
    
    // Check for active semester before allowing inventory recording
    const semesterCheck = await requireActiveSemester(currentUser.id, hostelId);
    if (!semesterCheck.success) {
      return res.status(400).json({ success: false, message: semesterCheck.message });
    }
    
    const { name, quantity, unit, category, purchase_price, status, notes } = req.body as any;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    
    // Check which table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'inventory_items'
      )
    `);
    
    if (tableCheck.rows[0]?.exists) {
      // Use inventory_items table
      const r = await pool.query(
        `INSERT INTO inventory_items (hostel_id, name, quantity, unit, category, purchase_price, status, notes, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3,0), $4, $5, $6, COALESCE($7,'active'), $8, NOW(), NOW()) RETURNING *`,
        [hostelId, name, quantity ?? null, unit || null, category || null, purchase_price ?? null, status || 'active', notes || null]
      );
      res.status(201).json({ success: true, data: r.rows[0] });
    } else {
      // Use inventory table (different column names)
      const validCondition = typeof status === 'string'
        ? status.toLowerCase()
        : (status || '').toString().toLowerCase();
      const allowedConditions = ['good', 'fair', 'poor', 'needs_repair'];
      const normalizedCondition = allowedConditions.includes(validCondition) ? validCondition : 'good';

      const r = await pool.query(
        `INSERT INTO inventory (hostel_id, item_name, quantity, unit, category, condition, notes, created_at, updated_at)
         VALUES ($1, $2, COALESCE($3,0), $4, $5, $6, $7, NOW(), NOW()) RETURNING *`,
        [hostelId, name, quantity ?? null, unit || null, category || null, normalizedCondition, notes || null]
      );
      // Map response to match expected format
      const mappedRow = {
        id: r.rows[0].id,
        hostel_id: r.rows[0].hostel_id,
        name: r.rows[0].item_name,
        quantity: r.rows[0].quantity,
        unit: r.rows[0].unit,
        category: r.rows[0].category,
        purchase_price: null,
        status: r.rows[0].condition,
        notes: r.rows[0].notes,
        created_at: r.rows[0].created_at,
        updated_at: r.rows[0].updated_at
      };
      res.status(201).json({ success: true, data: mappedRow });
    }
  } catch (e) {
    console.error('Create inventory error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Update inventory item
router.put('/:id', async (req: Request, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try { decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret'); } catch { return res.status(401).json({ success: false, message: 'Invalid token' }); }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser || (currentUser.role !== 'hostel_admin' && currentUser.role !== 'custodian')) return res.status(403).json({ success: false, message: 'Forbidden' });
    const hostelId = await getHostelId(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });
    const { id } = req.params;
    
    // Check which table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'inventory_items'
      )
    `);
    const tableName = tableCheck.rows[0]?.exists ? 'inventory_items' : 'inventory';
    
    // Ensure item belongs to hostel
    const check = await pool.query(`SELECT id FROM ${tableName} WHERE id = $1 AND hostel_id = $2`, [id, hostelId]);
    if (!check.rowCount) return res.status(404).json({ success: false, message: 'Item not found' });
    
    const { name, quantity, unit, category, purchase_price, status, notes } = req.body as any;
    
    if (tableName === 'inventory_items') {
      const r = await pool.query(
        `UPDATE inventory_items SET
          name = COALESCE($1, name),
          quantity = COALESCE($2, quantity),
          unit = COALESCE($3, unit),
          category = COALESCE($4, category),
          purchase_price = COALESCE($5, purchase_price),
          status = COALESCE($6, status),
          notes = COALESCE($7, notes),
          updated_at = NOW()
         WHERE id = $8 RETURNING *`,
        [name || null, quantity ?? null, unit || null, category || null, purchase_price ?? null, status || null, notes || null, id]
      );
      res.json({ success: true, data: r.rows[0] });
    } else {
      // Use inventory table
      const r = await pool.query(
        `UPDATE inventory SET
          item_name = COALESCE($1, item_name),
          quantity = COALESCE($2, quantity),
          unit = COALESCE($3, unit),
          category = COALESCE($4, category),
          condition = COALESCE($5, condition),
          notes = COALESCE($6, notes),
          updated_at = NOW()
         WHERE id = $7 RETURNING *`,
        [name || null, quantity ?? null, unit || null, category || null, status || null, notes || null, id]
      );
      // Map response
      const mappedRow = {
        id: r.rows[0].id,
        hostel_id: r.rows[0].hostel_id,
        name: r.rows[0].item_name,
        quantity: r.rows[0].quantity,
        unit: r.rows[0].unit,
        category: r.rows[0].category,
        purchase_price: null,
        status: r.rows[0].condition,
        notes: r.rows[0].notes,
        created_at: r.rows[0].created_at,
        updated_at: r.rows[0].updated_at
      };
      res.json({ success: true, data: mappedRow });
    }
  } catch (e) {
    console.error('Update inventory error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Delete inventory item
router.delete('/:id', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try { decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret'); } catch { return res.status(401).json({ success: false, message: 'Invalid token' }); }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser || (currentUser.role !== 'hostel_admin' && currentUser.role !== 'custodian')) return res.status(403).json({ success: false, message: 'Forbidden' });
    const hostelId = await getHostelId(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });
    const { id } = req.params;
    
    // Check which table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'inventory_items'
      )
    `);
    const tableName = tableCheck.rows[0]?.exists ? 'inventory_items' : 'inventory';
    
    const r = await pool.query(`DELETE FROM ${tableName} WHERE id = $1 AND hostel_id = $2`, [id, hostelId]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json({ success: true, message: 'Item deleted' });
  } catch (e) {
    console.error('Delete inventory error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;



















