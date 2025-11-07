# Fix Resend Test Mode Issue

## Problem
Resend is in test mode and can only send emails to your verified email address (`matthewmukasa0@gmail.com`). It cannot send to other recipients like `magezirichardelijah@gmail.com`.

## Quick Fix Options

### Option 1: Verify Your Domain (Recommended for Production)

1. **Go to Resend Dashboard:**
   - Visit https://resend.com/domains
   - Click "Add Domain"
   - Enter your domain (e.g., `yourdomain.com`)

2. **Add DNS Records:**
   - Resend will provide DNS records to add
   - Add them to your domain's DNS settings
   - Wait for verification (usually a few minutes)

3. **Update .env file:**
   ```env
   RESEND_FROM_EMAIL=noreply@yourdomain.com
   ```

4. **Restart backend:**
   ```bash
   pm2 restart express-backend
   ```

### Option 2: Use Your Verified Email for Testing (Temporary Workaround)

For now, you can temporarily send test emails to your own email address to verify the system works:

1. **Update .env to use your verified email:**
   ```env
   RESEND_FROM_EMAIL=matthewmukasa0@gmail.com
   ```
   
   **Note:** This might not work if Resend doesn't allow `from` to be the same as your verified email. In that case, you need to verify a domain.

### Option 3: Use SMTP Instead (Alternative)

If you can't verify a domain right now, use Gmail SMTP:

1. **Enable 2FA on Gmail:**
   - Go to https://myaccount.google.com/security
   - Enable 2-Step Verification

2. **Generate App Password:**
   - Go to https://myaccount.google.com/apppasswords
   - Generate an app password for "Mail"
   - Copy the 16-character password

3. **Update .env:**
   ```env
   # Comment out or remove Resend
   # RESEND_API_KEY=...
   
   # Add SMTP configuration
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=matthewmukasa0@gmail.com
   SMTP_PASS=your-16-char-app-password
   SMTP_FROM=matthewmukasa0@gmail.com
   EMAIL_PROVIDER=nodemailer
   ```

4. **Restart backend:**
   ```bash
   pm2 restart express-backend
   ```

### Option 4: Find Credentials in Logs

The credentials were logged when the email failed. Check the logs:

```bash
# Check the last 1000 lines for credentials
pm2 logs express-backend --lines 1000 --nostream | grep -B 5 -A 15 "magezirichardelijah\|TEMPORARY CREDENTIALS\|Username\|Password"

# Or search the log files directly
grep -r "magezirichardelijah" ~/.pm2/logs/
grep -r "TEMPORARY CREDENTIALS" ~/.pm2/logs/
```

### Option 5: Reset Password via API

If you can't find the credentials, reset them:

```bash
# Get your super admin token from the frontend (check localStorage or login)
# Then call the resend-credentials endpoint

curl -X POST http://64.23.169.136:5000/api/hostels/HOSTEL_ID/resend-credentials \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Note:** You'll need to fix the email configuration first, otherwise the email will fail again.

## Recommended Solution

For production, **verify your domain in Resend**. This is the proper solution that will:
- Allow sending to any email address
- Improve deliverability
- Make emails look more professional
- Avoid test mode limitations

## Temporary Workaround

Until you verify a domain, you can:
1. Use SMTP (Gmail) as a temporary solution
2. Or manually share credentials with the admin after finding them in logs





