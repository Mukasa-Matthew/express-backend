import pool from '../config/database';

export interface AuthSetting {
  id: number;
  setting_key: string;
  setting_value: string;
  setting_type: 'string' | 'boolean' | 'number' | 'json';
  description?: string;
  is_encrypted: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PasswordRule {
  id: number;
  rule_name: string;
  is_enabled: boolean;
  min_length: number;
  max_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_numbers: boolean;
  require_special_chars: boolean;
  special_chars: string;
  prevent_common_passwords: boolean;
  prevent_user_info: boolean;
  max_age_days: number;
  history_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface TwoFactorSetting {
  id: number;
  is_enabled: boolean;
  method: 'totp' | 'sms' | 'email';
  issuer_name: string;
  backup_codes_count: number;
  session_timeout_minutes: number;
  require_2fa_for_admin: boolean;
  require_2fa_for_users: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SSOProvider {
  id: number;
  name: string;
  provider_type: 'oauth2' | 'saml' | 'ldap';
  is_enabled: boolean;
  client_id?: string;
  client_secret?: string;
  authorization_url?: string;
  token_url?: string;
  user_info_url?: string;
  redirect_uri?: string;
  scopes?: string;
  additional_config: any;
  created_at: Date;
  updated_at: Date;
}

export interface UserTwoFactor {
  id: number;
  user_id: number;
  is_enabled: boolean;
  secret_key?: string;
  backup_codes?: string[];
  last_used?: Date;
  created_at: Date;
  updated_at: Date;
}

export class AuthSettingsModel {
  // Auth Settings
  static async getSetting(key: string): Promise<string | null> {
    const query = 'SELECT setting_value FROM auth_settings WHERE setting_key = $1';
    const result = await pool.query(query, [key]);
    return result.rows[0]?.setting_value || null;
  }

  static async setSetting(key: string, value: string, type: string = 'string'): Promise<void> {
    const query = `
      INSERT INTO auth_settings (setting_key, setting_value, setting_type, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (setting_key) 
      DO UPDATE SET setting_value = $2, setting_type = $3, updated_at = NOW()
    `;
    await pool.query(query, [key, value, type]);
  }

  static async getAllSettings(): Promise<AuthSetting[]> {
    const query = 'SELECT * FROM auth_settings ORDER BY setting_key';
    const result = await pool.query(query);
    return result.rows;
  }

  // Password Rules
  static async getPasswordRules(): Promise<PasswordRule[]> {
    const query = 'SELECT * FROM password_rules ORDER BY rule_name';
    const result = await pool.query(query);
    return result.rows;
  }

  static async getPasswordRule(ruleName: string): Promise<PasswordRule | null> {
    const query = 'SELECT * FROM password_rules WHERE rule_name = $1';
    const result = await pool.query(query, [ruleName]);
    return result.rows[0] || null;
  }

  static async updatePasswordRule(ruleName: string, rules: Partial<PasswordRule>): Promise<PasswordRule | null> {
    const fields = Object.keys(rules);
    const values = Object.values(rules);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    
    const query = `
      UPDATE password_rules 
      SET ${setClause}, updated_at = NOW()
      WHERE rule_name = $1
      RETURNING *
    `;
    
    const result = await pool.query(query, [ruleName, ...values]);
    return result.rows[0] || null;
  }

  // 2FA Settings
  static async getTwoFactorSettings(): Promise<TwoFactorSetting | null> {
    const query = 'SELECT * FROM two_factor_settings LIMIT 1';
    const result = await pool.query(query);
    return result.rows[0] || null;
  }

  static async updateTwoFactorSettings(settings: Partial<TwoFactorSetting>): Promise<TwoFactorSetting | null> {
    const fields = Object.keys(settings);
    const values = Object.values(settings);
    const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
    
    const query = `
      UPDATE two_factor_settings 
      SET ${setClause}, updated_at = NOW()
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  // User 2FA
  static async getUserTwoFactor(userId: number): Promise<UserTwoFactor | null> {
    const query = 'SELECT * FROM user_two_factor WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  static async createUserTwoFactor(userId: number, secretKey: string, backupCodes: string[]): Promise<UserTwoFactor> {
    const query = `
      INSERT INTO user_two_factor (user_id, secret_key, backup_codes, is_enabled)
      VALUES ($1, $2, $3, false)
      RETURNING *
    `;
    const result = await pool.query(query, [userId, secretKey, backupCodes]);
    return result.rows[0];
  }

  static async enableUserTwoFactor(userId: number): Promise<void> {
    const query = 'UPDATE user_two_factor SET is_enabled = true, updated_at = NOW() WHERE user_id = $1';
    await pool.query(query, [userId]);
  }

  static async disableUserTwoFactor(userId: number): Promise<void> {
    const query = 'UPDATE user_two_factor SET is_enabled = false, updated_at = NOW() WHERE user_id = $1';
    await pool.query(query, [userId]);
  }

  // SSO Providers
  static async getSSOProviders(): Promise<SSOProvider[]> {
    const query = 'SELECT * FROM sso_providers ORDER BY name';
    const result = await pool.query(query);
    return result.rows;
  }

  static async createSSOProvider(provider: Omit<SSOProvider, 'id' | 'created_at' | 'updated_at'>): Promise<SSOProvider> {
    const query = `
      INSERT INTO sso_providers (
        name, provider_type, is_enabled, client_id, client_secret,
        authorization_url, token_url, user_info_url, redirect_uri,
        scopes, additional_config
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const result = await pool.query(query, [
      provider.name,
      provider.provider_type,
      provider.is_enabled,
      provider.client_id,
      provider.client_secret,
      provider.authorization_url,
      provider.token_url,
      provider.user_info_url,
      provider.redirect_uri,
      provider.scopes,
      JSON.stringify(provider.additional_config)
    ]);
    return result.rows[0];
  }

  static async updateSSOProvider(id: number, provider: Partial<SSOProvider>): Promise<SSOProvider | null> {
    const fields = Object.keys(provider);
    const values = Object.values(provider);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    
    const query = `
      UPDATE sso_providers 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await pool.query(query, [id, ...values]);
    return result.rows[0] || null;
  }

  static async deleteSSOProvider(id: number): Promise<boolean> {
    const query = 'DELETE FROM sso_providers WHERE id = $1';
    const result = await pool.query(query, [id]);
    return (result.rowCount || 0) > 0;
  }

  // Password History
  static async addPasswordHistory(userId: number, passwordHash: string): Promise<void> {
    const query = 'INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)';
    await pool.query(query, [userId, passwordHash]);
  }

  static async getPasswordHistory(userId: number, limit: number = 5): Promise<string[]> {
    const query = `
      SELECT password_hash 
      FROM password_history 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `;
    const result = await pool.query(query, [userId, limit]);
    return result.rows.map(row => row.password_hash);
  }
}
