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
    const fromCustodians = r.rows[0]?.hostel_id || null;
    if (fromCustodians) return fromCustodians;
    const u = await UserModel.findById(userId);
    return u?.hostel_id || null;
  }
  return null;
}

// List expenses
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
    const semesterId = req.query.semester_id ? Number(req.query.semester_id) : null;
    
    const semesterFilter = semesterId ? 'AND semester_id = $2' : '';
    const queryParams = semesterId ? [hostelId, semesterId, limit, offset] : [hostelId, limit, offset];
    
    const r = await pool.query(
      `SELECT * FROM expenses WHERE hostel_id = $1 ${semesterFilter} ORDER BY spent_at DESC
       LIMIT $${semesterId ? '3' : '2'} OFFSET $${semesterId ? '4' : '3'}`,
      queryParams
    );
    res.json({ success: true, data: r.rows, page, limit });
  } catch (e) {
    console.error('List expenses error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Expenses summary by category
router.get('/summary', async (req, res) => {
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

    const semesterId = req.query.semester_id ? Number(req.query.semester_id) : null;
    const semesterFilter = semesterId ? 'AND semester_id = $2' : '';
    const queryParams = semesterId ? [hostelId, semesterId] : [hostelId];
    
    const r = await pool.query(
      `SELECT COALESCE(category, 'Uncategorized') AS category, SUM(amount)::numeric AS total
       FROM expenses
       WHERE hostel_id = $1 ${semesterFilter}
       GROUP BY COALESCE(category, 'Uncategorized')
       ORDER BY category ASC`,
      queryParams
    );

    const total = r.rows.reduce((s, row) => s + parseFloat(row.total || 0), 0);
    const items = r.rows.map(row => ({ category: row.category, total: parseFloat(row.total) }));
    res.json({ success: true, data: { total, items } });
  } catch (e) {
    console.error('Expenses summary error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Create expense
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
    
    // Check for active semester before allowing expense recording
    const semesterCheck = await requireActiveSemester(currentUser.id, hostelId);
    if (!semesterCheck.success) {
      return res.status(400).json({ success: false, message: semesterCheck.message });
    }
    
    const { amount, currency, category, description, spent_at } = req.body as any;
    if (!amount) return res.status(400).json({ success: false, message: 'Amount is required' });
    const r = await pool.query(
      `INSERT INTO expenses (hostel_id, user_id, semester_id, amount, currency, category, description, spent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW())) RETURNING *`,
      [hostelId, currentUser.id, semesterCheck.semesterId, parseFloat(amount), currency || 'UGX', category || null, description || null, spent_at || null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    console.error('Create expense error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Delete expense
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
    const r = await pool.query('DELETE FROM expenses WHERE id = $1 AND hostel_id = $2', [id, hostelId]);
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Expense not found' });
    res.json({ success: true, message: 'Expense deleted' });
  } catch (e) {
    console.error('Delete expense error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
