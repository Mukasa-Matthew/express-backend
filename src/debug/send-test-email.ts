import { EmailService } from '../services/emailService';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function sendTestEmail() {
  const testEmail = 'matthewmukasa11@gmail.com';
  
  console.log('🧪 Sending Test Email...\n');
  console.log('📧 Email Configuration:');
  console.log(`   SMTP_HOST: ${process.env.SMTP_HOST || 'smtp.gmail.com'}`);
  console.log(`   SMTP_PORT: ${process.env.SMTP_PORT || '587'}`);
  console.log(`   SMTP_USER: ${process.env.SMTP_USER ? '✅ Set (' + process.env.SMTP_USER + ')' : '❌ Not set'}`);
  console.log(`   SMTP_PASS: ${process.env.SMTP_PASS ? '✅ Set' : '❌ Not set'}`);
  console.log(`   SMTP_FROM: ${process.env.SMTP_FROM || process.env.SMTP_USER || 'Not set'}`);
  console.log(`\n📬 Sending test email to: ${testEmail}\n`);

  // Initialize email service
  EmailService.initialize();

  try {
    // Generate test email HTML
    const testEmailHtml = EmailService.generateHostelAdminWelcomeEmail(
      'Test Admin User',
      testEmail,
      testEmail,
      'TestPassword123!',
      'Test Hostel',
      'http://localhost:3000/login',
      {
        planName: 'Test Plan',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        durationMonths: 1,
        pricePerMonth: 100,
        totalPrice: 100,
        amountPaid: 0,
        paymentReference: 'TEST-REF-123'
      }
    );

    console.log('📤 Attempting to send email...\n');
    
    const emailSent = await EmailService.sendEmail({
      to: testEmail,
      subject: '🧪 LTS Portal - Test Email',
      html: testEmailHtml
    });

    if (emailSent) {
      console.log('\n✅ SUCCESS! Email sent successfully!');
      console.log(`📬 Check the inbox for: ${testEmail}`);
      console.log('   (Also check spam/junk folder if not in inbox)\n');
    } else {
      console.log('\n❌ FAILED! Email was not sent.');
      console.log('   Check the error messages above for details.\n');
    }

  } catch (error: any) {
    console.error('\n❌ ERROR sending test email:');
    console.error('   Message:', error.message);
    console.error('   Code:', error.code);
    if (error.response) {
      console.error('   SMTP Response:', error.response);
    }
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Verify SMTP_USER and SMTP_PASS are set in .env');
    console.log('   2. For Gmail: Use App Password (not regular password)');
    console.log('   3. Enable 2FA on Gmail account');
    console.log('   4. Check firewall/network settings');
    console.log('   5. Verify SMTP_HOST and SMTP_PORT are correct\n');
  }
}

// Run the test
sendTestEmail()
  .then(() => {
    console.log('🎉 Test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });

