# Email Troubleshooting Guide

## Problem: Admin Didn't Receive Email with Temporary Credentials

When a hostel is registered, the system attempts to send an email with temporary credentials to the admin. If the email fails, the credentials are logged to the server console as a fallback.

## Quick Solutions

### Option 1: Check Server Logs for Credentials

If email sending failed, the credentials were logged to the console. Check your server logs:

```bash
# If using PM2
pm2 logs backend --lines 100

# If using systemd
journalctl -u backend -n 100

# Or check your log file
tail -n 100 /path/to/your/logfile.log
```

Look for a section that looks like this:
```
📋 FALLBACK: TEMPORARY LOGIN CREDENTIALS
======================================================================
To: admin@example.com
Hostel: Your Hostel Name
Admin Name: Admin Name
──────────────────────────────────────────────────────────────────────
🔐 TEMPORARY CREDENTIALS:
   Username/Email: admin@example.com
   Password: [password here]
──────────────────────────────────────────────────────────────────────
```

### Option 2: Resend Credentials via API

You can resend credentials using the resend-credentials endpoint:

**Endpoint:** `POST /api/hostels/:id/resend-credentials`

**Requirements:**
- Must be authenticated as super_admin
- Need the hostel ID

**Example using curl:**
```bash
curl -X POST http://your-server:5000/api/hostels/HOSTEL_ID/resend-credentials \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Example using the frontend:**
- Go to the Hostels page
- Find the hostel that was created
- Look for a "Resend Credentials" button or action

### Option 3: Verify Email Configuration

Check if email service is properly configured on your server:

#### For Resend (Recommended for Production)

1. Check if `RESEND_API_KEY` is set in your `.env` file:
```bash
cd /path/to/express-backend
cat .env | grep RESEND_API_KEY
```

2. If not set, add it:
```env
RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@yourdomain.com
EMAIL_PROVIDER=resend
```

3. Get a Resend API key:
   - Sign up at https://resend.com
   - Create an API key
   - Verify your domain (required for sending from custom domain)
   - Or use `onboarding@resend.dev` for testing (limited)

#### For SMTP (Alternative)

1. Check if SMTP credentials are set:
```bash
cat .env | grep SMTP
```

2. If not set, add them:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
EMAIL_PROVIDER=nodemailer
```

**Note for Gmail:**
- You need to use an App Password, not your regular password
- Enable 2FA on your Google account
- Generate an App Password: https://myaccount.google.com/apppasswords

### Option 4: Test Email Configuration

Use the test email script to verify email works:

```bash
cd /path/to/express-backend
npm run ts-node src/debug/send-test-email.ts
```

Or create a test script:

```bash
# Create test-email.sh
cat > test-email.sh << 'EOF'
#!/bin/bash
cd /path/to/express-backend
npx ts-node src/debug/send-test-email.ts
EOF

chmod +x test-email.sh
./test-email.sh
```

## Common Issues

### 1. Email Not Configured

**Symptoms:**
- Server logs show "⚠️  No email provider configured"
- Credentials logged to console instead of email sent

**Solution:**
- Configure either Resend or SMTP in your `.env` file
- Restart the backend server

### 2. Resend API Key Invalid

**Symptoms:**
- Server logs show Resend errors
- Email sending fails

**Solution:**
- Verify your Resend API key is correct
- Check Resend dashboard for any issues
- Ensure domain is verified if using custom domain

### 3. SMTP Authentication Failed

**Symptoms:**
- Server logs show SMTP authentication errors
- Email sending fails

**Solution:**
- Verify SMTP credentials are correct
- For Gmail, use App Password instead of regular password
- Check if 2FA is enabled (required for App Passwords)
- Verify SMTP port (587 for TLS, 465 for SSL)

### 4. Email Sent But Not Received

**Symptoms:**
- Server logs show "✅ Email sent successfully"
- Admin didn't receive email

**Solution:**
- Check spam/junk folder
- Verify email address is correct
- Check if email provider is blocking emails
- For Resend, check the Resend dashboard for delivery status

### 5. Domain Not Verified (Resend)

**Symptoms:**
- Resend errors about unverified domain
- Can't send from custom domain

**Solution:**
- Verify your domain in Resend dashboard
- Add required DNS records
- Or use `onboarding@resend.dev` for testing

## Best Practices

1. **Use Resend for Production:**
   - More reliable delivery
   - Better deliverability
   - Built for transactional emails

2. **Always Check Server Logs:**
   - Credentials are always logged as fallback
   - Helps diagnose email issues

3. **Test Email Configuration:**
   - Use test email script before going live
   - Verify emails are received

4. **Monitor Email Service:**
   - Check Resend dashboard regularly
   - Monitor email delivery rates
   - Set up alerts for failures

## Next Steps

1. Check server logs for credentials (Option 1)
2. If credentials found, share them with the admin
3. Configure email service properly (Option 3)
4. Test email configuration (Option 4)
5. Resend credentials once email is working (Option 2)






















