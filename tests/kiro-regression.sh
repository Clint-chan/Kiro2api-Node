#!/bin/bash
set -e

echo "=== Kiro Regression Test ==="

if [ -z "$ADMIN_KEY" ]; then
  echo "ERROR: ADMIN_KEY not set"
  exit 1
fi

if ! curl -s -f http://localhost:19864/health > /dev/null 2>&1; then
  echo "ERROR: Service not running"
  exit 1
fi

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:19864/admin/api/accounts)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: Kiro API broken (HTTP $HTTP_CODE)"
  exit 1
fi

if ! echo "$BODY" | grep -q '"data"'; then
  echo "FAIL: Response missing 'data' field"
  exit 1
fi

echo "PASS: Kiro works"
