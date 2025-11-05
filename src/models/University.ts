import pool from '../config/database';

export interface University {
  id: number;
  name: string;
  code: string;
  region_id?: number;
  address?: string;
  contact_phone?: string;
  contact_email?: string;
  website?: string;
  status: 'active' | 'inactive' | 'suspended';
  created_at: Date;
  updated_at: Date;
}

export interface CreateUniversityData {
  name: string;
  code: string;
  region_id?: number;
  address?: string;
  contact_phone?: string;
  contact_email?: string;
  website?: string;
  status?: 'active' | 'inactive' | 'suspended';
}

export interface UpdateUniversityData {
  name?: string;
  code?: string;
  region_id?: number;
  address?: string;
  contact_phone?: string;
  contact_email?: string;
  website?: string;
  status?: 'active' | 'inactive' | 'suspended';
}

export interface Region {
  id: number;
  name: string;
  country: string;
  created_at: Date;
}

export class UniversityModel {
  static async create(data: CreateUniversityData): Promise<University> {
    const query = `
      INSERT INTO universities (name, code, region_id, address, contact_phone, contact_email, website, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      data.name,
      data.code,
      data.region_id || null,
      data.address || null,
      data.contact_phone || null,
      data.contact_email || null,
      data.website || null,
      data.status || 'active'
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findAll(): Promise<University[]> {
    const query = `
      SELECT u.*, r.name as region_name
      FROM universities u
      LEFT JOIN regions r ON u.region_id = r.id
      ORDER BY u.name
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  static async findById(id: number): Promise<University | null> {
    const query = `
      SELECT u.*, r.name as region_name
      FROM universities u
      LEFT JOIN regions r ON u.region_id = r.id
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  static async update(id: number, data: UpdateUniversityData): Promise<University | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE universities 
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  static async delete(id: number): Promise<boolean> {
    const query = 'DELETE FROM universities WHERE id = $1';
    const result = await pool.query(query, [id]);
    return (result.rowCount || 0) > 0;
  }

  static async getRegions(): Promise<Region[]> {
    const query = 'SELECT * FROM regions ORDER BY name';
    const result = await pool.query(query);
    return result.rows;
  }

  static async getUniversityStats(universityId?: number): Promise<any> {
    let whereClause = '';
    let params: any[] = [];

    if (universityId) {
      whereClause = 'WHERE h.university_id = $1';
      params = [universityId];
    }

    const query = `
      WITH active_assignments AS (
        SELECT 
          r.hostel_id,
          COUNT(DISTINCT sra.id) as occupied_rooms_count
        FROM student_room_assignments sra
        JOIN rooms r ON sra.room_id = r.id
        WHERE sra.status = 'active'
        GROUP BY r.hostel_id
      )
      SELECT 
        COUNT(DISTINCT h.id) as total_hostels,
        COUNT(DISTINCT u.id) as total_students,
        SUM(h.total_rooms) as total_rooms,
        SUM(h.total_rooms - COALESCE(aa.occupied_rooms_count, 0)) as available_rooms,
        SUM(COALESCE(aa.occupied_rooms_count, 0)) as occupied_rooms,
        CASE 
          WHEN SUM(h.total_rooms) > 0 THEN 
            ROUND((SUM(COALESCE(aa.occupied_rooms_count, 0))::numeric / SUM(h.total_rooms)::numeric) * 100, 2)
          ELSE 0 
        END as occupancy_rate
      FROM hostels h
      LEFT JOIN users u ON u.hostel_id = h.id AND u.role = 'user'
      LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
      ${whereClause}
    `;

    const result = await pool.query(query, params);
    return result.rows[0];
  }
}
