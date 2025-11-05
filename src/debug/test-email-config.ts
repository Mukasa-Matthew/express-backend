import { EmailService } from '../services/emailService';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testEmailConfiguration() {
  console.log('🧪 Testing Email Configuration...\n');

  // Check if email is configured
  const isConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
  
  console.log('📧 Email Configuration Status:');
  console.log(`   SMTP_HOST: ${process.env.SMTP_HOST || 'smtp.gmail.com'}`);
  console.log(`   SMTP_PORT: ${process.env.SMTP_PORT || '587'}`);
  console.log(`   SMTP_USER: ${process.env.SMTP_USER ? '✅ Set' : '❌ Not set'}`);
  console.log(`   SMTP_PASS: ${process.env.SMTP_PASS ? '✅ Set' : '❌ Not set'}`);
  console.log(`   SMTP_FROM: ${process.env.SMTP_FROM || 'Not set'}`);
  console.log(`   Configuration: ${isConfigured ? '✅ Ready' : '❌ Not configured'}\n`);

  if (!isConfigured) {
    console.log('❌ Email is not configured. Please:');
    console.log('   1. Create a .env file in the backend directory');
    console.log('   2. Add your SMTP credentials');
    console.log('   3. See EMAIL_CONFIG.md for detailed instructions\n');
    return;
  }

  // Test email sending
  console.log('📤 Testing email sending...');
  
  try {
    const testEmailHtml = EmailService.generateHostelAdminWelcomeEmail(
      'Test Admin',
      'test@example.com',
      'test@example.com',
      'TestPassword123',
      'Test Hostel',
      'http://localhost:3000/login'
    );

    const emailSent = await EmailService.sendEmail({
      to: process.env.SMTP_USER!, // Send to yourself for testing
      subject: '🧪 LTS Portal - Email Configuration Test',
      html: testEmailHtml
    });

    if (emailSent) {
      console.log('✅ Email test successful!');
      console.log(`   Check your inbox: ${process.env.SMTP_USER}`);
      console.log('   If you don\'t see it, check your spam folder.\n');
    } else {
      console.log('❌ Email test failed. Check the error messages above.\n');
    }

  } catch (error) {
    console.error('❌ Email test error:', error);
    console.log('\n💡 Troubleshooting tips:');
    console.log('   1. Verify your SMTP credentials are correct');
    console.log('   2. Make sure 2FA is enabled on Gmail (if using Gmail)');
    console.log('   3. Use App Password, not your regular password');
    console.log('   4. Check your internet connection');
    console.log('   5. See EMAIL_CONFIG.md for detailed setup instructions\n');
  }
}

// Run the test
testEmailConfiguration().catch(console.error);
