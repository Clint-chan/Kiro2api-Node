#!/bin/bash

# Permission Check Test Script
# Tests Opus model permission logic for different API keys

BASE_URL="http://localhost:19864"
API_KEY="${1:-${ANTHROPIC_API_KEY}}"

if [ -z "$API_KEY" ]; then
  echo "Error: API_KEY not provided. Usage: $0 <api_key>"
  exit 1
fi

# Test counters
TOTAL=0
PASSED=0
FAILED=0

# Helper function to run test
run_test() {
  local test_name="$1"
  local model="$2"
  local api_key="$3"
  local expected_status="$4"
  
  TOTAL=$((TOTAL + 1))
  
  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/messages" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $api_key" \
    -H "anthropic-version: 2023-06-01" \
    -d "{\"model\":\"$model\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}")
  
  http_code=$(echo "$response" | tail -n 1)
  body=$(echo "$response" | head -n -1)
  
  if [ "$http_code" = "$expected_status" ]; then
    echo "✓ Test $TOTAL: $test_name - HTTP $http_code (PASS)"
    PASSED=$((PASSED + 1))
  else
    echo "✗ Test $TOTAL: $test_name - HTTP $http_code (FAIL, expected $expected_status)"
    FAILED=$((FAILED + 1))
  fi
}

echo "=== Permission Check Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Kiro permission + Opus model → 403
run_test "Kiro + Opus (should be 403)" "claude-opus-4" "$API_KEY" "403"

# Test 2: Kiro permission + Sonnet model → 200
run_test "Kiro + Sonnet (should be 200)" "claude-sonnet-4" "$API_KEY" "200"

# Test 3: Antigravity permission + Opus model → 200
# Note: Replace with actual Antigravity API key
ANTIGRAVITY_KEY="${2:-${ANTIGRAVITY_API_KEY}}"
if [ -n "$ANTIGRAVITY_KEY" ]; then
  run_test "Antigravity + Opus (should be 200)" "claude-opus-4" "$ANTIGRAVITY_KEY" "200"
else
  echo "⊘ Test 3: Antigravity + Opus - SKIPPED (no Antigravity API key provided)"
  TOTAL=$((TOTAL + 1))
fi

# Test 4: Antigravity exclusive model → 200
if [ -n "$ANTIGRAVITY_KEY" ]; then
  run_test "Antigravity exclusive model (should be 200)" "gemini-2.0-flash-thinking-exp" "$ANTIGRAVITY_KEY" "200"
else
  echo "⊘ Test 4: Antigravity exclusive model - SKIPPED (no Antigravity API key provided)"
  TOTAL=$((TOTAL + 1))
fi

echo ""
echo "=== Test Summary ==="
echo "Total: $TOTAL"
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [ $FAILED -eq 0 ]; then
  exit 0
else
  exit 1
fi
