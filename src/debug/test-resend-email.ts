import { EmailService } from '../services/emailService';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function sendTestEmailWithResend() {
  // Use your verified email address for testing
  const testEmail = process.env.TEST_EMAIL || 'matthewmukasa0@gmail.com';
  
  console.log('🧪 Testing Resend Email Service...\n');
  console.log('📧 Email Configuration:');
  console.log(`   RESEND_API_KEY: ${process.env.RESEND_API_KEY ? '✅ Set (' + process.env.RESEND_API_KEY.substring(0, 10) + '...)' : '❌ Not set'}`);
  console.log(`   RESEND_FROM_EMAIL: ${process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev (default)'}`);
  console.log(`   EMAIL_PROVIDER: ${process.env.EMAIL_PROVIDER || 'auto-detect'}`);
  console.log(`\n📬 Sending test email to: ${testEmail}\n`);

  // Initialize email service
  EmailService.initialize();

  try {
    // Generate a simple test email HTML
    const testEmailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
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
        </style>
      </head>
      <body>
        <div class="header">
          <h1>✅ Test Email Successful!</h1>
          <p>Resend Email Service is Working</p>
        </div>
        <div class="content">
          <h2>Hello!</h2>
          <div class="success-box">
            <strong>🎉 Congratulations!</strong>
            <p>If you're reading this, your Resend email configuration is working correctly!</p>
          </div>
          <p>This is a test email sent from your LTS Portal backend using Resend.</p>
          <p><strong>Test Details:</strong></p>
          <ul>
            <li>Sent at: ${new Date().toLocaleString()}</li>
            <li>From: ${process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'}</li>
            <li>To: ${testEmail}</li>
            <li>Provider: Resend</li>
          </ul>
          <p>Your email service is properly configured and ready to send emails to hostel admins!</p>
          <p><strong>The LTS Portal Team</strong></p>
        </div>
      </body>
      </html>
    `;

    console.log('📤 Attempting to send email via Resend...\n');
    
    const emailSent = await EmailService.sendEmail({
      to: testEmail,
      subject: '🧪 LTS Portal - Resend Test Email',
      html: testEmailHtml
    });

    if (emailSent) {
      console.log('\n✅ SUCCESS! Email sent successfully via Resend!');
      console.log(`📬 Check the inbox for: ${testEmail}`);
      console.log('   (Also check spam/junk folder if not in inbox)\n');
      console.log('💡 Note: If you\'re in Resend test mode, you can only send to your verified email.');
      console.log('   To send to other addresses, verify a domain at https://resend.com/domains\n');
    } else {
      console.log('\n❌ FAILED! Email was not sent.');
      console.log('   Check the error messages above for details.\n');
      console.log('💡 Troubleshooting:');
      console.log('   1. Verify RESEND_API_KEY is set correctly in .env');
      console.log('   2. Check if you\'re in test mode (can only send to verified email)');
      console.log('   3. Verify your domain at https://resend.com/domains');
      console.log('   4. Check Resend dashboard for any errors\n');
    }

  } catch (error: any) {
    console.error('\n❌ ERROR sending test email:');
    console.error('   Message:', error.message);
    console.error('   Code:', error.code);
    if (error.response) {
      console.error('   Response:', error.response);
    }
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    console.log('\n💡 Common Issues:');
    console.log('   1. RESEND_API_KEY not set or invalid');
    console.log('   2. Test mode: Can only send to verified email address');
    console.log('   3. Domain not verified: Need to verify domain to send to other addresses');
    console.log('   4. Invalid from email: Must use verified domain or onboarding@resend.dev\n');
  }
}

// Run the test
sendTestEmailWithResend()
  .then(() => {
    console.log('🎉 Test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });
