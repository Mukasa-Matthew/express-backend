import pool from '../config/database';

async function simpleAuthSettingsMigration() {
  try {
    console.log('Starting simple authentication settings migration...');
    
    await pool.query('BEGIN');
    
    // Create auth_settings table
    console.log('Creating auth_settings table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(100) NOT NULL UNIQUE,
        setting_value TEXT,
        setting_type VARCHAR(20) DEFAULT 'string' CHECK (setting_type IN ('string', 'boolean', 'number', 'json')),
        description TEXT,
        is_encrypted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create password_rules table
    console.log('Creating password_rules table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_rules (
        id SERIAL PRIMARY KEY,
        rule_name VARCHAR(100) NOT NULL UNIQUE,
        is_enabled BOOLEAN DEFAULT TRUE,
        min_length INTEGER DEFAULT 8,
        max_length INTEGER DEFAULT 128,
        require_uppercase BOOLEAN DEFAULT TRUE,
        require_lowercase BOOLEAN DEFAULT TRUE,
        require_numbers BOOLEAN DEFAULT TRUE,
        require_special_chars BOOLEAN DEFAULT TRUE,
        special_chars VARCHAR(50) DEFAULT '!@#$%^&*()_+-=[]{}|;:,.<>?',
        prevent_common_passwords BOOLEAN DEFAULT TRUE,
        prevent_user_info BOOLEAN DEFAULT TRUE,
        max_age_days INTEGER DEFAULT 90,
        history_count INTEGER DEFAULT 5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create two_factor_settings table
    console.log('Creating two_factor_settings table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS two_factor_settings (
        id SERIAL PRIMARY KEY,
        is_enabled BOOLEAN DEFAULT FALSE,
        method VARCHAR(20) DEFAULT 'totp' CHECK (method IN ('totp', 'sms', 'email')),
        issuer_name VARCHAR(100) DEFAULT 'LTS Portal',
        backup_codes_count INTEGER DEFAULT 10,
        session_timeout_minutes INTEGER DEFAULT 30,
        require_2fa_for_admin BOOLEAN DEFAULT TRUE,
        require_2fa_for_users BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create user_two_factor table
    console.log('Creating user_two_factor table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_two_factor (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_enabled BOOLEAN DEFAULT FALSE,
        secret_key VARCHAR(255),
        backup_codes TEXT[],
        last_used TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);
    
    // Create sso_providers table
    console.log('Creating sso_providers table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sso_providers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        provider_type VARCHAR(50) NOT NULL CHECK (provider_type IN ('oauth2', 'saml', 'ldap')),
        is_enabled BOOLEAN DEFAULT FALSE,
        client_id VARCHAR(255),
        client_secret VARCHAR(255),
        authorization_url TEXT,
        token_url TEXT,
        user_info_url TEXT,
        redirect_uri TEXT,
        scopes TEXT,
        additional_config JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create user_sso_accounts table
    console.log('Creating user_sso_accounts table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sso_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        provider_id INTEGER REFERENCES sso_providers(id) ON DELETE CASCADE,
        external_id VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        name VARCHAR(255),
        avatar_url TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider_id, external_id)
      )
    `);
    
    // Create password_history table
    console.log('Creating password_history table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Insert default authentication settings
    console.log('Inserting default authentication settings...');
    await pool.query(`
      INSERT INTO auth_settings (setting_key, setting_value, setting_type, description) VALUES 
      ('session_timeout_minutes', '480', 'number', 'Session timeout in minutes (8 hours)'),
      ('max_login_attempts', '5', 'number', 'Maximum login attempts before lockout'),
      ('lockout_duration_minutes', '30', 'number', 'Account lockout duration in minutes'),
      ('password_reset_token_expiry_hours', '24', 'number', 'Password reset token expiry in hours'),
      ('email_verification_required', 'true', 'boolean', 'Require email verification for new accounts'),
      ('allow_password_reset', 'true', 'boolean', 'Allow users to reset their passwords'),
      ('require_strong_passwords', 'true', 'boolean', 'Enforce strong password requirements'),
      ('enable_audit_logging', 'true', 'boolean', 'Enable authentication audit logging')
      ON CONFLICT (setting_key) DO NOTHING
    `);
    
    // Insert default password rules
    console.log('Inserting default password rules...');
    await pool.query(`
      INSERT INTO password_rules (rule_name, min_length, max_length, require_uppercase, require_lowercase, require_numbers, require_special_chars, prevent_common_passwords, prevent_user_info, max_age_days, history_count) VALUES 
      ('default', 8, 128, true, true, true, true, true, true, 90, 5)
      ON CONFLICT (rule_name) DO NOTHING
    `);
    
    // Insert default 2FA settings
    console.log('Inserting default 2FA settings...');
    await pool.query(`
      INSERT INTO two_factor_settings (is_enabled, method, issuer_name, backup_codes_count, session_timeout_minutes, require_2fa_for_admin, require_2fa_for_users) VALUES 
      (false, 'totp', 'LTS Portal', 10, 30, true, false)
      ON CONFLICT DO NOTHING
    `);
    
    await pool.query('COMMIT');
    console.log('✅ Simple authentication settings migration completed successfully!');
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Simple authentication settings migration failed:', error);
  } finally {
    await pool.end();
    console.log('Migration completed');
  }
}

simpleAuthSettingsMigration();
