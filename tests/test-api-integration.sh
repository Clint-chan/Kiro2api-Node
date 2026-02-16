#!/bin/bash

echo "============================================================"
echo "API 集成测试 - 模型组过滤功能"
echo "============================================================"

ADMIN_KEY="zxc13875517127"
BASE_URL="http://localhost:19864"

echo ""
echo "✓ 测试 1: 获取 Antigravity 账号列表"
ACCOUNTS=$(curl -s -H "x-admin-key: $ADMIN_KEY" "$BASE_URL/api/admin/" 2>/dev/null)
ACCOUNT_COUNT=$(echo "$ACCOUNTS" | jq -r '.data | length' 2>/dev/null)
echo "  找到 $ACCOUNT_COUNT 个账号"

if [ "$ACCOUNT_COUNT" = "0" ] || [ "$ACCOUNT_COUNT" = "null" ]; then
  echo "  ⚠ 没有账号数据，无法继续测试"
  exit 0
fi

# 获取第一个账号
ACCOUNT_NAME=$(echo "$ACCOUNTS" | jq -r '.data[0].name' 2>/dev/null)
echo "  测试账号: $ACCOUNT_NAME"

echo ""
echo "✓ 测试 2: 检查账号配额信息"
MODEL_QUOTAS=$(echo "$ACCOUNTS" | jq -r '.data[0].model_quotas' 2>/dev/null)
if [ "$MODEL_QUOTAS" = "null" ]; then
  echo "  ⚠ 账号没有配额信息"
else
  MODEL_COUNT=$(echo "$MODEL_QUOTAS" | jq -r 'keys | length' 2>/dev/null)
  echo "  配额模型数: $MODEL_COUNT"
  
  # 显示前3个模型的配额
  echo "$MODEL_QUOTAS" | jq -r 'to_entries | .[0:3] | .[] | "    \(.key): \((.value.remaining_fraction * 100) | floor)% 剩余"' 2>/dev/null
fi

echo ""
echo "✓ 测试 3: 检查模型组禁用状态"
THRESHOLD_STATUS=$(curl -s -H "x-admin-key: $ADMIN_KEY" "$BASE_URL/api/admin/cliproxy/threshold-status?name=$ACCOUNT_NAME" 2>/dev/null)
echo "  原始响应:"
echo "$THRESHOLD_STATUS" | jq '.' 2>/dev/null || echo "$THRESHOLD_STATUS"

DISABLED_GROUPS=$(echo "$THRESHOLD_STATUS" | jq -r '.disabled_groups // {}' 2>/dev/null)
DISABLED_COUNT=$(echo "$DISABLED_GROUPS" | jq -r 'keys | length' 2>/dev/null)
echo "  禁用组数: $DISABLED_COUNT"

if [ "$DISABLED_COUNT" != "0" ] && [ "$DISABLED_COUNT" != "null" ]; then
  echo "  禁用的模型组:"
  echo "$DISABLED_GROUPS" | jq -r 'to_entries | .[] | "    \(.key): \(.value.reason)"' 2>/dev/null
else
  echo "  无禁用组"
fi

echo ""
echo "✓ 测试 4: 测试实际请求路由"
echo "  发送测试请求到 /v1internal:fetchAvailableModels"

# 需要一个有效的用户 API key
USER_API_KEY=$(curl -s -H "x-admin-key: $ADMIN_KEY" "$BASE_URL/api/admin/users" 2>/dev/null | jq -r '.data[0].api_key' 2>/dev/null)

if [ "$USER_API_KEY" = "null" ] || [ -z "$USER_API_KEY" ]; then
  echo "  ⚠ 无法获取用户 API key，跳过请求测试"
else
  echo "  使用 API key: ${USER_API_KEY:0:20}..."
  
  MODELS_RESPONSE=$(curl -s -H "x-api-key: $USER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{}' \
    "$BASE_URL/v1internal:fetchAvailableModels" 2>/dev/null)
  
  MODEL_LIST=$(echo "$MODELS_RESPONSE" | jq -r '.models // [] | length' 2>/dev/null)
  echo "  返回模型数: $MODEL_LIST"
  
  if [ "$MODEL_LIST" != "0" ] && [ "$MODEL_LIST" != "null" ]; then
    echo "  前5个模型:"
    echo "$MODELS_RESPONSE" | jq -r '.models[0:5] | .[] | "    - \(.)"' 2>/dev/null
  fi
fi

echo ""
echo "✓ 测试 5: 验证过滤逻辑"
echo "  测试模型: gpt-4o, claude-sonnet-4, gemini-3-pro, gemini-3-flash"

# 检查每个模型是否应该被过滤
for MODEL in "gpt-4o" "claude-sonnet-4-20250514" "gemini-3-pro" "gemini-3-flash"; do
  # 确定模型组
  if [[ "$MODEL" =~ ^(claude-|gpt-|o[0-9]) ]]; then
    GROUP="claude_gpt"
  elif [ "$MODEL" = "gemini-3-pro" ]; then
    GROUP="gemini_3_pro"
  elif [ "$MODEL" = "gemini-3-flash" ]; then
    GROUP="gemini_3_flash"
  else
    GROUP="unknown"
  fi
  
  # 检查配额
  QUOTA=$(echo "$MODEL_QUOTAS" | jq -r ".\"$MODEL\".remaining_fraction // null" 2>/dev/null)
  if [ "$QUOTA" = "null" ]; then
    QUOTA_STATUS="N/A"
  else
    QUOTA_PCT=$(echo "$QUOTA * 100" | bc 2>/dev/null | cut -d. -f1)
    QUOTA_STATUS="${QUOTA_PCT}%"
  fi
  
  # 检查是否被禁用
  IS_DISABLED=$(echo "$DISABLED_GROUPS" | jq -r "has(\"$GROUP\")" 2>/dev/null)
  if [ "$IS_DISABLED" = "true" ]; then
    STATUS="✗ 被过滤"
  else
    STATUS="✓ 可用"
  fi
  
  echo "  $MODEL:"
  echo "    组: $GROUP"
  echo "    配额: $QUOTA_STATUS"
  echo "    状态: $STATUS"
done

echo ""
echo "============================================================"
echo "API 集成测试完成！"
echo "============================================================"
