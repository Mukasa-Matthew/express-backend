#!/bin/bash
# Script to find credentials in PM2 logs

echo "Searching for credentials in PM2 logs..."
echo "=========================================="
echo ""

# Check the last 500 lines of the output log
pm2 logs express-backend --lines 500 --nostream | grep -A 20 "FALLBACK: TEMPORARY LOGIN CREDENTIALS"

# Also check error log for any credential information
echo ""
echo "Checking error log..."
pm2 logs express-backend --err --lines 200 --nostream | grep -A 20 "TEMPORARY CREDENTIALS\|Username\|Password"

# Check for the specific email address
echo ""
echo "Searching for magezirichardelijah@gmail.com credentials..."
pm2 logs express-backend --lines 1000 --nostream | grep -B 10 -A 20 "magezirichardelijah@gmail.com"






















