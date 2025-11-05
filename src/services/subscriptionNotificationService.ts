import pool from '../config/database';
import { EmailService } from './emailService';

interface SubscriptionInfo {
  hostel_id: number;
  hostel_name: string;
  admin_email: string;
  admin_name: string;
  plan_name: string;
  end_date: Date;
  status: string;
}

export class SubscriptionNotificationService {
  /**
   * Check and send notifications for expiring subscriptions
   * Runs daily to notify about subscriptions expiring in 30, 15, 7, 3, and 1 days
   */
  static async checkAndNotifyExpiringSubscriptions(): Promise<void> {
    try {
      console.log('🔄 Checking for expiring subscriptions...');

      // Get all active subscriptions
      const subscriptions = await pool.query(`
        SELECT 
          hs.id,
          hs.hostel_id,
          hs.end_date,
          hs.status,
          h.name as hostel_name,
          h.contact_email as hostel_email,
          sp.name as plan_name
        FROM hostel_subscriptions hs
        JOIN hostels h ON hs.hostel_id = h.id
        JOIN subscription_plans sp ON hs.plan_id = sp.id
        WHERE hs.status = 'active'
        ORDER BY hs.end_date ASC
      `);

      const now = new Date();
      const notificationDays = [30, 15, 7, 3, 1];

      for (const sub of subscriptions.rows) {
        const endDate = new Date(sub.end_date);
        const timeDiff = endDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

        // Check if we need to notify for this subscription
        if (notificationDays.includes(daysLeft)) {
          await this.sendExpiringNotification(sub, daysLeft);
        }

        // Also send immediate notification when expired
        if (daysLeft < 0 && sub.status === 'active') {
          await this.sendExpiredNotification(sub);
          // Mark as expired in database
          await pool.query(
            'UPDATE hostel_subscriptions SET status = $1, updated_at = NOW() WHERE id = $2',
            ['expired', sub.id]
          );
        }
      }

      console.log('✅ Subscription notifications check completed');
    } catch (error) {
      console.error('❌ Error checking subscriptions:', error);
    }
  }

  /**
   * Send notification to admin and custodian about expiring subscription
   */
  private static async sendExpiringNotification(sub: any, daysLeft: number): Promise<void> {
    try {
      // Get admin and custodian emails for this hostel
      const users = await pool.query(`
        SELECT email, name, role
        FROM users
        WHERE hostel_id = $1 AND role IN ('hostel_admin', 'custodian')
      `, [sub.hostel_id]);

      if (users.rows.length === 0) {
        console.log(`⚠️ No admin or custodian found for hostel ${sub.hostel_name}`);
        return;
      }

      const endDateFormatted = new Date(sub.end_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Send email to each admin and custodian
      for (const user of users.rows) {
        try {
          const emailHtml = EmailService.generateSubscriptionExpiringEmail(
            user.name,
            sub.hostel_name,
            daysLeft,
            endDateFormatted,
            sub.plan_name
          );

          await EmailService.sendEmail({
            to: user.email,
            subject: `⏰ Subscription Expiring in ${daysLeft} Day${daysLeft !== 1 ? 's' : ''} - ${sub.hostel_name}`,
            html: emailHtml
          });

          console.log(`📧 Sent expiring notification to ${user.email} (${daysLeft} days left)`);
        } catch (emailError) {
          console.error(`Failed to send email to ${user.email}:`, emailError);
        }
      }
    } catch (error) {
      console.error('Error sending expiring notification:', error);
    }
  }

  /**
   * Send notification to admin and custodian about expired subscription
   */
  private static async sendExpiredNotification(sub: any): Promise<void> {
    try {
      // Get admin and custodian emails for this hostel
      const users = await pool.query(`
        SELECT email, name, role
        FROM users
        WHERE hostel_id = $1 AND role IN ('hostel_admin', 'custodian')
      `, [sub.hostel_id]);

      if (users.rows.length === 0) {
        console.log(`⚠️ No admin or custodian found for hostel ${sub.hostel_name}`);
        return;
      }

      const expiredDateFormatted = new Date(sub.end_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Send email to each admin and custodian
      for (const user of users.rows) {
        try {
          const emailHtml = EmailService.generateSubscriptionExpiredEmail(
            user.name,
            sub.hostel_name,
            expiredDateFormatted,
            sub.plan_name
          );

          await EmailService.sendEmail({
            to: user.email,
            subject: `🔴 Subscription Expired - ${sub.hostel_name}`,
            html: emailHtml
          });

          console.log(`📧 Sent expired notification to ${user.email}`);
        } catch (emailError) {
          console.error(`Failed to send email to ${user.email}:`, emailError);
        }
      }
    } catch (error) {
      console.error('Error sending expired notification:', error);
    }
  }

  /**
   * Send notification to Super Admin about expiring subscriptions
   */
  static async notifySuperAdminAboutExpiringSubscriptions(): Promise<void> {
    try {
      // Get all subscriptions expiring in next 30 days
      const expiringSubscriptions = await pool.query(`
        SELECT 
          hs.id,
          hs.hostel_id,
          hs.end_date,
          hs.status,
          h.name as hostel_name,
          h.contact_email as hostel_email,
          sp.name as plan_name
        FROM hostel_subscriptions hs
        JOIN hostels h ON hs.hostel_id = h.id
        JOIN subscription_plans sp ON hs.plan_id = sp.id
        WHERE hs.status = 'active'
          AND hs.end_date BETWEEN NOW() AND (NOW() + INTERVAL '30 days')
        ORDER BY hs.end_date ASC
      `);

      if (expiringSubscriptions.rows.length === 0) {
        return;
      }

      // Get all super admins
      const superAdmins = await pool.query(`
        SELECT email, name
        FROM users
        WHERE role = 'super_admin'
      `);

      if (superAdmins.rows.length === 0) {
        console.log('⚠️ No super admin found');
        return;
      }

      // Send email to each super admin
      for (const admin of superAdmins.rows) {
        try {
          const emailHtml = this.generateSuperAdminExpiringNotificationEmail(
            admin.name,
            expiringSubscriptions.rows
          );

          await EmailService.sendEmail({
            to: admin.email,
            subject: `📊 ${expiringSubscriptions.rows.length} Subscription(s) Expiring Soon`,
            html: emailHtml
          });

          console.log(`📧 Sent super admin notification to ${admin.email}`);
        } catch (emailError) {
          console.error(`Failed to send email to ${admin.email}:`, emailError);
        }
      }
    } catch (error) {
      console.error('Error notifying super admin:', error);
    }
  }

  /**
   * Generate email HTML for super admin about expiring subscriptions
   */
  private static generateSuperAdminExpiringNotificationEmail(
    adminName: string,
    subscriptions: any[]
  ): string {
    const now = new Date();
    
    const subscriptionRows = subscriptions.map(sub => {
      const endDate = new Date(sub.end_date);
      const timeDiff = endDate.getTime() - now.getTime();
      const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
      
      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 12px 8px; vertical-align: top;">${sub.hostel_name}</td>
          <td style="padding: 12px 8px; vertical-align: top;">${sub.plan_name}</td>
          <td style="padding: 12px 8px; vertical-align: top;">${new Date(sub.end_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
          <td style="padding: 12px 8px; vertical-align: top; font-weight: bold; color: ${daysLeft <= 7 ? '#dc2626' : daysLeft <= 15 ? '#ea580c' : '#f59e0b'};">${daysLeft} day${daysLeft !== 1 ? 's' : ''}</td>
        </tr>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Expiring Subscriptions Report</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 700px;
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
          table {
            width: 100%;
            border-collapse: collapse;
            background: #fff;
            border-radius: 8px;
            overflow: hidden;
            margin: 20px 0;
          }
          th {
            background: #667eea;
            color: white;
            padding: 12px 8px;
            text-align: left;
            font-weight: bold;
          }
          td {
            padding: 12px 8px;
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
          <h1>📊 Expiring Subscriptions Report</h1>
        </div>
        <div class="content">
          <h2>Hello ${adminName}!</h2>
          <p>You have <strong>${subscriptions.length}</strong> subscription(s) expiring in the next 30 days that need attention:</p>
          <table>
            <thead>
              <tr>
                <th>Hostel</th>
                <th>Plan</th>
                <th>End Date</th>
                <th>Days Left</th>
              </tr>
            </thead>
            <tbody>
              ${subscriptionRows}
            </tbody>
          </table>
          <p>Please contact these hostels to discuss renewal options.</p>
          <p><strong>The LTS Portal Team</strong></p>
        </div>
        <div class="footer">
          <p>This is an automated report. © 2024 LTS Portal. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }
}





