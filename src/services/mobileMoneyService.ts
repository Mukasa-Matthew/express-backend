import dotenv from 'dotenv';

dotenv.config();

type StkStatus = 'pending' | 'completed';

export interface StkPushRequest {
  phoneNumber: string;
  amount: number;
  bookingId: number;
  hostelId: number;
  currency?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface StkPushResponse {
  success: boolean;
  message: string;
  status?: StkStatus;
  reference?: string;
  raw?: any;
}

export class MobileMoneyService {
  private static provider = (process.env.MOMO_PROVIDER || '').toLowerCase();

  static isConfigured(): boolean {
    return Boolean(this.provider);
  }

  static getProvider(): string {
    return this.provider;
  }

  static async initiateStkPush(request: StkPushRequest): Promise<StkPushResponse> {
    if (!this.provider) {
      return {
        success: false,
        message:
          'Mobile money provider not configured. Set MOMO_PROVIDER=mock to simulate payments or configure an actual integration.',
      };
    }

    if (this.provider === 'mock') {
      const reference = `MOCK-${Date.now()}`;
      console.log('📲 [Mock STK] Simulating mobile money request', {
        bookingId: request.bookingId,
        hostelId: request.hostelId,
        phoneNumber: request.phoneNumber,
        amount: request.amount,
      });
      return {
        success: true,
        message: 'Mock STK push simulated. Payment marked as completed automatically.',
        status: 'completed',
        reference,
      };
    }

    console.warn(
      `⚠️  Mobile money provider "${this.provider}" is not implemented. Request ignored.`,
    );
    return {
      success: false,
      message: `Mobile money provider "${this.provider}" is not implemented. Set MOMO_PROVIDER=mock to simulate payments.`,
    };
  }
}


