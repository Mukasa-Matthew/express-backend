import { EmailService } from '../services/emailService';
import dotenv from 'dotenv';

dotenv.config();

async function testResendEmail() {
  console.log('🧪 Testing Resend Email Service\n');
  console.log('='.repeat(60));
  
  // Check configuration
  const hasResend = !!process.env.RESEND_API_KEY;
  const hasNodemailer = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
  
  console.log('📋 Email Configuration:');
  console.log(`   RESEND_API_KEY: ${hasResend ? '✅ Set' : '❌ Not set'}`);
  console.log(`   SMTP_USER: ${process.env.SMTP_USER ? '✅ Set' : '❌ Not set'}`);
  console.log(`   SMTP_PASS: ${process.env.SMTP_PASS ? '✅ Set' : '❌ Not set'}`);
  console.log(`   EMAIL_PROVIDER: ${process.env.EMAIL_PROVIDER || 'Auto-detect'}`);
  console.log('='.repeat(60));
  console.log('');

  if (!hasResend && !hasNodemailer) {
    console.error('❌ No email provider configured!');
    console.error('   Set RESEND_API_KEY for Resend or SMTP_USER/SMTP_PASS for Nodemailer');
    process.exit(1);
  }

  // Initialize email service
  console.log('🔧 Initializing email service...');
  EmailService.initialize();
  
  // Verify connection
  console.log('🔍 Verifying email service connection...');
  const isConnected = await EmailService.verifyConnection();
  
  if (!isConnected) {
    console.error('❌ Email service connection failed!');
    process.exit(1);
  }
  
  console.log('');
  console.log('📧 Sending test email...');
  console.log('='.repeat(60));

  const testEmailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Resend Test Email</title>
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
        <h1>✅ Resend Email Test</h1>
        <p>Your email service is working perfectly!</p>
      </div>
      
      <div class="content">
        <h2>Hello!</h2>
        
        <div class="success-box">
          <strong>🎉 Success!</strong>
          <p>This is a test email sent via Resend to confirm your email service is configured correctly.</p>
        </div>
        
        <div class="info-box">
          <h3>Test Details:</h3>
          <p><strong>Provider:</strong> Resend</p>
          <p><strong>Sent At:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Status:</strong> ✅ Working</p>
        </div>
        
        <p>If you received this email, your Resend integration is working correctly!</p>
        
        <p>You can now use the EmailService in your application to send emails.</p>
      </div>
      
      <div class="footer">
        <p>This is a test email from your LTS Portal backend.</p>
        <p>© 2024 LTS Portal. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  try {
    const emailSent = await EmailService.sendEmail({
      to: 'matthewmukasa0@gmail.com',
      subject: '✅ Resend Email Test - LTS Portal',
      html: testEmailHtml,
    });

    console.log('');
    console.log('='.repeat(60));
    
    if (emailSent) {
      console.log('✅ Test email sent successfully!');
      console.log('');
      console.log('📬 Check your inbox: matthewmukasa0@gmail.com');
      console.log('   (Check spam folder if you don\'t see it)');
    } else {
      console.log('❌ Email sending returned false');
      console.log('   Check the logs above for error details');
    }
    
    console.log('='.repeat(60));
  } catch (error: any) {
    console.error('');
    console.error('❌ Error sending test email:');
    console.error('   Message:', error.message);
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testResendEmail()
  .then(() => {
    console.log('');
    console.log('✨ Test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });

