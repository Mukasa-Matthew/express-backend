import express, { Request } from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';
import { requireActiveSemester } from '../utils/semesterMiddleware';

const router = express.Router();

async function getHostelId(userId: number, role: string, explicitHostelId?: number | null): Promise<number | null> {
  if (role === 'super_admin') {
    return explicitHostelId ?? null;
  }
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
    if (!currentUser || (currentUser.role !== 'hostel_admin' && currentUser.role !== 'custodian' && currentUser.role !== 'super_admin')) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const requestedHostelId = req.query.hostel_id ? Number(req.query.hostel_id) : null;
    const hostelId = await getHostelId(currentUser.id, currentUser.role, requestedHostelId);
    if (!hostelId) {
      return res.status(400).json({ success: false, message: 'Hostel context required to view expenses' });
    }
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limitRaw = Math.max(1, parseInt((req.query.limit as string) || '20', 10));
    const limit = Math.min(100, limitRaw);
    const offset = (page - 1) * limit;
    const semesterId = req.query.semester_id ? Number(req.query.semester_id) : null;

    const columnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'expenses'
    `);
    const columns = columnsRes.rows.map(row => row.column_name);
    const hasSemesterIdColumn = columns.includes('semester_id');
    const dateColumn = columns.includes('spent_at') ? 'spent_at' : 'expense_date';

    if (semesterId !== null && !hasSemesterIdColumn) {
      return res.status(400).json({ success: false, message: 'Semester filtering is not supported because expenses.semester_id column is missing' });
    }

    const params: any[] = [hostelId];
    let paramIndex = 2;
    let whereClause = 'hostel_id = $1';

    if (semesterId !== null && hasSemesterIdColumn) {
      whereClause += ` AND semester_id = $${paramIndex}`;
      params.push(semesterId);
      paramIndex++;
    }

    const limitIndex = paramIndex++;
    const offsetIndex = paramIndex++;
    params.push(limit);
    params.push(offset);

    const r = await pool.query(
      `SELECT * FROM expenses 
       WHERE ${whereClause} 
       ORDER BY ${dateColumn} DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
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
    if (!currentUser || (currentUser.role !== 'hostel_admin' && currentUser.role !== 'custodian' && currentUser.role !== 'super_admin')) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const requestedHostelId = req.query.hostel_id ? Number(req.query.hostel_id) : null;
    const hostelId = await getHostelId(currentUser.id, currentUser.role, requestedHostelId);
    if (!hostelId) return res.status(400).json({ success: false, message: 'Hostel context required to view expense summary' });

    const columnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'expenses'
    `);
    const columnNames = columnsRes.rows.map(row => row.column_name);
    const hasSemesterColumn = columnNames.includes('semester_id');
    const categoryColumn = columnNames.includes('category') ? 'category' : null;

    const semesterId = req.query.semester_id ? Number(req.query.semester_id) : null;
    if (semesterId !== null && !hasSemesterColumn) {
      return res.status(400).json({ success: false, message: 'Semester filtering is not supported because expenses.semester_id column is missing' });
    }

    const params: any[] = [hostelId];
    let semesterClause = '';
    if (semesterId !== null && hasSemesterColumn) {
      params.push(semesterId);
      semesterClause = `AND semester_id = $${params.length}`;
    }

    let total = 0;
    let items: Array<{ category: string; total: number }> = [];

    if (categoryColumn) {
      const r = await pool.query(
        `SELECT COALESCE(${categoryColumn}, 'Uncategorized') AS category, SUM(amount)::numeric AS total
         FROM expenses
         WHERE hostel_id = $1 ${semesterClause}
         GROUP BY COALESCE(${categoryColumn}, 'Uncategorized')
         ORDER BY category ASC`,
        params
      );
      total = r.rows.reduce((s, row) => s + parseFloat(row.total || 0), 0);
      items = r.rows.map(row => ({ category: row.category, total: parseFloat(row.total) }));
    } else {
      const r = await pool.query(
        `SELECT SUM(amount)::numeric AS total
         FROM expenses
         WHERE hostel_id = $1 ${semesterClause}`,
        params
      );
      total = parseFloat(r.rows[0]?.total || 0);
      if (total > 0) {
        items = [{ category: 'All Expenses', total }];
      }
    }

    res.json({ success: true, data: { total, items } });
  } catch (e) {
    console.error('Expenses summary error:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.get('/summary/hostel', async (req, res) => {
  try {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.startsWith('Bearer ') ? rawAuth.replace('Bearer ', '') : '';
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser || (currentUser.role !== 'hostel_admin' && currentUser.role !== 'custodian' && currentUser.role !== 'super_admin')) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const requestedHostelId = req.query.hostel_id ? Number(req.query.hostel_id) : null;
    const hostelId = await getHostelId(currentUser.id, currentUser.role, requestedHostelId);
    if (!hostelId) return res.status(403).json({ success: false, message: 'Hostel scope required' });

    const monthsParam = Number(req.query.months);
    const months = Number.isFinite(monthsParam) && monthsParam > 0 ? Math.min(Math.trunc(monthsParam), 12) : 6;

    const totalsRes = await pool.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS total
       FROM expenses
       WHERE hostel_id = $1`,
      [hostelId]
    );
    const totalExpenses = parseFloat(totalsRes.rows[0]?.total || 0);

    const categoriesRes = await pool.query(
      `SELECT COALESCE(category, 'Uncategorized') AS category,
              COALESCE(SUM(amount),0)::numeric AS total
       FROM expenses
       WHERE hostel_id = $1
       GROUP BY COALESCE(category, 'Uncategorized')
       ORDER BY total DESC`,
      [hostelId]
    );
    const categories = categoriesRes.rows.map((row) => ({
      category: row.category,
      total: parseFloat(row.total || 0),
    }));

    const trendRes = await pool.query(
      `SELECT to_char(date_trunc('month', COALESCE(spent_at, created_at, CURRENT_DATE)), 'YYYY-MM') AS period,
              COALESCE(SUM(amount),0)::numeric AS total
       FROM expenses
       WHERE hostel_id = $1
         AND COALESCE(spent_at, created_at, CURRENT_DATE) >= date_trunc('month', CURRENT_DATE) - INTERVAL '${months - 1} month'
       GROUP BY period
       ORDER BY period ASC`,
      [hostelId]
    );
    const trend = trendRes.rows.map((row) => ({
      period: row.period,
      total: parseFloat(row.total || 0),
    }));

    const recentRes = await pool.query(
      `SELECT id, category, description, amount, currency, COALESCE(spent_at, created_at) AS timestamp
       FROM expenses
       WHERE hostel_id = $1
       ORDER BY COALESCE(spent_at, created_at) DESC
       LIMIT 5`,
      [hostelId]
    );
    const recent = recentRes.rows.map((row) => ({
      id: row.id,
      category: row.category || 'Uncategorized',
      description: row.description || '',
      amount: parseFloat(row.amount || 0),
      currency: row.currency || 'UGX',
      timestamp: row.timestamp,
    }));

    res.json({
      success: true,
      data: {
        totals: { amount: totalExpenses },
        categories,
        trend,
        recent,
      },
    });
  } catch (error) {
    console.error('Hostel expenses summary error:', error);
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
    
    const { amount, currency, category, description, spent_at, expense_date } = req.body as any;
    if (!amount) return res.status(400).json({ success: false, message: 'Amount is required' });
    
    const columnsRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'expenses'
    `);
    const existingColumns = columnsRes.rows.map(row => row.column_name);

    // Determine column names supported by current schema
    const dateColumn = existingColumns.includes('spent_at') ? 'spent_at' : 'expense_date';
    const dateValue = spent_at || expense_date || null;
    const hasCurrencyColumn = existingColumns.includes('currency');
    const hasSemesterColumn = existingColumns.includes('semester_id');
    const userIdColumn = existingColumns.includes('user_id')
      ? 'user_id'
      : existingColumns.includes('paid_by')
        ? 'paid_by'
        : 'user_id';
    const hasCategoryColumn = existingColumns.includes('category');
    const hasDescriptionColumn = existingColumns.includes('description');

    const insertColumns: string[] = ['hostel_id', userIdColumn, 'amount'];
    const values: any[] = [hostelId, currentUser.id, parseFloat(amount)];
    const placeholders: string[] = ['$1', '$2', '$3'];
    let paramIndex = 4;

    if (hasSemesterColumn) {
      insertColumns.push('semester_id');
      values.push(semesterCheck.semesterId ?? null);
      placeholders.push(`$${paramIndex++}`);
    }
    
    if (hasCurrencyColumn) {
      insertColumns.push('currency');
      values.push(currency || 'UGX');
      placeholders.push(`$${paramIndex++}`);
    }

    if (hasCategoryColumn) {
      insertColumns.push('category');
      values.push(category || null);
      placeholders.push(`$${paramIndex++}`);
    }

    if (hasDescriptionColumn) {
      insertColumns.push('description');
      values.push(description || null);
      placeholders.push(`$${paramIndex++}`);
    }

    insertColumns.push(dateColumn);
    values.push(dateValue);
    placeholders.push(`COALESCE($${paramIndex++}, CURRENT_DATE)`);

    const insertQuery = `
      INSERT INTO expenses (${insertColumns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *`;

    const r = await pool.query(insertQuery, values);
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
