import { Router } from 'express';
import { KiroClient, KiroApiError } from '../kiro-client.js';
import { EventStreamDecoder, parseKiroEvent } from '../event-parser.js';
import { countTokens, countMessagesTokens, countToolUseTokens } from '../tokenizer.js';
import { createFailoverHandler } from '../failover-handler.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { recordApiStart, recordApiSuccess, recordApiFailure } from './api-new-metrics.js';
import {
  AGT_STATIC_MODELS,
  fetchAntigravityModels,
  isAntigravityModel,
  resolveAntigravityUpstreamModel
} from '../antigravity.js';
import {
  canAccessModel,
  filterModelsByPermission
} from '../user-permissions.js';
import { routeModel } from '../model-router.js';

// 获取模型上下文长度
function getModelContextLength(model, config) {
  const configured = Number(config?.modelContextLength);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  const lower = String(model || '').toLowerCase();
  if (lower.includes('sonnet')) return 200000;
  if (lower.includes('opus')) return 200000;
  if (lower.includes('haiku')) return 200000;
  return 200000;
}

// 标准化上下文使用百分比
function normalizeContextUsagePercentage(value) {
  let pct = Number(value);
  if (!Number.isFinite(pct)) return 0;
  if (pct > 1) pct = pct / 100;
  if (pct < 0) pct = 0;
  if (pct > 1) pct = 1;
  return pct;
}

export function createApiRouter(state) {
  const router = Router();
  
  // 创建故障转移处理器
  const failoverHandler = createFailoverHandler(state.accountPool);

  // User authentication middleware (replaces old API key check)
  const authMiddleware = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] ||
                   req.headers['authorization']?.replace('Bearer ', '');

    if (!apiKey) {
      return res.status(401).json({
        type: 'error',
        error: { type: 'authentication_error', message: 'API key is required' }
      });
    }

    // Get user from database
    const user = state.db.getUserByApiKey(apiKey, 'active');

    if (!user) {
      return res.status(401).json({
        type: 'error',
        error: { type: 'authentication_error', message: 'Invalid API key or user is not active' }
      });
    }

    // Attach user to request
    req.user = user;
    next();
  };

  router.use(authMiddleware);

  function parseJsonSafe(value) {
    if (typeof value !== 'string') return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function hasQuotaForModel(account, modelId) {
    const quotas = parseJsonSafe(account?.model_quotas);
    if (!quotas || typeof quotas !== 'object') return true;
    const info = quotas[modelId];
    if (!info || typeof info !== 'object') return true;
    const remaining = Number(info.remaining_fraction);
    if (!Number.isFinite(remaining)) return true;
    return remaining > 0;
  }

  async function handleAgtClaudeRequest(req, res) {
    const cliproxyUrl = process.env.CLIPROXY_URL || 'http://localhost:19865';
    const cliproxyApiKey = process.env.CLIPROXY_API_KEY || 'zxc123';

    try {
      const response = await fetch(`${cliproxyUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cliproxyApiKey}`,
          'anthropic-version': req.headers['anthropic-version'] || '2023-06-01'
        },
        body: JSON.stringify(req.body)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return res.status(response.status).json(error);
      }

      if (req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        for await (const chunk of response.body) {
          res.write(chunk);
        }
        res.end();
      } else {
        const data = await response.json();
        return res.json(data);
      }
    } catch (error) {
      console.error('[Antigravity Claude] Request failed:', error);
      return res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: `Antigravity request failed: ${error.message}`
        }
      });
    }
  }

  async function handleAgtOpenAIRequest(req, res) {
    const cliproxyUrl = process.env.CLIPROXY_URL || 'http://localhost:19865';
    const cliproxyApiKey = process.env.CLIPROXY_API_KEY || 'zxc123';

    try {
      const response = await fetch(`${cliproxyUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cliproxyApiKey}`
        },
        body: JSON.stringify(req.body)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return res.status(response.status).json(error);
      }

      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error('[AGT OpenAI] Request failed:', error);
      return res.status(500).json({
        error: {
          type: 'api_error',
          message: `AGT request failed: ${error.message}`
        }
      });
    }
  }

  function resolveModelChannel(modelId) {
    return isAntigravityModel(modelId) ? 'agt' : 'kiro';
  }

  function checkModelPermission(req, res, modelId) {
    const channel = resolveModelChannel(modelId);
    const permission = canAccessModel(req.user, modelId, channel);
    if (permission.allowed) return true;

    return res.status(403).json({
      type: 'error',
      error: permission.error
    });
  }

  // GET /v1/models
  router.get('/models', (req, res) => {
    const agtModels = AGT_STATIC_MODELS.map((model) => ({
      id: model.id,
      object: 'model',
      created: 1737158400,
      owned_by: model.owned_by,
      display_name: model.display_name,
      model_type: 'chat',
      max_tokens: 64000
    }));

    const allModels = [
      ...agtModels,
      {
        id: 'claude-sonnet-4-5-20250929',
        object: 'model',
        created: 1727568000,
        owned_by: 'anthropic',
        display_name: 'Claude Sonnet 4.5',
        model_type: 'chat',
        max_tokens: 32000
      },
      {
        id: 'claude-opus-4-5-20251101',
        object: 'model',
        created: 1730419200,
        owned_by: 'anthropic',
        display_name: 'Claude Opus 4.5',
        model_type: 'chat',
        max_tokens: 32000
      },
      {
        id: 'claude-haiku-4-5-20251001',
        object: 'model',
        created: 1727740800,
        owned_by: 'anthropic',
        display_name: 'Claude Haiku 4.5',
        model_type: 'chat',
        max_tokens: 32000
      }
    ];

    const visibleModels = filterModelsByPermission(req.user, allModels, resolveModelChannel);

    res.json({
      object: 'list',
      data: visibleModels
    });
  });

  router.post('/chat/completions', async (req, res) => {
    try {
      if (req.body.stream === true) {
        return res.status(400).json({
          error: {
            type: 'invalid_request_error',
            message: 'Stream mode via /v1/chat/completions is not enabled yet. Use non-stream mode.'
          }
        });
      }

      if (req.body.model) {
        const permissionError = checkModelPermission(req, res, req.body.model);
        if (permissionError !== true) {
          return permissionError;
        }
      }

      return await handleAgtOpenAIRequest(req, res);
    } catch (error) {
      return res.status(500).json({
        error: {
          type: 'api_error',
          message: error.message || 'Request failed'
        }
      });
    }
  });

  // POST /v1/messages (Anthropic 格式 with billing)
  router.post('/messages', async (req, res) => {
    const startTime = Date.now();
    let selected = null;
    let inputTokens = 0;

    try {
      if (req.body.model) {
        const permissionError = checkModelPermission(req, res, req.body.model);
        if (permissionError !== true) {
          return permissionError;
        }
      }

      const route = routeModel(req.body.model, state.accountPool);
      console.log(`[Model Router] ${req.body.model} -> ${route.channel}/${route.model} (${route.reason})`);

      if (route.channel === 'agt') {
        req.body.model = route.model;
        return await handleAgtClaudeRequest(req, res);
      }

      const user = req.user;

      // 记录请求开始
      recordApiStart({
        userId: user.id,
        username: user.username,
        model: req.body.model,
        stream: req.body.stream
      });

      // Estimate input tokens
      try {
        inputTokens = countMessagesTokens(req.body.messages || []);
      } catch (e) {
        console.warn('Failed to estimate input tokens:', e);
        inputTokens = 1000; // Fallback estimate
      }

      // Check balance before making request
      const balanceCheck = state.billing.checkBalance(user, inputTokens);

      if (!balanceCheck.sufficient) {
        return res.status(402).json({
          type: 'error',
          error: {
            type: 'insufficient_balance_error',
            message: `Insufficient balance. Current: $${balanceCheck.currentBalance.toFixed(4)}, Estimated cost: $${balanceCheck.estimatedMaxCost.toFixed(4)}. Please recharge your account.`
          }
        });
      }

      const isStream = req.body.stream === true;

      // 🔥 使用故障转移：自动重试，用户无感知
      // 注意：流式请求一旦开始输出就不能重试（避免重复内容）
      const result = await failoverHandler.executeWithFailover(async (account) => {
        selected = account;
        const kiroClient = new KiroClient(state.config, account.tokenManager);
        
        try {
          const apiResult = await kiroClient.callApiStream(req.body);
          return { ...apiResult, account, isStream };
        } finally {
          // 释放并发计数
          if (account.release) {
            account.release();
          }
        }
      }, { isStream });

      // 解构结果
      const { response, toolNameMap, account } = result;
      selected = account;

      if (isStream) {
        // 流式响应 with billing
        await handleStreamResponseWithBilling(
          res, response, toolNameMap, selected, state, startTime, req.body.model, user, inputTokens
        );
      } else {
        // 非流式响应 with billing
        await handleNonStreamResponseWithBilling(
          res, response, toolNameMap, selected, state, startTime, req.body.model, user, inputTokens
        );
      }

    } catch (error) {
      const duration = Date.now() - startTime;

      // 记录失败指标
      recordApiFailure({
        userId: req.user?.id,
        model: req.body.model,
        error: error.message,
        status: error.status,
        duration
      });

      // 记录错误 (no billing on error)
      if (selected) {
        state.accountPool.addLog({
          accountId: selected.id,
          accountName: selected.name,
          model: req.body.model,
          inputTokens: inputTokens,
          outputTokens: 0,
          durationMs: Date.now() - startTime,
          success: false,
          error: error.message
        });

        // 检查是否是月度请求数达到上限或余额不足
        const isMonthlyLimit = error.status === 402 && 
          (error.message?.includes('MONTHLY_REQUEST_COUNT') || 
           error.message?.includes('reached the limit') ||
           error.message?.includes('insufficient_balance'));
        
        if (isMonthlyLimit) {
          // 将账号标记为不可用
          console.log(`⚠ 账号 ${selected.name} (${selected.id}) 已达月度请求上限或余额不足，标记为不可用`);
          await state.accountPool.markInvalid(selected.id);
          
          // 异步刷新该账号的余额信息，以便下次启动时能正确识别
          state.accountPool.refreshAccountUsage(selected.id).catch(err => {
            console.error(`刷新账号 ${selected.id} 余额失败:`, err.message);
          });
        } else {
          // 增加账号错误计数
          const isRateLimit = error.status === 429 || error.message?.includes('rate') || error.message?.includes('limit');
          state.accountPool.recordError(selected.id, isRateLimit);
        }
      }

      if (error instanceof KiroApiError) {
        try {
          const debugDir = path.join(state.config.dataDir || './data', 'debug');
          await fs.mkdir(debugDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const debugPath = path.join(debugDir, `kiro_error_${stamp}.json`);
          await fs.writeFile(debugPath, JSON.stringify({
            at: new Date().toISOString(),
            status: error.status,
            responseText: error.responseText,
            requestDebug: error.requestDebug
          }, null, 2));
        } catch {
          // ignore debug write failures
        }
      }

      const status = inferHttpStatus(error);
      const errorType = inferAnthropicErrorType(status);
      
      // 提取友好的错误消息
      let errorMessage = error.message;
      
      // 如果是 400 错误且包含 "Improperly formed request"，提供更友好的提示
      if (status === 400 && errorMessage.includes('Improperly formed request')) {
        errorMessage = 'Invalid request format. The conversation may be too long or contain unsupported content.';
      }
      
      // 移除技术细节前缀
      errorMessage = errorMessage.replace(/^API Error \(\d+\):\s*/, '');

      res.status(status).json({
        type: 'error',
        error: { type: errorType, message: errorMessage }
      });
    }
  });

  router.post('/agt/models/refresh', async (req, res) => {
    try {
      const account = await selectAgtAccount();
      const models = await fetchAntigravityModels(state.db, account);
      return res.json({ success: true, data: models });
    } catch (error) {
      return res.status(500).json({
        error: {
          type: 'api_error',
          message: error.message || 'Failed to fetch AGT models'
        }
      });
    }
  });

  return router;
}

function inferHttpStatus(error) {
  const msg = String(error?.message || '');

  // 提取状态码
  const statusMatch = msg.match(/API Error \((\d{3})\):/);
  if (statusMatch) {
    const code = parseInt(statusMatch[1], 10);
    if (Number.isFinite(code)) return code;
  }

  // 兼容旧格式
  const kiroStatusMatch = msg.match(/Kiro API 错误:\s*(\d{3})\b/);
  if (kiroStatusMatch) {
    const code = parseInt(kiroStatusMatch[1], 10);
    if (Number.isFinite(code)) return code;
  }

  if (msg.includes('不支持的模型') || msg.includes('消息数组不能为空')) {
    return 400;
  }

  // 网络/上游异常：偏向 502
  if (msg.includes('FetchError') || msg.includes('ECONN') || msg.includes('ETIMEDOUT')) {
    return 502;
  }

  return 500;
}

function inferAnthropicErrorType(status) {
  if (status === 401) return 'authentication_error';
  if (status === 402) return 'insufficient_balance_error';
  if (status === 429) return 'rate_limit_error';
  if (status === 503) return 'overloaded_error';
  if (status >= 400 && status < 500) return 'invalid_request_error';
  return 'api_error';
}

/**
 * 处理流式响应 (Anthropic 格式) with billing
 */
async function handleStreamResponseWithBilling(res, response, toolNameMap, selected, state, startTime, model, user, estimatedInputTokens) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const messageId = 'msg_' + uuidv4().replace(/-/g, '');
  const decoder = new EventStreamDecoder();
  const toolNameReverse = new Map();
  for (const [originalName, kiroName] of toolNameMap || []) {
    toolNameReverse.set(kiroName, originalName);
  }
  let inputTokens = estimatedInputTokens;
  const modelContextLength = getModelContextLength(model, state.config);
  let outputTokens = 0;
  let contentBlockIndex = 0;
  let thinkingBlockIndex = -1;
  let textBlockIndex = -1;
  let hasToolUse = false;
  let eventCount = 0;
  let outputTextBuffer = '';
  let outputThinkingBuffer = '';
  const toolUseBuffers = new Map(); // toolUseId -> { name, input }

  // thinking 处理状态
  let thinkingBuffer = '';
  let inThinkingBlock = false;
  let thinkingExtracted = false;

  // 工具调用状态跟踪
  const toolBlocks = new Map(); // toolUseId -> blockIndex

  // 发送初始事件
  const messageStart = {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  };
  res.write(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`);

  // 辅助函数：记录成功指标
  function recordMetrics(inputTokens, outputTokens, cost) {
    recordApiSuccess({
      userId: user.id,
      model,
      inputTokens,
      outputTokens,
      duration: Date.now() - startTime,
      cost,
      stream: true
    });
  }

  // 辅助函数：发送 text_delta
  function sendTextDelta(text) {
    if (!text) return;

    outputTextBuffer += text;

    if (textBlockIndex === -1) {
      // 如果有 thinking 块，先结束它
      if (thinkingBlockIndex !== -1) {
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: thinkingBlockIndex
        })}\n\n`);
        thinkingBlockIndex = -1;
      }

      textBlockIndex = contentBlockIndex++;
      res.write(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: textBlockIndex,
        content_block: { type: 'text', text: '' }
      })}\n\n`);
    }

    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: textBlockIndex,
      delta: { type: 'text_delta', text: text }
    })}\n\n`);
  }

  // 辅助函数：发送 thinking_delta
  function sendThinkingDelta(thinking) {
    if (!thinking) return;

    outputThinkingBuffer += thinking;

    if (thinkingBlockIndex === -1) {
      thinkingBlockIndex = contentBlockIndex++;
      res.write(`event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: thinkingBlockIndex,
        content_block: { type: 'thinking', thinking: '' }
      })}\n\n`);
    }

    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: thinkingBlockIndex,
      delta: { type: 'thinking_delta', thinking: thinking }
    })}\n\n`);
  }

  // 辅助函数：处理包含 thinking 标签的内容
  function processContentWithThinking(content) {
    thinkingBuffer += content;

    while (true) {
      if (!inThinkingBlock && !thinkingExtracted) {
        // 查找 <thinking> 开始标签
        const startPos = thinkingBuffer.indexOf('<thinking>');
        if (startPos !== -1) {
          // 发送 <thinking> 之前的内容
          const beforeThinking = thinkingBuffer.substring(0, startPos);
          if (beforeThinking) {
            sendTextDelta(beforeThinking);
          }

          // 进入 thinking 块
          inThinkingBlock = true;
          thinkingBuffer = thinkingBuffer.substring(startPos + '<thinking>'.length);
        } else {
          // 没有找到 <thinking>，保留可能是部分标签的内容
          const safeLen = Math.max(0, thinkingBuffer.length - '<thinking>'.length);
          if (safeLen > 0) {
            const safeContent = thinkingBuffer.substring(0, safeLen);
            sendTextDelta(safeContent);
            thinkingBuffer = thinkingBuffer.substring(safeLen);
          }
          break;
        }
      } else if (inThinkingBlock) {
        // 在 thinking 块内，查找 </thinking> 结束标签
        const endPos = thinkingBuffer.indexOf('</thinking>');
        if (endPos !== -1) {
          // 检查后面是否有双换行符（真正的结束标签）
          const afterTag = thinkingBuffer.substring(endPos + '</thinking>'.length);
          if (afterTag.length >= 2 && afterTag.startsWith('\n\n')) {
            // 提取 thinking 内容
            const thinkingContent = thinkingBuffer.substring(0, endPos);
            if (thinkingContent) {
              sendThinkingDelta(thinkingContent);
            }

            // 结束 thinking 块
            inThinkingBlock = false;
            thinkingExtracted = true;

            // 关闭 thinking 块
            if (thinkingBlockIndex !== -1) {
              res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                type: 'content_block_stop',
                index: thinkingBlockIndex
              })}\n\n`);
            }

            thinkingBuffer = afterTag.substring(2); // 跳过 \n\n
          } else if (afterTag.length < 2) {
            // 等待更多内容
            break;
          } else {
            // 不是真正的结束标签，继续搜索
            const thinkingContent = thinkingBuffer.substring(0, endPos + '</thinking>'.length);
            sendThinkingDelta(thinkingContent);
            thinkingBuffer = afterTag;
          }
        } else {
          // 没有找到结束标签，发送当前内容
          const safeLen = Math.max(0, thinkingBuffer.length - '</thinking>'.length);
          if (safeLen > 0) {
            const safeContent = thinkingBuffer.substring(0, safeLen);
            sendThinkingDelta(safeContent);
            thinkingBuffer = thinkingBuffer.substring(safeLen);
          }
          break;
        }
      } else {
        // thinking 已提取完成，剩余内容作为 text_delta
        if (thinkingBuffer) {
          sendTextDelta(thinkingBuffer);
          thinkingBuffer = '';
        }
        break;
      }
    }
  }

  try {
    for await (const chunk of response.body) {
      decoder.feed(chunk);

      for (const frame of decoder.decode()) {
        const event = parseKiroEvent(frame);
        if (!event || !event.data) continue;

        eventCount++;
        const eventType = event.type;
        const data = event.data;

        if (eventType === 'assistantResponseEvent') {
          const content = data.content || '';
          if (!content) continue;

          // 处理内容（可能包含 thinking 标签）
          processContentWithThinking(content);

        } else if (eventType === 'toolUseEvent') {
          // 工具调用事件
          hasToolUse = true;
          const toolUseId = data.toolUseId;
          const toolName = toolNameReverse.get(data.name) || data.name;
          const toolInput = data.input || '';
          const isStop = data.stop || false;

          // 累积工具调用到 buffer
          if (!toolUseBuffers.has(toolUseId)) {
            toolUseBuffers.set(toolUseId, { name: toolName, input: '' });
          }
          toolUseBuffers.get(toolUseId).input += toolInput;

          // 如果是新的工具调用，先结束文本块
          if (!toolBlocks.has(toolUseId)) {
            // flush thinking buffer
            if (thinkingBuffer) {
              if (inThinkingBlock) {
                sendThinkingDelta(thinkingBuffer);
              } else {
                sendTextDelta(thinkingBuffer);
              }
              thinkingBuffer = '';
            }

            if (textBlockIndex !== -1) {
              res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                type: 'content_block_stop',
                index: textBlockIndex
              })}\n\n`);
              textBlockIndex = -1;
            }

            const toolBlockIndex = contentBlockIndex++;
            toolBlocks.set(toolUseId, toolBlockIndex);

            res.write(`event: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: toolBlockIndex,
              content_block: {
                type: 'tool_use',
                id: toolUseId,
                name: toolName,
                input: {}
              }
            })}\n\n`);
          }

          const toolBlockIndex = toolBlocks.get(toolUseId);

          if (toolInput) {
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              index: toolBlockIndex,
              delta: { type: 'input_json_delta', partial_json: toolInput }
            })}\n\n`);
          }

          if (isStop) {
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({
              type: 'content_block_stop',
              index: toolBlockIndex
            })}\n\n`);
          }

        } else if (eventType === 'contextUsageEvent') {
          const percentage = normalizeContextUsagePercentage(data.contextUsagePercentage || 0);
          const estimated = Math.round(percentage * modelContextLength);
          if (estimated > inputTokens) {
            inputTokens = estimated;
          }
        }
      }
    }

    // flush 剩余的 thinking buffer
    if (thinkingBuffer) {
      if (inThinkingBlock) {
        sendThinkingDelta(thinkingBuffer);
        if (thinkingBlockIndex !== -1) {
          res.write(`event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: thinkingBlockIndex
          })}\n\n`);
        }
      } else {
        sendTextDelta(thinkingBuffer);
      }
      thinkingBuffer = '';
    }

    // 结束最后的 content block
    if (textBlockIndex !== -1) {
      res.write(`event: content_block_stop\ndata: ${JSON.stringify({
        type: 'content_block_stop',
        index: textBlockIndex
      })}\n\n`);
    }

    // 确定 stop_reason
    const stopReason = hasToolUse ? 'tool_use' : 'end_turn';

    // 使用 tiktoken 计算输出 token
    outputTokens = countTokens(outputTextBuffer) + countTokens(outputThinkingBuffer) + countToolUseTokens(toolUseBuffers);

    // 发送最终事件
    res.write(`event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: inputTokens, output_tokens: outputTokens }
    })}\n\n`);

    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);

    res.end();

    // Record request and charge user (transaction)
    try {
      const billingResult = state.billing.recordRequestAndCharge({
        user_id: user.id,
        user_api_key: user.api_key,
        kiro_account_id: selected.id,
        kiro_account_name: selected.name,
        model: model,
        input_tokens: inputTokens || 0,
        output_tokens: outputTokens,
        duration_ms: Date.now() - startTime,
        success: true,
        timestamp: new Date().toISOString()
      });

      console.log(`✓ Billed user ${user.username}: $${billingResult.cost.toFixed(6)} (${model})`);
      recordMetrics(inputTokens, outputTokens, billingResult.cost);
    } catch (billingError) {
      console.error('Billing error:', billingError);
      // Note: Response already sent, but billing failed
      // This should be logged for manual review
    }

    // Also log to old system for compatibility
    state.accountPool.addLog({
      accountId: selected.id,
      accountName: selected.name,
      model: model,
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens,
      durationMs: Date.now() - startTime,
      success: true
    });

  } catch (error) {
    res.end();
  }
}

/**
 * 处理非流式响应 (Anthropic 格式) with billing
 */
async function handleNonStreamResponseWithBilling(res, response, toolNameMap, selected, state, startTime, model, user, estimatedInputTokens) {
  const decoder = new EventStreamDecoder();
  let textContent = '';
  let thinkingContent = '';
  const toolUses = [];
  let inputTokens = estimatedInputTokens;
  const modelContextLength = getModelContextLength(model, state.config);
  let outputTokens = 0;
  const toolNameReverse = new Map();
  for (const [originalName, kiroName] of toolNameMap || []) {
    toolNameReverse.set(kiroName, originalName);
  }

  // 工具调用 JSON 缓冲区
  const toolJsonBuffers = new Map();

  try {
    // node-fetch v3 的 body 是一个 ReadableStream
    for await (const chunk of response.body) {
      decoder.feed(chunk);

      for (const frame of decoder.decode()) {
        const event = parseKiroEvent(frame);
        if (!event || !event.data) continue;

        const eventType = event.type;
        const data = event.data;

        if (eventType === 'thinkingEvent') {
          thinkingContent += data.thinking || '';
        } else if (eventType === 'assistantResponseEvent') {
          textContent += data.content || '';
        } else if (eventType === 'toolUseEvent') {
          const toolUseId = data.toolUseId;
          const toolName = toolNameReverse.get(data.name) || data.name;
          const toolInput = data.input || '';
          const isStop = data.stop || false;

          // 累积工具的 JSON 输入
          if (!toolJsonBuffers.has(toolUseId)) {
            toolJsonBuffers.set(toolUseId, { name: toolName, input: '' });
          }
          toolJsonBuffers.get(toolUseId).input += toolInput;

          // 如果是完整的工具调用，添加到列表
          if (isStop) {
            const buffer = toolJsonBuffers.get(toolUseId);
            try {
              const input = JSON.parse(buffer.input);
              toolUses.push({
                type: 'tool_use',
                id: toolUseId,
                name: buffer.name,
                input: input
              });
            } catch (e) {
              toolUses.push({
                type: 'tool_use',
                id: toolUseId,
                name: buffer.name,
                input: {}
              });
            }
          }
        } else if (eventType === 'contextUsageEvent') {
          const percentage = normalizeContextUsagePercentage(data.contextUsagePercentage || 0);
          const estimated = Math.round(percentage * modelContextLength);
          if (estimated > inputTokens) {
            inputTokens = estimated;
          }
        }
      }
    }

    // 构建响应内容
    const content = [];

    if (thinkingContent) {
      content.push({
        type: 'thinking',
        thinking: thinkingContent
      });
    }

    if (textContent) {
      content.push({
        type: 'text',
        text: textContent
      });
    }

    content.push(...toolUses);

    // 使用 tiktoken 计算输出 tokens
    outputTokens = countTokens(textContent) + countTokens(thinkingContent) + countToolUseTokens(toolJsonBuffers);

    const messageId = 'msg_' + uuidv4().replace(/-/g, '');
    const stopReason = toolUses.length > 0 ? 'tool_use' : 'end_turn';

    res.json({
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: content,
      model: model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens || 0,
        output_tokens: outputTokens
      }
    });

    // Record request and charge user (transaction)
    try {
      const billingResult = state.billing.recordRequestAndCharge({
        user_id: user.id,
        user_api_key: user.api_key,
        kiro_account_id: selected.id,
        kiro_account_name: selected.name,
        model: model,
        input_tokens: inputTokens || 0,
        output_tokens: outputTokens,
        duration_ms: Date.now() - startTime,
        success: true,
        timestamp: new Date().toISOString()
      });

      console.log(`✓ Billed user ${user.username}: $${billingResult.cost.toFixed(6)} (${model})`);
      
      // 记录成功指标
      recordApiSuccess({
        userId: user.id,
        model,
        inputTokens,
        outputTokens,
        duration: Date.now() - startTime,
        cost: billingResult.cost,
        stream: false
      });

    } catch (billingError) {
      console.error('Billing error:', billingError);
      // Note: Response already sent, but billing failed
      // This should be logged for manual review
    }

    // Also log to old system for compatibility
    state.accountPool.addLog({
      accountId: selected.id,
      accountName: selected.name,
      model: model,
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens,
      durationMs: Date.now() - startTime,
      success: true
    });

  } catch (error) {
    throw error;
  }
}
