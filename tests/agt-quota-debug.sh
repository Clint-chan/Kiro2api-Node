#!/bin/bash

set -e

BASE_URL="${BASE_URL:-http://localhost:19864}"
ADMIN_KEY="${ADMIN_KEY:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "=========================================="
echo "AGT 额度诊断工具"
echo "=========================================="
echo "BASE_URL: $BASE_URL"
echo "=========================================="

if [ -z "$ADMIN_KEY" ]; then
    echo -e "${RED}错误: 请设置 ADMIN_KEY 环境变量${NC}"
    echo "用法: ADMIN_KEY=your_admin_key ./agt-quota-debug.sh"
    exit 1
fi

echo ""
echo -e "${BLUE}步骤 1: 获取 AGT 账号列表${NC}"
echo "=========================================="

ACCOUNTS_RESPONSE=$(curl -s -X GET "$BASE_URL/api/admin/agt-accounts" \
    -H "x-admin-key: $ADMIN_KEY" \
    -H "Content-Type: application/json")

echo "$ACCOUNTS_RESPONSE" | jq '.' 2>/dev/null || echo "$ACCOUNTS_RESPONSE"

ACCOUNT_COUNT=$(echo "$ACCOUNTS_RESPONSE" | jq -r '.data | length' 2>/dev/null || echo "0")
echo ""
echo -e "找到 ${GREEN}$ACCOUNT_COUNT${NC} 个 AGT 账号"

if [ "$ACCOUNT_COUNT" = "0" ]; then
    echo -e "${RED}没有 AGT 账号，请先导入账号${NC}"
    exit 1
fi

FIRST_ACCOUNT_ID=$(echo "$ACCOUNTS_RESPONSE" | jq -r '.data[0].id' 2>/dev/null)
FIRST_ACCOUNT_NAME=$(echo "$ACCOUNTS_RESPONSE" | jq -r '.data[0].name' 2>/dev/null)
MODEL_QUOTAS=$(echo "$ACCOUNTS_RESPONSE" | jq -r '.data[0].model_quotas' 2>/dev/null)
NEXT_RESET=$(echo "$ACCOUNTS_RESPONSE" | jq -r '.data[0].next_reset' 2>/dev/null)

echo ""
echo "第一个账号信息:"
echo "  ID: $FIRST_ACCOUNT_ID"
echo "  名称: $FIRST_ACCOUNT_NAME"
echo "  model_quotas: $MODEL_QUOTAS"
echo "  next_reset: $NEXT_RESET"

echo ""
echo -e "${BLUE}步骤 2: 刷新该账号的额度${NC}"
echo "=========================================="

REFRESH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/admin/agt-accounts/$FIRST_ACCOUNT_ID/refresh-usage" \
    -H "x-admin-key: $ADMIN_KEY" \
    -H "Content-Type: application/json")

HTTP_CODE=$(echo "$REFRESH_RESPONSE" | tail -n1)
BODY=$(echo "$REFRESH_RESPONSE" | head -n-1)

echo "HTTP 状态码: $HTTP_CODE"
echo ""
echo "响应内容:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"

if [ "$HTTP_CODE" != "200" ]; then
    echo ""
    echo -e "${RED}刷新失败！${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}步骤 3: 再次获取账号列表，检查额度是否更新${NC}"
echo "=========================================="

sleep 1

ACCOUNTS_RESPONSE_AFTER=$(curl -s -X GET "$BASE_URL/api/admin/agt-accounts" \
    -H "x-admin-key: $ADMIN_KEY" \
    -H "Content-Type: application/json")

MODEL_QUOTAS_AFTER=$(echo "$ACCOUNTS_RESPONSE_AFTER" | jq -r '.data[0].model_quotas' 2>/dev/null)
NEXT_RESET_AFTER=$(echo "$ACCOUNTS_RESPONSE_AFTER" | jq -r '.data[0].next_reset' 2>/dev/null)

echo "刷新后的账号信息:"
echo "  model_quotas: $MODEL_QUOTAS_AFTER"
echo "  next_reset: $NEXT_RESET_AFTER"

echo ""
echo "=========================================="
echo "诊断结果"
echo "=========================================="

if [ "$MODEL_QUOTAS_AFTER" = "null" ] || [ "$MODEL_QUOTAS_AFTER" = "" ]; then
    echo -e "${RED}✗ model_quotas 为空${NC}"
    echo "  可能原因："
    echo "  1. fetchAntigravityModelsWithMeta 返回的数据结构不对"
    echo "  2. extractQuotaMeta 解析失败"
    echo "  3. AGT API 没有返回 quotaInfo"
else
    echo -e "${GREEN}✓ model_quotas 有数据${NC}"
    echo "$MODEL_QUOTAS_AFTER" | jq '.' 2>/dev/null
fi

if [ "$NEXT_RESET_AFTER" = "null" ] || [ "$NEXT_RESET_AFTER" = "" ]; then
    echo -e "${RED}✗ next_reset 为空${NC}"
else
    echo -e "${GREEN}✓ next_reset 有数据: $NEXT_RESET_AFTER${NC}"
fi

echo ""
echo -e "${BLUE}步骤 4: 测试 AGT 反代功能${NC}"
echo "=========================================="

TEST_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/messages" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $ADMIN_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d '{
        "model": "antigravity-gemini-2.0-flash-thinking-exp-01-21",
        "max_tokens": 50,
        "messages": [{
            "role": "user",
            "content": "Say hello"
        }]
    }')

TEST_HTTP_CODE=$(echo "$TEST_RESPONSE" | tail -n1)
TEST_BODY=$(echo "$TEST_RESPONSE" | head -n-1)

echo "HTTP 状态码: $TEST_HTTP_CODE"
echo ""

if [ "$TEST_HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ AGT 反代正常工作${NC}"
    echo "$TEST_BODY" | jq '.content[0].text' 2>/dev/null || echo "$TEST_BODY"
else
    echo -e "${RED}✗ AGT 反代失败${NC}"
    echo "$TEST_BODY" | jq '.' 2>/dev/null || echo "$TEST_BODY"
fi

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="
