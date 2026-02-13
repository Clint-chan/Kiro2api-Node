#!/bin/bash

# Kiro 账号压力测试脚本
# 测试 Kiro 渠道在高并发下的稳定性

set -e

# 配置
BASE_URL="${BASE_URL:-http://localhost:19864}"
API_KEY="${API_KEY:-}"
CONCURRENT_REQUESTS="${CONCURRENT_REQUESTS:-10}"
TOTAL_REQUESTS="${TOTAL_REQUESTS:-50}"
MODEL="${MODEL:-claude-sonnet-4}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "Kiro 渠道压力测试"
echo "=========================================="
echo "BASE_URL: $BASE_URL"
echo "并发数: $CONCURRENT_REQUESTS"
echo "总请求数: $TOTAL_REQUESTS"
echo "模型: $MODEL"
echo "=========================================="

if [ -z "$API_KEY" ]; then
    echo -e "${RED}错误: 请设置 API_KEY 环境变量${NC}"
    echo "用法: API_KEY=your_key ./kiro-stress-test.sh"
    exit 1
fi

# 创建临时目录
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

SUCCESS_COUNT=0
FAIL_COUNT=0
TOTAL_TIME=0

# 单个请求函数
make_request() {
    local request_id=$1
    local start_time=$(date +%s%3N)
    
    local response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/messages" \
        -H "Content-Type: application/json" \
        -H "x-api-key: $API_KEY" \
        -H "anthropic-version: 2023-06-01" \
        -d "{
            \"model\": \"$MODEL\",
            \"max_tokens\": 100,
            \"messages\": [{
                \"role\": \"user\",
                \"content\": \"Say 'Test $request_id' and nothing else.\"
            }]
        }")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)
    local end_time=$(date +%s%3N)
    local duration=$((end_time - start_time))
    
    if [ "$http_code" = "200" ]; then
        echo "$request_id|SUCCESS|$duration" >> "$TEMP_DIR/results.txt"
        echo -e "${GREEN}✓${NC} Request $request_id: ${duration}ms"
    else
        echo "$request_id|FAIL|$duration|$http_code" >> "$TEMP_DIR/results.txt"
        echo -e "${RED}✗${NC} Request $request_id: HTTP $http_code (${duration}ms)"
        echo "$body" | jq -r '.error.message // .error // .' 2>/dev/null || echo "$body"
    fi
}

export -f make_request
export BASE_URL API_KEY MODEL TEMP_DIR GREEN RED NC

# 执行压力测试
echo ""
echo "开始压力测试..."
echo ""

seq 1 $TOTAL_REQUESTS | xargs -P $CONCURRENT_REQUESTS -I {} bash -c 'make_request {}'

# 统计结果
echo ""
echo "=========================================="
echo "测试结果统计"
echo "=========================================="

SUCCESS_COUNT=$(grep -c "SUCCESS" "$TEMP_DIR/results.txt" || echo 0)
FAIL_COUNT=$(grep -c "FAIL" "$TEMP_DIR/results.txt" || echo 0)

if [ $SUCCESS_COUNT -gt 0 ]; then
    AVG_TIME=$(awk -F'|' '/SUCCESS/ {sum+=$3; count++} END {if(count>0) print int(sum/count); else print 0}' "$TEMP_DIR/results.txt")
    MIN_TIME=$(awk -F'|' '/SUCCESS/ {print $3}' "$TEMP_DIR/results.txt" | sort -n | head -1)
    MAX_TIME=$(awk -F'|' '/SUCCESS/ {print $3}' "$TEMP_DIR/results.txt" | sort -n | tail -1)
else
    AVG_TIME=0
    MIN_TIME=0
    MAX_TIME=0
fi

SUCCESS_RATE=$(awk "BEGIN {printf \"%.2f\", ($SUCCESS_COUNT / $TOTAL_REQUESTS) * 100}")

echo "总请求数: $TOTAL_REQUESTS"
echo -e "成功: ${GREEN}$SUCCESS_COUNT${NC}"
echo -e "失败: ${RED}$FAIL_COUNT${NC}"
echo -e "成功率: ${GREEN}${SUCCESS_RATE}%${NC}"
echo ""
echo "响应时间统计 (成功请求):"
echo "  平均: ${AVG_TIME}ms"
echo "  最小: ${MIN_TIME}ms"
echo "  最大: ${MAX_TIME}ms"
echo "=========================================="

# 失败详情
if [ $FAIL_COUNT -gt 0 ]; then
    echo ""
    echo "失败请求详情:"
    grep "FAIL" "$TEMP_DIR/results.txt" | while IFS='|' read -r id status duration code; do
        echo "  Request $id: HTTP $code (${duration}ms)"
    done
fi

# 退出码
if [ $FAIL_COUNT -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ 所有请求成功${NC}"
    exit 0
else
    echo ""
    echo -e "${YELLOW}⚠ 部分请求失败${NC}"
    exit 1
fi
