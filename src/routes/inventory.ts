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
    if (!currentUser || (currentUser.role !== 'hostel_admin' && currentUser.role !== 'custodian')) return res.status(403).json({ success: false, message: 'Forbidden' });
    const hostelId = await getHostelId(currentUser.id, currentUser.role);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Forbidden' });
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limitRaw = Math.max(1, parseInt((req.query.limit as string) || '20', 10));
    const limit = Math.min(100, limitRaw);
    const offset = (page - 1) * limit;
    const r = await pool.query(
      `SELECT * FROM inventory_items WHERE hostel_id = $1 ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [hostelId]
    );
    res.json({ success: true, data: r.rows, page, limit });
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
    const r = await pool.query(
      `INSERT INTO inventory_items (hostel_id, name, quantity, unit, category, purchase_price, status, notes, created_at, updated_at)
       VALUES ($1, $2, COALESCE($3,0), $4, $5, $6, COALESCE($7,'active'), $8, NOW(), NOW()) RETURNING *`,
      [hostelId, name, quantity ?? null, unit || null, category || null, purchase_price ?? null, status || null, notes || null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
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
    // Ensure item belongs to hostel
    const check = await pool.query('SELECT id FROM inventory_items WHERE id = $1 AND hostel_id = $2', [id, hostelId]);
    if (!check.rowCount) return res.status(404).json({ success: false, message: 'Item not found' });
    const { name, quantity, unit, category, purchase_price, status, notes } = req.body as any;
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
    const r = await pool.query('DELETE FROM inventory_items WHERE id = $1 AND hostel_id = $2', [id, hostelId]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json({ success: true, message: 'Item deleted' });
  } catch (e) {
    console.error('Delete inventory error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;



















