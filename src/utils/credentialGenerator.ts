import crypto from 'crypto';

export class CredentialGenerator {
  /**
   * Generate a temporary username based on email
   */
  static generateUsername(email: string): string {
    const emailPrefix = email.split('@')[0];
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    return `${emailPrefix}_${randomSuffix}`;
  }

  /**
   * Generate a secure temporary password
   */
  static generateTemporaryPassword(): string {
    // Generate a password with uppercase, lowercase, numbers, and special characters
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*';
    
    let password = '';
    
    // Ensure at least one character from each category
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];
    
    // Fill the rest with random characters
    const allChars = uppercase + lowercase + numbers + special;
    for (let i = 4; i < 12; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Generate a temporary password that's easier to type (no special characters)
   */
  static generateSimpleTemporaryPassword(): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    
    let password = '';
    
    // Ensure at least one character from each category
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    
    // Fill the rest with random characters
    const allChars = uppercase + lowercase + numbers;
    for (let i = 3; i < 10; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Generate a temporary password with a pattern (easier to remember)
   */
  static generatePatternPassword(): string {
    const adjectives = ['Quick', 'Smart', 'Bright', 'Swift', 'Bold', 'Calm', 'Cool', 'Fast'];
    const nouns = ['Tiger', 'Eagle', 'Lion', 'Wolf', 'Bear', 'Fox', 'Hawk', 'Deer'];
    const numbers = Math.floor(Math.random() * 900) + 100; // 100-999
    
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    
    return `${adjective}${noun}${numbers}`;
  }

  /**
   * Generate a completely random password
   */
  static generateRandomPassword(length: number = 12): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    
    for (let i = 0; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    
    return password;
  }

  /**
   * Generate a memorable password with word + numbers
   */
  static generateMemorablePassword(): string {
    const words = ['Summer', 'Winter', 'Spring', 'Autumn', 'Ocean', 'Mountain', 'Forest', 'River'];
    const word = words[Math.floor(Math.random() * words.length)];
    const numbers = Math.floor(Math.random() * 9000) + 1000; // 1000-9999
    
    return `${word}${numbers}`;
  }
}
