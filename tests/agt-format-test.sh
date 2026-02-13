#!/bin/bash

set -e

BASE_URL="${BASE_URL:-http://localhost:19864}"
API_KEY="${API_KEY:-}"
TEST_MODEL="${TEST_MODEL:-gemini-2.0-flash-thinking-exp-01-21}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "=========================================="
echo "AGT 多格式请求测试"
echo "=========================================="
echo "BASE_URL: $BASE_URL"
echo "测试模型: $TEST_MODEL"
echo "=========================================="

if [ -z "$API_KEY" ]; then
    echo -e "${RED}错误: 请设置 API_KEY 环境变量${NC}"
    echo "用法: API_KEY=your_key ./agt-format-test.sh"
    exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0

test_request() {
    local format_name=$1
    local endpoint=$2
    local payload=$3
    local expected_field=$4
    
    echo ""
    echo -e "${BLUE}测试: $format_name${NC}"
    echo "端点: $endpoint"
    
    local response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL$endpoint" \
        -H "Content-Type: application/json" \
        -H "x-api-key: $API_KEY" \
        -H "anthropic-version: 2023-06-01" \
        -d "$payload")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "200" ]; then
        if echo "$body" | jq -e "$expected_field" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ 成功${NC} - HTTP $http_code"
            echo "$body" | jq -C '.' 2>/dev/null | head -20
            PASS_COUNT=$((PASS_COUNT + 1))
        else
            echo -e "${RED}✗ 失败${NC} - 响应格式不正确"
            echo "$body" | jq -C '.' 2>/dev/null || echo "$body"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    else
        echo -e "${RED}✗ 失败${NC} - HTTP $http_code"
        echo "$body" | jq -C '.' 2>/dev/null || echo "$body"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

echo ""
echo "=========================================="
echo "1. Anthropic 格式 (/v1/messages)"
echo "=========================================="

test_request \
    "Anthropic Messages API" \
    "/v1/messages" \
    "{
        \"model\": \"$TEST_MODEL\",
        \"max_tokens\": 100,
        \"messages\": [{
            \"role\": \"user\",
            \"content\": \"Say 'Hello from Anthropic format' and nothing else.\"
        }]
    }" \
    ".content[0].text"

echo ""
echo "=========================================="
echo "2. OpenAI 格式 (/v1/chat/completions)"
echo "=========================================="

test_request \
    "OpenAI Chat Completions API" \
    "/v1/chat/completions" \
    "{
        \"model\": \"$TEST_MODEL\",
        \"max_tokens\": 100,
        \"messages\": [{
            \"role\": \"user\",
            \"content\": \"Say 'Hello from OpenAI format' and nothing else.\"
        }]
    }" \
    ".choices[0].message.content"

echo ""
echo "=========================================="
echo "3. 原生 Antigravity 格式 (/agt/v1/generate)"
echo "=========================================="

test_request \
    "Antigravity Native API" \
    "/agt/v1/generate" \
    "{
        \"model\": \"$TEST_MODEL\",
        \"prompt\": \"Say 'Hello from Antigravity format' and nothing else.\",
        \"max_tokens\": 100
    }" \
    ".text"

echo ""
echo "=========================================="
echo "测试结果汇总"
echo "=========================================="
echo -e "通过: ${GREEN}$PASS_COUNT${NC}"
echo -e "失败: ${RED}$FAIL_COUNT${NC}"
echo "=========================================="

if [ $FAIL_COUNT -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ 所有格式测试通过${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}✗ 部分测试失败${NC}"
    exit 1
fi
