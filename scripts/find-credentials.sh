#!/bin/bash
# Quick script to find credentials in logs

echo "🔍 Searching for hostel admin credentials..."
echo "============================================"
echo ""

# Search in PM2 logs
echo "1. Checking PM2 output logs..."
pm2 logs express-backend --lines 2000 --nostream 2>/dev/null | grep -B 10 -A 20 "TEMPORARY CREDENTIALS\|FALLBACK.*CREDENTIALS" | head -50

echo ""
echo "2. Searching for specific email address..."
pm2 logs express-backend --lines 2000 --nostream 2>/dev/null | grep -B 5 -A 15 "magezirichardelijah" | head -30

echo ""
echo "3. Checking log files directly..."
if [ -f ~/.pm2/logs/express-backend-out.log ]; then
    echo "   Found output log, searching..."
    grep -A 20 "TEMPORARY CREDENTIALS\|FALLBACK" ~/.pm2/logs/express-backend-out.log | tail -30
fi

echo ""
echo "4. Checking for password generation logs..."
pm2 logs express-backend --lines 2000 --nostream 2>/dev/null | grep -B 5 -A 10 "Password:\|temporaryPassword\|generatePatternPassword" | head -20

echo ""
echo "============================================"
echo "💡 If credentials not found above:"
echo "   1. Check if the hostel was created recently"
echo "   2. Look for 'FALLBACK' or 'TEMPORARY CREDENTIALS' in the logs"
echo "   3. Check the error log: pm2 logs express-backend --err --lines 500"
echo "   4. Use the resend-credentials endpoint after fixing email config"
echo ""










































