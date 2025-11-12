import axios from 'axios';
import pool from '../config/database';
import { User } from '../models/User';

interface SmsSendResult {
  success: boolean;
  response?: any;
}

type MaybeString = string | null | undefined;

class SmsService {
  private static readonly API_URL =
    process.env.YOOLA_SMS_API_URL || 'https://yoolasms.com/api/v1/send';

  private static readonly OTP_TEMPLATE =
    process.env.YOOLA_SMS_OTP_TEMPLATE ||
    'Your OTP code is {OTP}. It expires in 15 minutes.';

  private static readonly COUNTRY_CODE =
    process.env.YOOLA_SMS_DEFAULT_COUNTRY_CODE || '';

  private static isConfigured(): boolean {
    return Boolean(process.env.YOOLA_SMS_API_KEY);
  }

  /**
   * Public helper to send an OTP via SMS for a given user.
   * This method only fires if API credentials and at least one phone number exist.
   */
  static async sendPasswordResetOtp(user: User, otp: string): Promise<void> {
    if (!SmsService.isConfigured()) return;

    try {
      const phoneNumbers = await SmsService.resolvePhoneNumbers(user.id);

      if (phoneNumbers.length === 0) {
        console.warn(
          `[SmsService] No phone numbers found for user ${user.id} (${user.email}). OTP will not be sent via SMS.`
        );
        return;
      }

      const uniqueNumbers = Array.from(new Set(phoneNumbers));
      const message = SmsService.OTP_TEMPLATE.replace('{OTP}', otp);
      await SmsService.sendSms(uniqueNumbers, message);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SmsService] Failed to send OTP SMS:', message);
    }
  }

  private static async sendSms(
    recipients: string[],
    message: string
  ): Promise<SmsSendResult> {
    if (!SmsService.isConfigured() || recipients.length === 0) {
      return { success: false };
    }

    const payload = {
      phone: recipients.join(','),
      message,
      api_key: process.env.YOOLA_SMS_API_KEY,
    };

    try {
      const response = await axios.post(SmsService.API_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      return { success: true, response: response.data };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      console.error('[SmsService] Provider request failed:', message);
      return { success: false };
    }
  }

  private static async resolvePhoneNumbers(userId: number): Promise<string[]> {
    const numbers: string[] = [];

    const fromUser = await SmsService.fetchFromUsersTable(userId);
    numbers.push(...fromUser);

    const fromStudent = await SmsService.fetchStudentNumber(userId);
    numbers.push(...fromStudent);

    const fromStudentProfile = await SmsService.fetchStudentProfileNumbers(
      userId
    );
    numbers.push(...fromStudentProfile);

    return numbers
      .map((value) => SmsService.normalizePhoneNumber(value))
      .filter((value): value is string => Boolean(value));
  }

  private static async fetchFromUsersTable(
    userId: number
  ): Promise<string[]> {
    try {
      const result = await pool.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );
      const username = result.rows[0]?.username as MaybeString;
      return username ? [username] : [];
    } catch (err) {
      SmsService.logLookupError('users', err);
      return [];
    }
  }

  private static async fetchStudentNumber(
    userId: number
  ): Promise<string[]> {
    try {
      const result = await pool.query(
        `SELECT phone_number, guardian_phone
         FROM students
         WHERE user_id = $1
         LIMIT 1`,
        [userId]
      );
      if (result.rows.length === 0) return [];

      const { phone_number, guardian_phone } = result.rows[0] as {
        phone_number: MaybeString;
        guardian_phone: MaybeString;
      };

      return [phone_number, guardian_phone].filter(
        (value): value is string => Boolean(value)
      );
    } catch (err) {
      SmsService.logLookupError('students', err);
      return [];
    }
  }

  private static async fetchStudentProfileNumbers(
    userId: number
  ): Promise<string[]> {
    if (!(await SmsService.tableExists('student_profiles'))) {
      return [];
    }

    try {
      const result = await pool.query(
        `SELECT phone, whatsapp
         FROM student_profiles
         WHERE user_id = $1
         LIMIT 1`,
        [userId]
      );
      if (result.rows.length === 0) return [];

      const { phone, whatsapp } = result.rows[0] as {
        phone: MaybeString;
        whatsapp: MaybeString;
      };

      return [phone, whatsapp].filter(
        (value): value is string => Boolean(value)
      );
    } catch (err) {
      SmsService.logLookupError('student_profiles', err);
      return [];
    }
  }

  private static async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
        [tableName]
      );
      return result.rows.length > 0;
    } catch (err) {
      SmsService.logLookupError('information_schema.tables', err);
      return false;
    }
  }

  private static normalizePhoneNumber(value: MaybeString): string | null {
    if (!value) return null;

    // remove spaces, hyphens, parentheses
    let cleaned = value.replace(/[\s()-]/g, '');

    // Replace leading 00 with +
    if (cleaned.startsWith('00')) {
      cleaned = `+${cleaned.slice(2)}`;
    }

    if (cleaned.startsWith('+')) {
      return cleaned;
    }

    if (cleaned.startsWith('0') && SmsService.COUNTRY_CODE) {
      return `+${SmsService.COUNTRY_CODE}${cleaned.slice(1)}`;
    }

    if (/^\d{7,}$/.test(cleaned) && SmsService.COUNTRY_CODE) {
      return `+${SmsService.COUNTRY_CODE}${cleaned}`;
    }

    return /^\+?\d{7,}$/.test(cleaned) ? cleaned : null;
  }

  private static logLookupError(table: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SmsService] Lookup failed for ${table}:`, message);
  }
}

export default SmsService;





















