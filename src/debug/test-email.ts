import { EmailService } from '../services/emailService';

async function testEmail() {
  try {
    console.log('📧 Testing email configuration...');
    
    // Check if email is configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('⚠️  Email not configured - will use console logging');
      console.log('   SMTP_USER:', process.env.SMTP_USER ? 'Set' : 'Not set');
      console.log('   SMTP_PASS:', process.env.SMTP_PASS ? 'Set' : 'Not set');
    } else {
      console.log('✅ Email configuration found');
      console.log('   SMTP_USER:', process.env.SMTP_USER);
      console.log('   SMTP_PASS:', process.env.SMTP_PASS ? 'Set' : 'Not set');
    }
    
    // Test sending an email
    const testEmailHtml = EmailService.generateHostelAdminWelcomeEmail(
      'Test User',
      'matthewkesh950@gmail.com',
      'matthewkesh950@gmail.com',
      'TestPassword123',
      'Test Hostel',
      'http://localhost:3000/login'
    );
    
    const emailSent = await EmailService.sendEmail({
      to: 'matthewkesh950@gmail.com',
      subject: 'Test Email - LTS Portal',
      html: testEmailHtml
    });
    
    if (emailSent) {
      console.log('✅ Test email sent successfully');
    } else {
      console.log('❌ Test email failed');
    }
    
  } catch (error) {
    console.error('❌ Error testing email:', error);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  testEmail()
    .then(() => {
      console.log('🎉 Email test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Email test failed:', error);
      process.exit(1);
    });
}

export default testEmail;
