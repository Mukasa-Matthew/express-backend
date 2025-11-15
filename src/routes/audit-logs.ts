import express, { Request, Response } from 'express';
import pool from '../config/database';
import { UserModel } from '../models/User';

const router = express.Router();

/**
 * GET /api/audit-logs
 * Get all audit logs across the system (super_admin only)
 * Query params:
 * - page: page number (default: 1)
 * - limit: items per page (default: 50, max: 200)
 * - action: filter by action type
 * - entity_type: filter by entity type (user, hostel, etc.)
 * - user_id: filter by user who performed the action
 * - start_date: filter logs from this date (ISO format)
 * - end_date: filter logs until this date (ISO format)
 * - search: search in action, entity_type, or changes JSON
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    // Authentication
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader?.trim();

    if (!token || token.toLowerCase() === 'null' || token.toLowerCase() === 'undefined') {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    let decoded: any;
    try {
      decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'fallback_secret');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const currentUser = await UserModel.findById(decoded.userId);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Only super_admin can view audit logs
    if (currentUser.role !== 'super_admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only super administrators can view audit logs' 
      });
    }

    // Pagination
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limitRaw = Math.max(1, parseInt((req.query.limit as string) || '50', 10));
    const limit = Math.min(200, limitRaw);
    const offset = (page - 1) * limit;

    // Filters
    const actionFilter = req.query.action as string | undefined;
    const entityTypeFilter = req.query.entity_type as string | undefined;
    const userIdFilter = req.query.user_id ? parseInt(req.query.user_id as string, 10) : undefined;
    const startDate = req.query.start_date as string | undefined;
    const endDate = req.query.end_date as string | undefined;
    const searchQuery = req.query.search as string | undefined;

    // Build WHERE clause
    const whereConditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (actionFilter) {
      whereConditions.push(`action = $${paramIndex}`);
      params.push(actionFilter);
      paramIndex++;
    }

    if (entityTypeFilter) {
      whereConditions.push(`entity_type = $${paramIndex}`);
      params.push(entityTypeFilter);
      paramIndex++;
    }

    if (userIdFilter) {
      whereConditions.push(`user_id = $${paramIndex}`);
      params.push(userIdFilter);
      paramIndex++;
    }

    if (startDate) {
      whereConditions.push(`created_at >= $${paramIndex}::timestamp`);
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`created_at <= $${paramIndex}::timestamp`);
      params.push(endDate);
      paramIndex++;
    }

    if (searchQuery) {
      whereConditions.push(`(
        action ILIKE $${paramIndex} OR 
        entity_type ILIKE $${paramIndex} OR 
        changes::text ILIKE $${paramIndex}
      )`);
      params.push(`%${searchQuery}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Get audit logs with user information
    const logsQuery = `
      SELECT 
        al.id,
        al.user_id,
        al.action,
        al.entity_type,
        al.entity_id,
        al.changes,
        al.ip_address,
        al.user_agent,
        al.created_at,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const logsResult = await pool.query(logsQuery, params);
    const logs = logsResult.rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      user_name: row.user_name,
      user_email: row.user_email,
      user_role: row.user_role,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      changes: row.changes ? (typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes) : null,
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      created_at: row.created_at,
    }));

    // Get unique actions and entity types for filter dropdowns
    const actionsResult = await pool.query(
      'SELECT DISTINCT action FROM audit_logs ORDER BY action'
    );
    const entityTypesResult = await pool.query(
      'SELECT DISTINCT entity_type FROM audit_logs WHERE entity_type IS NOT NULL ORDER BY entity_type'
    );

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        filters: {
          available_actions: actionsResult.rows.map((r: any) => r.action),
          available_entity_types: entityTypesResult.rows.map((r: any) => r.entity_type),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

export default router;

