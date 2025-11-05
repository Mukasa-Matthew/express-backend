import pool from '../config/database';

export interface User {
  id: number;
  username?: string;
  email: string;
  name: string;
  password: string;
  role: 'super_admin' | 'hostel_admin' | 'tenant' | 'user' | 'custodian';
  // Note: 'custodian' is also supported via DB, but typical user logins are admins/tenants.
  hostel_id?: number;
  profile_picture?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserData {
  username?: string;
  email: string;
  name: string;
  password: string;
  role: 'super_admin' | 'hostel_admin' | 'tenant' | 'user' | 'custodian';
  hostel_id?: number;
}

export class UserModel {
  static async create(userData: CreateUserData): Promise<User> {
    const { email, name, password, role, username } = userData;
    const query = `
      INSERT INTO users (email, name, password, role, username, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id, email, name, role, username, hostel_id, profile_picture, created_at, updated_at
    `;
    
    const result = await pool.query(query, [email, name, password, role, username || null]);
    return result.rows[0];
  }

  static async findByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE lower(email) = lower($1)';
    const result = await pool.query(query, [email]);
    return result.rows[0] || null;
  }

  static async findByUsername(username: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE lower(username) = lower($1)';
    const result = await pool.query(query, [username]);
    return result.rows[0] || null;
  }

  static async findByEmailAndRole(email: string, role: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1 AND role = $2';
    const result = await pool.query(query, [email, role]);
    return result.rows[0] || null;
  }

  static async findByEmailAndHostel(email: string, hostelId: number): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1 AND hostel_id = $2';
    const result = await pool.query(query, [email, hostelId]);
    return result.rows[0] || null;
  }

  static async findById(id: number): Promise<User | null> {
    const query = 'SELECT id, email, name, role, hostel_id, username, profile_picture, created_at, updated_at FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  static async findByIdWithPassword(id: number): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  static async updatePassword(id: number, hashedPassword: string): Promise<void> {
    const query = 'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2';
    await pool.query(query, [hashedPassword, id]);
  }

  static async update(id: number, updateData: Partial<User>): Promise<User | null> {
    const fields = Object.keys(updateData);
    const values = Object.values(updateData);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    
    const query = `
      UPDATE users 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, name, role, hostel_id, profile_picture, created_at, updated_at
    `;
    
    const result = await pool.query(query, [id, ...values]);
    return result.rows[0] || null;
  }
}
