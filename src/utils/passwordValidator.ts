import { AuthSettingsModel, PasswordRule } from '../models/AuthSettings';

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  score: number; // 0-100
}

export class PasswordValidator {
  private static commonPasswords = [
    'password', '123456', '123456789', 'qwerty', 'abc123', 'password123',
    'admin', 'letmein', 'welcome', 'monkey', '1234567890', 'password1',
    'qwerty123', 'dragon', 'master', 'hello', 'freedom', 'whatever',
    'qazwsx', 'trustno1', '654321', 'jordan', 'harley', 'password123',
    'shadow', 'superman', 'qwertyuiop', 'michael', 'football', 'iloveyou'
  ];

  static async validatePassword(
    password: string, 
    userInfo?: { name?: string; email?: string },
    ruleName: string = 'default'
  ): Promise<PasswordValidationResult> {
    const errors: string[] = [];
    let score = 0;

    // Get password rules
    const rules = await AuthSettingsModel.getPasswordRule(ruleName);
    if (!rules || !rules.is_enabled) {
      return { isValid: true, errors: [], score: 100 };
    }

    // Length validation
    if (password.length < rules.min_length) {
      errors.push(`Password must be at least ${rules.min_length} characters long`);
    } else if (password.length > rules.max_length) {
      errors.push(`Password must be no more than ${rules.max_length} characters long`);
    } else {
      score += 20;
    }

    // Character requirements
    if (rules.require_uppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    } else if (rules.require_uppercase) {
      score += 15;
    }

    if (rules.require_lowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    } else if (rules.require_lowercase) {
      score += 15;
    }

    if (rules.require_numbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    } else if (rules.require_numbers) {
      score += 15;
    }

    if (rules.require_special_chars && !new RegExp(`[${rules.special_chars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`).test(password)) {
      errors.push(`Password must contain at least one special character: ${rules.special_chars}`);
    } else if (rules.require_special_chars) {
      score += 15;
    }

    // Common password check
    if (rules.prevent_common_passwords && this.commonPasswords.includes(password.toLowerCase())) {
      errors.push('Password is too common. Please choose a more unique password');
    } else if (rules.prevent_common_passwords) {
      score += 10;
    }

    // User info check
    if (rules.prevent_user_info && userInfo) {
      const lowerPassword = password.toLowerCase();
      const lowerName = userInfo.name?.toLowerCase() || '';
      const lowerEmail = userInfo.email?.toLowerCase() || '';
      
      if (lowerName && lowerPassword.includes(lowerName)) {
        errors.push('Password cannot contain your name');
      } else if (lowerEmail && lowerPassword.includes(lowerEmail.split('@')[0])) {
        errors.push('Password cannot contain your email username');
      } else {
        score += 10;
      }
    }

    // Additional scoring based on complexity
    if (password.length >= 12) score += 5;
    if (password.length >= 16) score += 5;
    if (/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d])/.test(password)) score += 10;

    return {
      isValid: errors.length === 0,
      errors,
      score: Math.min(score, 100)
    };
  }

  static getPasswordStrength(score: number): { level: string; color: string } {
    if (score >= 80) return { level: 'Very Strong', color: 'green' };
    if (score >= 60) return { level: 'Strong', color: 'blue' };
    if (score >= 40) return { level: 'Medium', color: 'yellow' };
    if (score >= 20) return { level: 'Weak', color: 'orange' };
    return { level: 'Very Weak', color: 'red' };
  }

  static generatePassword(length: number = 12, includeSpecial: boolean = true): string {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    let charset = lowercase + uppercase + numbers;
    if (includeSpecial) charset += special;
    
    let password = '';
    
    // Ensure at least one character from each required set
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    if (includeSpecial) {
      password += special[Math.floor(Math.random() * special.length)];
    }
    
    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }
}
