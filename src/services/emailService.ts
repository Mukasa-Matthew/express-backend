import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

type EmailProvider = 'resend' | 'nodemailer' | 'none';

export class EmailService {
  private static resend: Resend | null = null;
  private static transporter: nodemailer.Transporter | null = null;
  private static provider: EmailProvider = 'none';

  /**
   * Determine which email provider to use based on environment
   * - Localhost/Development: Use Nodemailer
   * - VPS/Production: Use Resend
   */
  private static determineProvider(): EmailProvider {
    // Explicit provider selection (highest priority)
    const explicitProvider = process.env.EMAIL_PROVIDER?.toLowerCase();
    if (explicitProvider === 'resend' || explicitProvider === 'nodemailer') {
      return explicitProvider as EmailProvider;
    }

    // Auto-detect based on environment
    const isLocalhost = 
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'dev' ||
      process.env.HOSTNAME === 'localhost' ||
      process.env.HOSTNAME?.includes('localhost') ||
      !process.env.NODE_ENV || // Default to localhost if NODE_ENV not set
      process.env.IS_LOCAL === 'true';

    if (isLocalhost) {
      // Localhost: Prefer Nodemailer if credentials are available
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        return 'nodemailer';
      }
      // If no SMTP credentials but Resend is available, use Resend as fallback
      if (process.env.RESEND_API_KEY) {
        console.log('⚠️  Localhost detected but no SMTP credentials. Using Resend as fallback.');
        return 'resend';
      }
    } else {
      // VPS/Production: Prefer Resend
      if (process.env.RESEND_API_KEY) {
        return 'resend';
      }
      // If no Resend but SMTP credentials are available, use Nodemailer as fallback
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        console.log('⚠️  Production environment detected but no Resend API key. Using Nodemailer as fallback.');
        return 'nodemailer';
      }
    }

    return 'none';
  }

  static initialize() {
    this.provider = this.determineProvider();

    // Log environment detection
    const isLocalhost = 
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'dev' ||
      process.env.HOSTNAME === 'localhost' ||
      process.env.HOSTNAME?.includes('localhost') ||
      !process.env.NODE_ENV ||
      process.env.IS_LOCAL === 'true';
    
    if (isLocalhost) {
      console.log('🏠 Environment: Localhost/Development');
    } else {
      console.log('☁️  Environment: VPS/Production');
    }

    if (this.provider === 'resend') {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        console.warn('⚠️  RESEND_API_KEY not set - email service will not work');
        return;
      }
      this.resend = new Resend(apiKey);
      console.log('✅ Resend email service initialized');
    } else if (this.provider === 'nodemailer') {
      const host = process.env.SMTP_HOST || 'smtp.gmail.com';
      const port = parseInt(process.env.SMTP_PORT || '587');
      const secureFromEnv = (process.env.SMTP_SECURE || '').toLowerCase();
      const secure = secureFromEnv === 'true' || port === 465;
      const requireTLS = !secure && port === 587;

      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: {
          rejectUnauthorized: false,
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 14,
      });
      console.log(`✅ Nodemailer (SMTP) email service initialized (${host}:${port})`);
    } else {
      console.warn('⚠️  No email provider configured');
      console.warn('   Set RESEND_API_KEY for Resend, or SMTP_USER/SMTP_PASS for Nodemailer');
    }
  }

  static async verifyConnection(): Promise<boolean> {
    try {
      if (this.provider === 'none') {
        this.initialize();
      }

      if (this.provider === 'resend') {
        if (!this.resend) {
          this.initialize();
        }
        if (!this.resend) {
          console.error('❌ Email service not configured - RESEND_API_KEY not set');
          return false;
        }
        console.log('✅ Email service connection verified (Resend)');
        return true;
      } else if (this.provider === 'nodemailer') {
        if (!this.transporter) {
          this.initialize();
        }
        if (!this.transporter) {
          console.error('❌ Email service not configured - SMTP credentials not set');
          return false;
        }
        await this.transporter.verify();
        console.log('✅ Email service connection verified (Nodemailer/SMTP)');
        return true;
      } else {
        console.error('❌ Email service not configured');
        return false;
      }
    } catch (error: any) {
      console.error('❌ Email service connection failed:', error.message);
      return false;
    }
  }

  static async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      // Initialize if not already done
      if (this.provider === 'none') {
        this.initialize();
      }

      // If no provider is configured, fall back to console logging
      if (this.provider === 'none') {
        console.log('📧 Email not configured - credentials will be logged instead');
        this.logCredentialsToConsole(options);
        return false;
      }

      // Use Resend
      if (this.provider === 'resend') {
        if (!this.resend) {
          this.initialize();
        }
        if (!this.resend) {
          console.log('📧 Resend not initialized - falling back to console logging...');
          this.logCredentialsToConsole(options);
          return false;
        }

        const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
        
        console.log(`📧 [Resend] Sending email to ${options.to}...`);
        console.log(`   From: ${fromEmail}`);
        console.log(`   Subject: ${options.subject}`);
        
        const result = await this.resend.emails.send({
          from: fromEmail,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text || this.extractTextFromHtml(options.html),
        });

        if (result.error) {
          throw new Error(result.error.message || 'Unknown Resend error');
        }

        console.log('✅ Email sent successfully via Resend!');
        console.log(`   Message ID: ${result.data?.id || 'N/A'}`);
        return true;
      }

      // Use Nodemailer
      if (this.provider === 'nodemailer') {
        if (!this.transporter) {
          this.initialize();
        }
        if (!this.transporter) {
          console.log('📧 Nodemailer not initialized - falling back to console logging...');
          this.logCredentialsToConsole(options);
          return false;
        }

        const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
        
        console.log(`📧 [Nodemailer/SMTP] Sending email to ${options.to}...`);
        console.log(`   From: ${fromEmail}`);
        console.log(`   Subject: ${options.subject}`);
        
        const mailOptions = {
          from: fromEmail,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text || this.extractTextFromHtml(options.html),
        };

        const result = await this.transporter.sendMail(mailOptions);
        console.log('✅ Email sent successfully via Nodemailer!');
        console.log(`   Message ID: ${result.messageId}`);
        console.log(`   Response: ${result.response || 'No response'}`);
        return true;
      }

      // Fallback
      this.logCredentialsToConsole(options);
      return false;
    } catch (error: any) {
      console.error('❌ Email sending failed!');
      console.error('   Error message:', error.message || error);
      if (error.name) {
        console.error('   Error name:', error.name);
      }
      if (error.code) {
        console.error('   Error code:', error.code);
      }
      if (error.response) {
        console.error('   SMTP response:', error.response);
      }
      
      // Try to reinitialize on error
      try {
        console.log(`🔄 Attempting to reinitialize ${this.provider}...`);
        this.initialize();
      } catch (initError: any) {
        console.error('   Failed to reinitialize:', initError.message);
      }
      
      console.log('📧 Falling back to console logging...');
      this.logCredentialsToConsole(options);
      return false;
    }
  }

  /**
   * Extract plain text from HTML for email fallback
   */
  private static extractTextFromHtml(html: string): string {
    // Simple HTML to text conversion
    return html
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Send email asynchronously without blocking the main thread
   * Use this for non-critical emails that shouldn't delay API responses
   */
  static sendEmailAsync(options: EmailOptions): void {
    // Fire and forget - don't await
    this.sendEmail(options).catch((error) => {
      console.error('📧 Async email sending failed:', error.message);
    });
  }

  static logCredentialsToConsole(options: EmailOptions) {
    console.log('\n' + '='.repeat(60));
    console.log('ðŸ“§ EMAIL NOTIFICATION (Development Mode)');
    console.log('='.repeat(60));
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log('='.repeat(60));
    
    // Extract credentials from HTML if it's a welcome email
    if (options.html.includes('Temporary Login Credentials')) {
      const usernameMatch = options.html.match(/Username\/Email:<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
      const passwordMatch = options.html.match(/Temporary Password:<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
      
      if (usernameMatch && passwordMatch) {
        console.log('ðŸ” TEMPORARY CREDENTIALS:');
        console.log(`   Username/Email: ${usernameMatch[1]}`);
        console.log(`   Password: ${passwordMatch[1]}`);
        console.log('='.repeat(60));
      }
    }
    
    console.log('ðŸ“§ In production, this would be sent via email');
    console.log('='.repeat(60) + '\n');
  }

  static generateHostelAdminWelcomeEmail(
    adminName: string,
    adminEmail: string,
    temporaryUsername: string,
    temporaryPassword: string,
    hostelName: string,
    loginUrl: string,
    subscriptionDetails?: {
      planName: string;
      startDate: Date | string;
      endDate: Date | string;
      durationMonths: number;
      pricePerMonth: number;
      totalPrice: number;
      amountPaid: number;
      paymentReference?: string;
    }
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to LTS Portal - Hostel Admin</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .credentials-box {
            background: #fff;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .credential-item {
            display: flex;
            justify-content: space-between;
            margin: 10px 0;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 5px;
          }
          .credential-label {
            font-weight: bold;
            color: #555;
          }
          .credential-value {
            font-family: monospace;
            background: #e8f4f8;
            padding: 5px 10px;
            border-radius: 3px;
            color: #2c5aa0;
          }
          .button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
          }
          .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .receipt-box {
            background: #fff;
            border: 2px solid #667eea;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .receipt-header {
            text-align: center;
            color: #667eea;
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #e0e0e0;
          }
          .receipt-item {
            display: flex;
            justify-content: space-between;
            margin: 12px 0;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 5px;
          }
          .receipt-label {
            font-weight: 600;
            color: #555;
          }
          .receipt-value {
            color: #333;
            text-align: right;
          }
          .receipt-total {
            background: #667eea;
            color: white;
            font-weight: bold;
            font-size: 16px;
            margin-top: 15px;
          }
          .receipt-total .receipt-label,
          .receipt-total .receipt-value {
            color: white;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>ðŸ  Welcome to LTS Portal</h1>
          <p>Your Hostel Admin Account is Ready!</p>
        </div>
        
        <div class="content">
          <h2>Hello ${adminName}!</h2>
          
          <div style="background: #dbeafe; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
            <p style="font-size: 14px; color: #1e40af; margin: 0 0 10px 0; font-weight: 600;">YOU HAVE BEEN ASSIGNED AS:</p>
            <p style="font-size: 18px; color: #1e3a8a; margin: 0; font-weight: bold;">Hostel Admin - ${hostelName}</p>
          </div>
          
          <p>Congratulations! You have been appointed as the <strong>Hostel Administrator</strong> for <strong>${hostelName}</strong> on the LTS Portal.</p>
          
          <p>Your account has been created and you can now access your admin dashboard using the temporary credentials below:</p>
          
          <div class="credentials-box">
            <h3>ðŸ” Your Temporary Login Credentials</h3>
            <div class="credential-item">
              <span class="credential-label">Username/Email:</span>
              <span class="credential-value">${temporaryUsername}</span>
            </div>
            <div class="credential-item">
              <span class="credential-label">Temporary Password:</span>
              <span class="credential-value">${temporaryPassword}</span>
            </div>
          </div>
          
          <div class="warning">
            <strong>âš ï¸ Important Security Notice:</strong>
            <ul>
              <li>This is a temporary password that you must change immediately after your first login</li>
              <li>Do not share these credentials with anyone</li>
              <li>For security reasons, please change your password as soon as possible</li>
            </ul>
          </div>
          
          ${subscriptionDetails ? `
          <div class="receipt-box">
            <div class="receipt-header">ðŸ“„ Subscription Receipt</div>
            
            <div class="receipt-item">
              <span class="receipt-label">Subscription Plan:</span>
              <span class="receipt-value">${subscriptionDetails.planName}</span>
            </div>
            
            <div class="receipt-item">
              <span class="receipt-label">Duration:</span>
              <span class="receipt-value">${subscriptionDetails.durationMonths} month${subscriptionDetails.durationMonths !== 1 ? 's' : ''}</span>
            </div>
            
            <div class="receipt-item">
              <span class="receipt-label">Start Date:</span>
              <span class="receipt-value">${new Date(subscriptionDetails.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
            
            <div class="receipt-item">
              <span class="receipt-label">End Date:</span>
              <span class="receipt-value">${new Date(subscriptionDetails.endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
            
            <div class="receipt-item">
              <span class="receipt-label">Price Per Month:</span>
              <span class="receipt-value">UGX ${subscriptionDetails.pricePerMonth.toLocaleString()}</span>
            </div>
            
            <div class="receipt-item receipt-total">
              <span class="receipt-label">Total Amount:</span>
              <span class="receipt-value">UGX ${subscriptionDetails.totalPrice.toLocaleString()}</span>
            </div>
            
            ${subscriptionDetails.amountPaid > 0 ? `
            <div class="receipt-item">
              <span class="receipt-label">Amount Paid:</span>
              <span class="receipt-value">UGX ${subscriptionDetails.amountPaid.toLocaleString()}</span>
            </div>
            ` : `
            <div class="receipt-item" style="background: #fff3cd; color: #856404;">
              <span class="receipt-label">Payment Status:</span>
              <span class="receipt-value">Pending Payment</span>
            </div>
            `}
            
            ${subscriptionDetails.paymentReference ? `
            <div class="receipt-item">
              <span class="receipt-label">Payment Reference:</span>
              <span class="receipt-value">${subscriptionDetails.paymentReference}</span>
            </div>
            ` : ''}
            
            <p style="margin-top: 15px; font-size: 12px; color: #666; text-align: center;">
              Please keep this receipt for your records. Your subscription is active and valid until the end date shown above.
            </p>
          </div>
          ` : ''}
          
          <p>Click the button below to access your admin dashboard:</p>
          <a href="${loginUrl}" class="button">Access Admin Dashboard</a>
          
          <h3>What's Next?</h3>
          <ol>
            <li>Log in using your temporary credentials</li>
            <li>Change your password to something secure and memorable</li>
            <li>Explore your admin dashboard and configure your hostel settings</li>
            <li>Start managing your hostel operations</li>
          </ol>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          
          <p>Welcome aboard!</p>
          <p><strong>The LTS Portal Team</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>Â© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  static generatePasswordChangeConfirmationEmail(
    adminName: string,
    adminEmail: string,
    changeTime: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Changed - LTS Portal</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .success-box {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>ðŸ”’ Password Changed Successfully</h1>
        </div>
        
        <div class="content">
          <h2>Hello ${adminName}!</h2>
          
          <div class="success-box">
            <strong>âœ… Your password has been successfully changed!</strong>
          </div>
          
          <p>This is to confirm that your password was changed on <strong>${changeTime}</strong>.</p>
          
          <p>If you did not make this change, please contact our support team immediately.</p>
          
          <p>Thank you for keeping your account secure!</p>
          
          <p><strong>The LTS Portal Team</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>Â© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  static generatePaymentReceiptEmail(
    studentName: string,
    studentEmail: string,
    amountPaid: number,
    currency: string,
    balanceAfter: number | null,
    roomNumber: string | null,
    roomType: string | null,
    paidAt: string,
    hostelName?: string,
    performedByName?: string,
    performedByLabel?: string,
    accessNumber?: string | null,
    expectedPrice?: number | null
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmation${hostelName ? ' - ' + hostelName : ''}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0ea5e9; color: white; padding: 24px; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 24px; border-radius: 0 0 10px 10px; }
          .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          .row:last-child { border-bottom: none; }
          .label { color: #666; }
          .value { font-weight: bold; }
          .highlight { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 16px 0; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>${hostelName ? hostelName + ' â€” ' : ''}Booking Confirmation</h2>
          <p>Hello ${studentName}, your hostel booking has been confirmed.</p>
        </div>
        <div class="content">
          ${hostelName ? `<div class="row"><span class="label">Hostel</span><span class="value">${hostelName}</span></div>` : ''}
          <div class="row"><span class="label">Student Name</span><span class="value">${studentName}</span></div>
          <div class="row"><span class="label">Email</span><span class="value">${studentEmail}</span></div>
          ${accessNumber ? `<div class="row"><span class="label">Access Number</span><span class="value">${accessNumber}</span></div>` : ''}
          ${roomNumber ? `<div class="row"><span class="label">Room Number</span><span class="value">${roomNumber}${roomType ? ` (${roomType})` : ''}</span></div>` : ''}
          ${expectedPrice ? `<div class="row"><span class="label">Room Price</span><span class="value">${currency} ${expectedPrice.toFixed(2)}</span></div>` : ''}
          ${amountPaid > 0 ? `<div class="row"><span class="label">Amount Paid</span><span class="value">${currency} ${amountPaid.toFixed(2)}</span></div>` : ''}
          ${balanceAfter !== null ? `<div class="row"><span class="label">Balance Remaining</span><span class="value">${currency} ${balanceAfter.toFixed(2)}</span></div>` : ''}
          <div class="row"><span class="label">Booking Date</span><span class="value">${paidAt}</span></div>
          ${performedByName ? `<div class="row"><span class="label">${performedByLabel || 'Registered by'}</span><span class="value">${performedByName}</span></div>` : ''}
          ${balanceAfter !== null && balanceAfter > 0 ? `
          <div class="highlight">
            <strong>Payment Reminder:</strong> Please pay your remaining balance of ${currency} ${balanceAfter.toFixed(2)} before the semester starts.
          </div>` : ''}
        </div>
      </body>
      </html>
    `;
  }

  static generateCustodianWelcomeEmail(
    custodianName: string,
    custodianEmail: string,
    temporaryUsername: string,
    temporaryPassword: string,
    hostelName: string,
    loginUrl: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to ${hostelName} - Custodian Account</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            color: #333; 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 20px; 
          }
          .header { 
            background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
            color: white; 
            padding: 30px; 
            border-radius: 10px 10px 0 0; 
            text-align: center;
          }
          .content { 
            background: #f9f9f9; 
            padding: 30px; 
            border-radius: 0 0 10px 10px; 
          }
          .assignment-box {
            background: #d1fae5;
            border: 2px solid #10b981;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            text-align: center;
          }
          .assignment-title {
            font-size: 14px;
            color: #065f46;
            margin: 0 0 10px 0;
            font-weight: 600;
          }
          .assignment-details {
            font-size: 18px;
            color: #047857;
            margin: 0;
            font-weight: bold;
          }
          .credentials-box { 
            background: #fff; 
            border: 2px solid #e5e7eb; 
            border-radius: 8px; 
            padding: 20px; 
            margin: 20px 0; 
          }
          .credential-item {
            display: flex;
            justify-content: space-between;
            padding: 12px;
            background: #f5f5f5;
            border-radius: 5px;
            margin: 10px 0;
          }
          .credential-label { 
            color: #666; 
            font-weight: 600;
          }
          .credential-value { 
            font-weight: bold; 
            color: #047857;
            font-family: monospace;
          }
          .button { 
            display: inline-block;
            background: #10b981;
            color: #fff;
            padding: 12px 30px;
            border-radius: 6px;
            text-decoration: none;
            margin-top: 12px;
            font-weight: bold;
          }
          .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="margin: 0; font-size: 24px;">🏠 Welcome to LTS Portal</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.95;">Your Custodian Account is Ready!</p>
        </div>
        <div class="content">
          <h2 style="color: #047857;">Hello ${custodianName}!</h2>
          
          <div class="assignment-box">
            <p class="assignment-title">YOU HAVE BEEN ASSIGNED AS:</p>
            <p class="assignment-details">Custodian - ${hostelName}</p>
          </div>
          
          <p>Congratulations! You have been appointed as a <strong>Custodian</strong> for <strong>${hostelName}</strong> on the LTS Portal.</p>
          
          <p>Your account has been created and you can now access your custodian dashboard using the temporary credentials below:</p>
          
          <div class="credentials-box">
            <h3 style="margin-top: 0; color: #047857;">🔐 Your Temporary Login Credentials</h3>
            <div class="credential-item">
              <span class="credential-label">Username/Email:</span>
              <span class="credential-value">${temporaryUsername}</span>
            </div>
            <div class="credential-item">
              <span class="credential-label">Temporary Password:</span>
              <span class="credential-value">${temporaryPassword}</span>
            </div>
          </div>
          
          <div class="warning">
            <strong>⚠️ Important Security Notice:</strong>
            <ul style="margin: 10px 0 0 0; padding-left: 20px;">
              <li>This is a temporary password that you must change immediately after your first login</li>
              <li>Do not share these credentials with anyone</li>
              <li>For security reasons, please change your password as soon as possible</li>
            </ul>
          </div>
          
          <p>Click the button below to access your custodian dashboard:</p>
          <div style="text-align: center;">
            <a href="${loginUrl}" class="button">Access Custodian Dashboard</a>
          </div>
          
          <h3 style="color: #047857;">What's Next?</h3>
          <ol style="margin-left: 20px;">
            <li>Log in using your temporary credentials</li>
            <li>Change your password to something secure and memorable</li>
            <li>Explore your custodian dashboard and start managing hostel operations</li>
          </ol>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact your hostel administrator.</p>
          
          <p>Welcome aboard!</p>
          <p><strong>The ${hostelName} Management Team</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  static generateStudentWelcomeEmail(
    studentName: string,
    studentEmail: string,
    temporaryUsername: string,
    temporaryPassword: string,
    hostelName: string,
    loginUrl: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to ${hostelName} - LTS Portal</title>
        <style>
          body { font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #16a34a; color: white; padding: 24px; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 24px; border-radius: 0 0 10px 10px; }
          .box { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
          .row { display: flex; justify-content: space-between; padding: 6px 0; }
          .label { color: #666; }
          .value { font-weight: bold; }
          .button { display:inline-block;background:#16a34a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;margin-top:12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>Welcome to ${hostelName}</h2>
          <p>Your student account on LTS Portal is ready.</p>
        </div>
        <div class="content">
          <p>Hello ${studentName},</p>
          <p>Your student account has been created. Use the temporary credentials below to sign in and complete your profile.</p>
          <div class="box">
            <div class="row"><span class="label">Username/Email</span><span class="value">${temporaryUsername}</span></div>
            <div class="row"><span class="label">Temporary Password</span><span class="value">${temporaryPassword}</span></div>
          </div>
          <p><strong>Important:</strong> Change your password after your first login.</p>
          <a class="button" href="${loginUrl}">Go to Login</a>
        </div>
      </body>
      </html>
    `;
  }

  static generatePasswordResetOTPEmail(
    userName: string,
    otp: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset OTP - LTS Portal</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .otp-box {
            background: #fff;
            border: 3px solid #667eea;
            border-radius: 12px;
            padding: 30px;
            margin: 20px 0;
            text-align: center;
          }
          .otp-code {
            font-size: 36px;
            font-weight: bold;
            color: #667eea;
            letter-spacing: 8px;
            font-family: 'Courier New', monospace;
            margin: 15px 0;
          }
          .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>ðŸ” Password Reset Request</h1>
          <p>Your OTP Code</p>
        </div>
        
        <div class="content">
          <h2>Hello ${userName}!</h2>
          
          <p>You have requested to reset your password. Use the OTP code below to verify your identity:</p>
          
          <div class="otp-box">
            <p style="margin: 0; color: #666; font-size: 14px;">Your OTP Code</p>
            <div class="otp-code">${otp}</div>
            <p style="margin: 0; color: #666; font-size: 12px;">This code expires in 15 minutes</p>
          </div>
          
          <div class="warning">
            <strong>âš ï¸ Security Notice:</strong>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Never share this OTP code with anyone</li>
              <li>If you didn't request this reset, please ignore this email</li>
              <li>This code is valid for 15 minutes only</li>
            </ul>
          </div>
          
          <p>Enter this OTP code in the password reset page to create a new password.</p>
          
          <p>If you have any questions or need assistance, please contact our support team.</p>
          
          <p>Stay secure!</p>
          <p><strong>The LTS Portal Team</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>Â© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  static generatePasswordResetConfirmationEmail(
    userName: string,
    resetTime: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset Successful - LTS Portal</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .success-box {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .info-box {
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .button {
            display: inline-block;
            background: #28a745;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>âœ… Password Reset Successful</h1>
        </div>
        
        <div class="content">
          <h2>Hello ${userName}!</h2>
          
          <div class="success-box">
            <strong>âœ… Your password has been successfully reset!</strong>
          </div>
          
          <div class="info-box">
            <p><strong>Reset Time:</strong> ${resetTime}</p>
            <p><strong>Action Taken:</strong> Your account password was changed</p>
          </div>
          
          <p>You can now log in to your account using your new password.</p>
          
          <p style="text-align: center;">
            <a href="http://localhost:3000/login" class="button">Go to Login</a>
          </p>
          
          <div class="success-box" style="background: #fff3cd; border: 1px solid #ffeaa7; color: #856404;">
            <strong>âš ï¸ Security Notice:</strong>
            <p style="margin: 10px 0 0 0;">
              If you did not reset your password, please contact our support team immediately.
              Your account may have been compromised.
            </p>
          </div>
          
          <p>Thank you for keeping your account secure!</p>
          
          <p><strong>The LTS Portal Team</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>Â© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  static generateSubscriptionExpiringEmail(
    userName: string,
    hostelName: string,
    daysLeft: number,
    endDate: string,
    planName: string
  ): string {
    const urgencyColor = daysLeft <= 7 ? '#dc2626' : daysLeft <= 15 ? '#ea580c' : '#f59e0b';
    const urgencyText = daysLeft <= 7 ? 'URGENT' : daysLeft <= 15 ? 'Important' : 'Reminder';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Subscription Expiring - ${hostelName}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, ${urgencyColor} 0%, #f59e0b 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .warning-box {
            background: ${daysLeft <= 7 ? '#fee2e2' : '#fef3c7'};
            border: 2px solid ${urgencyColor};
            color: ${daysLeft <= 7 ? '#991b1b' : '#92400e'};
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
          }
          .info-box {
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #666;
            font-weight: 600;
          }
          .info-value {
            font-weight: bold;
            color: #333;
          }
          .days-badge {
            font-size: 48px;
            font-weight: bold;
            color: ${urgencyColor};
            margin: 10px 0;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>â° Subscription Expiring Soon</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">${urgencyText} - Action Required</p>
        </div>
        
        <div class="content">
          <h2>Hello ${userName}!</h2>
          
          <div class="warning-box">
            <p style="margin: 0; font-size: 16px; font-weight: bold; text-transform: uppercase;">${urgencyText}</p>
            <div class="days-badge">${daysLeft}</div>
            <p style="margin: 10px 0 0 0;">${daysLeft === 1 ? 'day' : 'days'} remaining</p>
          </div>
          
          <p>Your subscription for <strong>${hostelName}</strong> is about to expire. Renewal is required to continue using the platform.</p>
          
          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Hostel:</span>
              <span class="info-value">${hostelName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Current Plan:</span>
              <span class="info-value">${planName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Expiration Date:</span>
              <span class="info-value">${endDate}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Days Remaining:</span>
              <span class="info-value" style="color: ${urgencyColor};">${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}</span>
            </div>
          </div>
          
          <div class="warning-box" style="background: #eff6ff; border: 2px solid #3b82f6; color: #1e40af;">
            <strong>ðŸ“¢ Action Required:</strong>
            <p style="margin: 10px 0 0 0;">
              Please contact the Super Admin to renew your subscription immediately to avoid service interruption.
            </p>
          </div>
          
          <p style="margin-top: 30px;">If you have any questions, please contact our support team.</p>
          
          <p>Thank you for being a valued customer!</p>
          <p><strong>The LTS Portal Team</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>Â© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  static generateSubscriptionExpiredEmail(
    userName: string,
    hostelName: string,
    expiredDate: string,
    planName: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Subscription Expired - ${hostelName}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .alert-box {
            background: #fee2e2;
            border: 2px solid #dc2626;
            color: #991b1b;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
          }
          .info-box {
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #666;
            font-weight: 600;
          }
          .info-value {
            font-weight: bold;
            color: #333;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>ðŸ”´ Subscription Expired</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">Service Interruption Notice</p>
        </div>
        
        <div class="content">
          <h2>Hello ${userName}!</h2>
          
          <div class="alert-box">
            <p style="margin: 0; font-size: 18px; font-weight: bold;">âš ï¸ URGENT: SUBSCRIPTION EXPIRED</p>
            <p style="margin: 10px 0 0 0;">Your access to LTS Portal has been suspended</p>
          </div>
          
          <p>Your subscription for <strong>${hostelName}</strong> has expired. Account access is now restricted.</p>
          
          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Hostel:</span>
              <span class="info-value">${hostelName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Previous Plan:</span>
              <span class="info-value">${planName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Expired On:</span>
              <span class="info-value">${expiredDate}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Status:</span>
              <span class="info-value" style="color: #dc2626;">Suspended</span>
            </div>
          </div>
          
          <div class="alert-box" style="background: #fef3c7; border: 2px solid #f59e0b; color: #92400e;">
            <strong>ðŸš¨ Immediate Action Required:</strong>
            <p style="margin: 10px 0 0 0;">
              Please contact the Super Admin to renew your subscription immediately to restore access to your account.
            </p>
          </div>
          
          <p style="margin-top: 30px;">As soon as your subscription is renewed, full access will be restored.</p>
          
          <p>If you have any questions, please contact our support team.</p>
          
          <p>Thank you for your understanding.</p>
          <p><strong>The LTS Portal Team</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>Â© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  static generateSemesterEndNotification(
    studentName: string,
    hostelName: string,
    semesterName: string,
    academicYear: string,
    endDate: Date | string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Semester Completed - ${hostelName}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .success-box {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .info-box {
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #666;
            font-weight: 600;
          }
          .info-value {
            font-weight: bold;
            color: #333;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>ðŸŽ“ Semester Completed!</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">Congratulations on completing ${semesterName}</p>
        </div>
        
        <div class="content">
          <h2>Hello ${studentName}!</h2>
          
          <div class="success-box">
            <strong>âœ… Congratulations! You have successfully completed ${semesterName}.</strong>
          </div>
          
          <p>Your semester at <strong>${hostelName}</strong> has come to an end. Thank you for being part of our community!</p>
          
          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Hostel:</span>
              <span class="info-value">${hostelName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Semester:</span>
              <span class="info-value">${semesterName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Academic Year:</span>
              <span class="info-value">${academicYear}</span>
            </div>
            <div class="info-row">
              <span class="info-label">End Date:</span>
              <span class="info-value">${new Date(endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
          </div>
          
          <p style="margin-top: 30px;">We hope you had a great experience with us!</p>
          
          <p>If you have any questions or need assistance, please contact our support team.</p>
          
          <p>Best regards,</p>
          <p><strong>${hostelName} Management</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>Â© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  static generateUpcomingSemesterReminder(
    studentName: string,
    hostelName: string,
    semesterName: string,
    academicYear: string,
    startDate: Date | string,
    daysUntilStart: number
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Upcoming Semester - ${hostelName}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .reminder-box {
            background: #fff;
            border: 2px solid #667eea;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            text-align: center;
          }
          .days-badge {
            font-size: 48px;
            font-weight: bold;
            color: #667eea;
            margin: 10px 0;
          }
          .info-box {
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #666;
            font-weight: 600;
          }
          .info-value {
            font-weight: bold;
            color: #333;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>ðŸ“… Semester Starting Soon</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">Get Ready!</p>
        </div>
        
        <div class="content">
          <h2>Hello ${studentName}!</h2>
          
          <div class="reminder-box">
            <p style="margin: 0; font-size: 16px; font-weight: bold;">ðŸ“š SEMESTER STARTS IN</p>
            <div class="days-badge">${daysUntilStart}</div>
            <p style="margin: 10px 0 0 0;">${daysUntilStart === 1 ? 'day' : 'days'}</p>
          </div>
          
          <p>Your new semester at <strong>${hostelName}</strong> is starting soon!</p>
          
          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Hostel:</span>
              <span class="info-value">${hostelName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Semester:</span>
              <span class="info-value">${semesterName}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Academic Year:</span>
              <span class="info-value">${academicYear}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Start Date:</span>
              <span class="info-value">${new Date(startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
          </div>
          
          <p style="margin-top: 30px;">Please ensure you've completed all necessary preparations for the upcoming semester.</p>
          
          <p>We're excited to welcome you back!</p>
          
          <p>Best regards,</p>
          <p><strong>${hostelName} Management</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>Â© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  static generateThankYouWelcomeEmail(
    studentName: string,
    studentEmail: string,
    hostelName: string,
    roomNumber: string | null,
    accessNumber: string | null,
    amountPaid: number,
    currency: string,
    totalPaid: number,
    roomPrice: number | null
  ): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Thank You & Welcome to ${hostelName}!</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .success-box {
            background: #d1fae5;
            border: 2px solid #10b981;
            color: #065f46;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
          }
          .info-box {
            background: #fff;
            border: 2px solid #10b981;
            border-radius: 8px;
            padding: 25px;
            margin: 20px 0;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid #e5e7eb;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #666;
            font-weight: 600;
          }
          .info-value {
            font-weight: bold;
            color: #16a34a;
            font-size: 16px;
          }
          .highlight {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .welcome-message {
            background: #eff6ff;
            border: 1px solid #93c5fd;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="margin: 0; font-size: 28px;">ðŸŽ‰ Thank You!</h1>
          <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.95;">Your Balance is Fully Paid!</p>
        </div>
        
        <div class="content">
          <h2 style="color: #16a34a;">Hello ${studentName}!</h2>
          
          <div class="success-box">
            <p style="margin: 0; font-size: 20px; font-weight: bold;">âœ… FULLY PAID!</p>
            <p style="margin: 10px 0 0 0; font-size: 16px;">All outstanding balance has been cleared</p>
          </div>
          
          <div class="welcome-message">
            <h3 style="margin-top: 0; color: #1e40af;">ðŸ  Welcome to ${hostelName}!</h3>
            <p style="margin: 0;">We are absolutely delighted to have you join our hostel community!</p>
          </div>
          
          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Hostel Name:</span>
              <span class="info-value">${hostelName}</span>
            </div>
            ${accessNumber ? `
            <div class="info-row">
              <span class="info-label">Registration Number:</span>
              <span class="info-value">${accessNumber}</span>
            </div>
            ` : ''}
            ${roomNumber ? `
            <div class="info-row">
              <span class="info-label">Room Number:</span>
              <span class="info-value">${roomNumber}</span>
            </div>
            ` : ''}
            ${roomPrice !== null ? `
            <div class="info-row">
              <span class="info-label">Room Price:</span>
              <span class="info-value">${currency} ${roomPrice.toLocaleString()}</span>
            </div>
            ` : ''}
            <div class="info-row">
              <span class="info-label">Total Amount Paid:</span>
              <span class="info-value">${currency} ${totalPaid.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Payment Status:</span>
              <span class="info-value" style="color: #16a34a;">âœ“ Complete</span>
            </div>
          </div>
          
          <div class="highlight">
            <strong>ðŸŽŠ Congratulations!</strong>
            <p style="margin: 10px 0 0 0;">
              You have successfully cleared all your financial obligations for this semester. 
              Your account is in good standing and you are all set to enjoy your time with us!
            </p>
          </div>
          
          <h3 style="color: #16a34a;">What's Next?</h3>
          <p>We're here to ensure you have a comfortable and enjoyable stay. Here's what you can expect:</p>
          <ul style="margin-left: 20px;">
            <li>Access to all hostel facilities and services</li>
            <li>Comfortable living accommodations in your assigned room</li>
            <li>Support from our friendly hostel staff</li>
            <li>A welcoming and safe community environment</li>
          </ul>
          
          <p><strong>Important Information:</strong></p>
          <ul style="margin-left: 20px;">
            <li>Keep this email for your records</li>
            <li>Your payment receipt has been sent to this email</li>
            <li>If you have any questions or concerns, please don't hesitate to contact our hostel office</li>
          </ul>
          
          <p style="color: #16a34a; font-weight: bold;">We truly appreciate your prompt payment and look forward to welcoming you to our hostel community!</p>
          
          <p>Once again, thank you for choosing <strong>${hostelName}</strong>.</p>
          
          <p style="margin-top: 30px;">Best regards,<br><strong>The ${hostelName} Team</strong></p>
        </div>
        
        <div class="footer">
          <p>This email was sent automatically. Please do not reply to this email.</p>
          <p>Â© 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }
}

