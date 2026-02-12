#!/bin/bash
set -e

echo "=== AGT loadCodeAssist Test ==="

if [ -z "$ADMIN_KEY" ]; then
  echo "ERROR: ADMIN_KEY not set"
  exit 1
fi

if ! curl -s -f http://localhost:19864/health > /dev/null 2>&1; then
  echo "ERROR: Service not running"
  exit 1
fi

ACCOUNTS=$(curl -s -H "Authorization: Bearer $ADMIN_KEY" http://localhost:19864/admin/api/agt/accounts)
ACCOUNT_ID=$(echo "$ACCOUNTS" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$ACCOUNT_ID" ]; then
  echo "SKIP: No AGT accounts"
  exit 0
fi

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "http://localhost:19864/admin/api/agt/refresh-quota/$ACCOUNT_ID" \
  -H "Authorization: Bearer $ADMIN_KEY")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: HTTP $HTTP_CODE"
  exit 1
fi

if echo "$BODY" | grep -q "Invalid JSON payload"; then
  echo "FAIL: 400 error still present"
  exit 1
fi

echo "PASS: loadCodeAssist works"
