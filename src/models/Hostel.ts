import pool from '../config/database';

export interface Hostel {
  id: number;
  name: string;
  address: string;
  description?: string;
  total_rooms: number;
  available_rooms: number;
  contact_phone?: string;
  contact_email?: string;
  status: 'active' | 'inactive' | 'maintenance' | 'suspended';
  university_id?: number;
  region_id?: number;
  distance_from_campus?: number;
  amenities?: string;
  price_per_room?: number;
  rules_and_regulations?: string;
  occupancy_type?: 'male' | 'female' | 'mixed';
  current_subscription_id?: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateHostelData {
  name: string;
  address: string;
  description?: string;
  total_rooms: number;
  available_rooms: number;
  contact_phone?: string;
  contact_email?: string;
  status?: 'active' | 'inactive' | 'maintenance' | 'suspended';
  university_id?: number;
  region_id?: number;
  occupancy_type?: 'male' | 'female' | 'mixed';
}

export interface CreateHostelWithAdminData extends CreateHostelData {
  admin_name: string;
  admin_email: string;
  admin_phone: string;
  admin_address: string;
  subscription_plan_id: string;
}

export class HostelModel {
  static async create(hostelData: CreateHostelData): Promise<Hostel> {
    const { 
      name, 
      address, 
      description, 
      total_rooms, 
      available_rooms, 
      contact_phone, 
      contact_email, 
      status,
      university_id,
      occupancy_type
    } = hostelData;
    
    const query = `
      INSERT INTO hostels (
        name, address, description, total_rooms, available_rooms, 
        contact_phone, contact_email, status, university_id, occupancy_type,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      name, 
      address, 
      description, 
      total_rooms, 
      available_rooms, 
      contact_phone, 
      contact_email, 
      status || 'active',
      university_id || null,
      occupancy_type || null
    ]);
    return result.rows[0];
  }

  static async findAll(): Promise<Hostel[]> {
    const query = 'SELECT * FROM hostels ORDER BY created_at DESC';
    const result = await pool.query(query);
    return result.rows;
  }

  static async findById(id: number): Promise<Hostel | null> {
    const query = 'SELECT * FROM hostels WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  static async update(id: number, hostelData: Partial<CreateHostelData>): Promise<Hostel | null> {
    const fields = Object.keys(hostelData);
    const values = Object.values(hostelData);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    
    const query = `
      UPDATE hostels 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await pool.query(query, [id, ...values]);
    return result.rows[0] || null;
  }

  static async delete(id: number): Promise<boolean> {
    const query = 'DELETE FROM hostels WHERE id = $1';
    const result = await pool.query(query, [id]);
    return (result.rowCount || 0) > 0;
  }

  static async getHostelStats(): Promise<{ total_hostels: number; active_hostels: number; total_rooms: number; available_rooms: number }> {
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
        COUNT(*) as total_hostels,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_hostels,
        SUM(total_rooms) as total_rooms,
        SUM(total_rooms - COALESCE(aa.occupied_rooms_count, 0)) as available_rooms
      FROM hostels h
      LEFT JOIN active_assignments aa ON aa.hostel_id = h.id
    `;
    
    const result = await pool.query(query);
    return result.rows[0];
  }
}
