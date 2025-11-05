import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

export interface TwoFactorSetup {
  secret: string;
  qrCodeUrl: string;
  manualEntryKey: string;
  backupCodes: string[];
}

export interface TwoFactorVerification {
  isValid: boolean;
  backupCodeUsed?: boolean;
}

export class TwoFactorAuth {
  private static readonly ISSUER_NAME = 'LTS Portal';
  private static readonly BACKUP_CODE_LENGTH = 8;
  private static readonly BACKUP_CODE_COUNT = 10;

  static generateSecret(userEmail: string): string {
    return speakeasy.generateSecret({
      name: userEmail,
      issuer: this.ISSUER_NAME,
      length: 32
    }).base32;
  }

  static async generateQRCode(secret: string, userEmail: string): Promise<string> {
    const otpauthUrl = speakeasy.otpauthURL({
      secret: secret,
      label: userEmail,
      issuer: this.ISSUER_NAME,
      algorithm: 'sha1',
      digits: 6,
      period: 30
    });

    return await QRCode.toDataURL(otpauthUrl);
  }

  static generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < this.BACKUP_CODE_COUNT; i++) {
      codes.push(this.generateBackupCode());
    }
    return codes;
  }

  private static generateBackupCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < this.BACKUP_CODE_LENGTH; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static verifyToken(secret: string, token: string): boolean {
    return speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps (60 seconds) of tolerance
    });
  }

  static verifyBackupCode(backupCodes: string[], code: string): boolean {
    const index = backupCodes.indexOf(code);
    if (index !== -1) {
      // Remove used backup code
      backupCodes.splice(index, 1);
      return true;
    }
    return false;
  }

  static async setupTwoFactor(userEmail: string): Promise<TwoFactorSetup> {
    const secret = this.generateSecret(userEmail);
    const qrCodeUrl = await this.generateQRCode(secret, userEmail);
    const manualEntryKey = secret;
    const backupCodes = this.generateBackupCodes();

    return {
      secret,
      qrCodeUrl,
      manualEntryKey,
      backupCodes
    };
  }

  static verifyTwoFactor(
    secret: string, 
    token: string, 
    backupCodes: string[]
  ): TwoFactorVerification {
    // Try TOTP token first
    if (this.verifyToken(secret, token)) {
      return { isValid: true };
    }

    // Try backup code
    if (this.verifyBackupCode(backupCodes, token)) {
      return { isValid: true, backupCodeUsed: true };
    }

    return { isValid: false };
  }

  static getTimeRemaining(): number {
    const epoch = Math.round(new Date().getTime() / 1000.0);
    const timeStep = 30;
    return timeStep - (epoch % timeStep);
  }

  static formatBackupCodes(codes: string[]): string {
    return codes.map((code, index) => `${index + 1}. ${code}`).join('\n');
  }
}
