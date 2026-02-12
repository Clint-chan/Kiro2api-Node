import fetch from 'node-fetch';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export class KiroApiError extends Error {
  constructor(status, responseText, requestDebug) {
    // 解析响应文本，提取实际错误信息
    let errorMessage = responseText;
    try {
      const parsed = JSON.parse(responseText);
      if (parsed.message) {
        errorMessage = parsed.message;
      }
    } catch {
      // 保持原始文本
    }
    
    super(`API Error (${status}): ${errorMessage}`);
    this.name = 'ApiError';
    this.status = status;
    this.responseText = responseText;
    this.requestDebug = requestDebug;
  }
}

/**
 * Kiro API 客户端
 * 负责与 Kiro API 通信，支持流式和非流式请求
 */
export class KiroClient {
  constructor(config, tokenManager) {
    this.config = config;
    this.tokenManager = tokenManager;
  }

  sanitizeToolName(name) {
    const raw = String(name ?? '');
    const replaced = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');
    const trimmed = replaced.replace(/^_+|_+$/g, '');
    const safe = trimmed.length > 0 ? trimmed : 'tool';
    return /^[0-9]/.test(safe) ? `t_${safe}` : safe;
  }

  getOrCreateKiroToolName(originalName, toolNameMap, usedNames) {
    if (toolNameMap.has(originalName)) return toolNameMap.get(originalName);
    const base = this.sanitizeToolName(originalName);
    let candidate = base;
    let i = 2;
    while (usedNames.has(candidate)) {
      candidate = `${base}_${i++}`;
    }
    usedNames.add(candidate);
    toolNameMap.set(originalName, candidate);
    return candidate;
  }

  safeJsonStringify(value, fallback = '{}') {
    if (value == null) return fallback;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  normalizeJsonObject(value, fallback = {}) {
    if (value == null) return fallback;
    let normalized = value;

    if (typeof normalized === 'string') {
      try {
        normalized = JSON.parse(normalized);
      } catch {
        return fallback;
      }
    }

    if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) {
      return fallback;
    }

    return normalized;
  }

  summarizeForDebug(value, depth = 0) {
    if (depth > 6) return '[MaxDepth]';
    if (value === null) return null;
    const t = typeof value;
    if (t === 'string') {
      // 对于字符串，如果太长则截断
      if (value.length > 500) {
        return `<string len=${value.length} preview="${value.substring(0, 200)}...${value.substring(value.length - 100)}">`;
      }
      return `<string len=${value.length}>`;
    }
    if (t === 'number' || t === 'boolean') return value;
    if (t !== 'object') return `<${t}>`;
    if (Array.isArray(value)) {
      return {
        _type: 'array',
        length: value.length,
        sample: value.slice(0, 3).map(v => this.summarizeForDebug(v, depth + 1))
      };
    }
    const keys = Object.keys(value).slice(0, 60);
    const out = { _type: 'object', keys };
    for (const k of keys) {
      out[k] = this.summarizeForDebug(value[k], depth + 1);
    }
    return out;
  }

  /**
   * 模型映射：Anthropic 模型名 -> Kiro 模型 ID
   */
  mapModel(model) {
    const lower = model.toLowerCase();
    if (lower.includes('sonnet')) return 'claude-sonnet-4.5';
    if (lower.includes('opus')) return 'claude-opus-4.5';
    if (lower.includes('haiku')) return 'claude-haiku-4.5';
    return null;
  }

  /**
   * 构建请求头
   */
  buildHeaders(token) {
    const region = this.config.region || 'us-east-1';
    const kiroVersion = this.config.kiroVersion || '0.8.0';
    const machineId = this.tokenManager.credentials.machineId || crypto.randomBytes(32).toString('hex');
    
    const osName = 'windows';
    const nodeVersion = '20.0.0';
    
    const xAmzUserAgent = `aws-sdk-js/1.0.27 KiroIDE-${kiroVersion}-${machineId}`;
    const userAgent = `aws-sdk-js/1.0.27 ua/2.1 os/${osName} lang/js md/nodejs#${nodeVersion} api/codewhispererstreaming#1.0.27 m/E KiroIDE-${kiroVersion}-${machineId}`;

    return {
      'Content-Type': 'application/json',
      'x-amzn-codewhisperer-optout': 'true',
      'x-amzn-kiro-agent-mode': 'vibe',
      'x-amz-user-agent': xAmzUserAgent,
      'User-Agent': userAgent,
      'Host': `q.${region}.amazonaws.com`,
      'amz-sdk-invocation-id': uuidv4(),
      'amz-sdk-request': 'attempt=1; max=3',
      'Authorization': `Bearer ${token}`,
      'Connection': 'close'
    };
  }

  /**
   * 将 Anthropic 请求转换为 Kiro 请求
   */
  convertRequest(anthropicReq) {
    const modelId = this.mapModel(anthropicReq.model);
    if (!modelId) {
      throw new Error(`不支持的模型: ${anthropicReq.model}`);
    }

    const toolNameMap = new Map();
    const usedToolNames = new Set();

    const messages = anthropicReq.messages || [];
    if (messages.length === 0) {
      throw new Error('消息数组不能为空');
    }

    // 限制历史消息数量（仅在配置了 MAX_HISTORY_TURNS 时生效）
    let limitedMessages = messages;
    const maxHistoryTurns = process.env.MAX_HISTORY_TURNS ? parseInt(process.env.MAX_HISTORY_TURNS) : null;
    
    if (maxHistoryTurns && messages.length > maxHistoryTurns * 2) {
      console.warn(`⚠ 对话历史过长 (${messages.length} 条消息)，截取最近 ${maxHistoryTurns * 2} 条`);
      // 保留系统消息（如果有）和最近的消息
      const systemMessages = messages.filter(m => m.role === 'system');
      const nonSystemMessages = messages.filter(m => m.role !== 'system');
      const recentMessages = nonSystemMessages.slice(-maxHistoryTurns * 2);
      limitedMessages = [...systemMessages, ...recentMessages];
    }

    const conversationId = uuidv4();
    const agentContinuationId = uuidv4();

    // 合并末尾连续的 user 消息
    let currentStart = limitedMessages.length;
    while (currentStart > 0 && limitedMessages[currentStart - 1].role === 'user') {
      currentStart--;
    }
    const currentUserMessages = limitedMessages.slice(currentStart);

    // 检查是否末尾是 assistant 消息
    const endsWithAssistant = currentUserMessages.length === 0 && 
                              limitedMessages.length > 0 && 
                              limitedMessages[limitedMessages.length - 1].role === 'assistant';

    // 生成 thinking 前缀
    let thinkingPrefix = null;
    if (anthropicReq.thinking && anthropicReq.thinking.type === 'enabled') {
      const budgetTokens = anthropicReq.thinking.budget_tokens || 10000;
      thinkingPrefix = `<thinking_mode>enabled</thinking_mode><max_thinking_length>${budgetTokens}</max_thinking_length>`;
    }

    // 构建历史消息
    const history = [];
    
    // 处理 system prompt
    if (anthropicReq.system) {
      const systemContent = typeof anthropicReq.system === 'string' 
        ? anthropicReq.system 
        : (Array.isArray(anthropicReq.system) 
            ? anthropicReq.system.map(s => s.text).join('\n')
            : '');
      
      if (systemContent) {
        let finalContent = systemContent;
        if (thinkingPrefix && !systemContent.includes('<thinking_mode>') && !systemContent.includes('<max_thinking_length>')) {
          finalContent = `${thinkingPrefix}\n${systemContent}`;
        }
        
        history.push({
          userInputMessage: {
            content: finalContent,
            modelId,
            origin: 'AI_EDITOR'
          }
        });
        history.push({
          assistantResponseMessage: {
            content: 'I will follow these instructions.'
          }
        });
      }
    } else if (thinkingPrefix) {
      history.push({
        userInputMessage: {
          content: thinkingPrefix,
          modelId,
          origin: 'AI_EDITOR'
        }
      });
      history.push({
        assistantResponseMessage: {
          content: 'I will follow these instructions.'
        }
      });
    }

    // 处理历史消息
    const historyEnd = endsWithAssistant ? limitedMessages.length : currentStart;
    let userBuffer = [];
    
    for (let i = 0; i < historyEnd; i++) {
      const msg = limitedMessages[i];
      if (msg.role === 'user') {
        userBuffer.push(msg);
      } else if (msg.role === 'assistant') {
        if (userBuffer.length > 0) {
          const mergedUser = this.mergeUserMessages(userBuffer, modelId);
          history.push({ userInputMessage: mergedUser });
          userBuffer = [];
        }
        
        const { text, toolUses } = this.extractAssistantContent(msg.content, toolNameMap, usedToolNames);
        const assistantMsg = { content: text };
        if (toolUses.length > 0) {
          assistantMsg.toolUses = toolUses;
        }
        history.push({ assistantResponseMessage: assistantMsg });
      }
    }
    
    // 处理结尾的孤立 user 消息
    if (userBuffer.length > 0) {
      const mergedUser = this.mergeUserMessages(userBuffer, modelId);
      history.push({ userInputMessage: mergedUser });
      history.push({ assistantResponseMessage: { content: 'OK' } });
    }

    // 处理末尾的 user 消息组作为 current_message
    let currentText = '';
    let allToolResults = [];
    
    if (endsWithAssistant) {
      currentText = 'continue';
    } else {
      const textParts = [];
      for (const msg of currentUserMessages) {
        const { text, toolResults } = this.extractUserContent(msg.content);
        if (text) {
          textParts.push(text);
        }
        allToolResults.push(...toolResults);
      }
      currentText = textParts.join('\n') || 'continue';
    }

    // 配对验证逻辑
    const { validatedResults, orphanedToolUseIds } = this.validateToolPairing(history, allToolResults);
    this.removeOrphanedToolUses(history, orphanedToolUseIds);
    allToolResults = validatedResults;

    // 构建工具定义
    const tools = (anthropicReq.tools || [])
      .filter(t => !this.isUnsupportedTool(t.name))
      .map(t => ({
        toolSpecification: {
          name: this.getOrCreateKiroToolName(t.name, toolNameMap, usedToolNames),
          description: (t.description || '').slice(0, 10000),
          inputSchema: { json: this.normalizeJsonObject(t.input_schema || {}) }
        }
      }));

    // 构建 userInputMessageContext
    const userInputMessageContext = {};
    if (tools.length > 0) {
      userInputMessageContext.tools = tools;
    }
    if (allToolResults.length > 0) {
      userInputMessageContext.toolResults = allToolResults;
    }

    // 确定触发类型
    let chatTriggerType = 'MANUAL';
    if (anthropicReq.tools && anthropicReq.tools.length > 0) {
      if (anthropicReq.tool_choice) {
        const tcType = anthropicReq.tool_choice.type;
        if (tcType === 'any' || tcType === 'tool') {
          chatTriggerType = 'AUTO';
        }
      }
    }

    // 构建 Kiro 请求 - 注意字段顺序要与 Rust 版本一致
    const kiroRequest = {
      conversationState: {
        agentContinuationId,
        agentTaskType: 'vibe',
        chatTriggerType,
        currentMessage: {
          userInputMessage: {
            content: currentText,
            modelId,
            origin: 'AI_EDITOR'
          }
        },
        conversationId,
        history
      }
    };

    if (Object.keys(userInputMessageContext).length > 0) {
      kiroRequest.conversationState.currentMessage.userInputMessage.userInputMessageContext = userInputMessageContext;
    }

    // 添加 profileArn
    if (this.tokenManager.credentials.profileArn) {
      kiroRequest.profileArn = this.tokenManager.credentials.profileArn;
    }

    // 检查请求大小
    const requestSize = JSON.stringify(kiroRequest).length;
    if (requestSize > 1000000) { // 1MB
      console.warn(`⚠ 请求体过大: ${(requestSize / 1024).toFixed(2)} KB (history: ${history.length} items, toolResults: ${allToolResults.length})`);
    }

    return { kiroRequest, toolNameMap };
  }

  /**
   * 检查是否为不支持的工具
   */
  isUnsupportedTool(name) {
    const lower = name.toLowerCase();
    return lower === 'web_search' || lower === 'websearch';
  }

  /**
   * 提取文本内容
   */
  extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
    return '';
  }

  /**
   * 提取用户消息内容
   */
  extractUserContent(content) {
    if (!content) return { text: '', toolResults: [] };
    if (typeof content === 'string') return { text: content, toolResults: [] };
    
    const textParts = [];
    const toolResults = [];
    const MAX_TOOL_RESULT_LENGTH = parseInt(process.env.MAX_TOOL_RESULT_LENGTH) || 50000; // 限制单个工具结果的最大长度
    
    for (const block of content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_result') {
        let resultContent = typeof block.content === 'string' 
          ? block.content 
          : (Array.isArray(block.content) 
              ? block.content.map(c => c.text || '').join('\n')
              : '');
        
        // 如果工具结果太长，截断它
        if (resultContent.length > MAX_TOOL_RESULT_LENGTH) {
          console.warn(`⚠ 工具结果过长 (${resultContent.length} 字符)，截断到 ${MAX_TOOL_RESULT_LENGTH} 字符`);
          resultContent = resultContent.substring(0, MAX_TOOL_RESULT_LENGTH) + 
                         `\n\n[... truncated ${resultContent.length - MAX_TOOL_RESULT_LENGTH} characters ...]`;
        }
        
        toolResults.push({
          toolUseId: block.tool_use_id,
          status: block.is_error ? 'error' : 'success',
          content: [
            { text: resultContent }
          ]
        });
      }
    }
    
    return { text: textParts.join('\n'), toolResults };
  }

  /**
   * 提取助手消息内容
   */
  extractAssistantContent(content, toolNameMap = new Map(), usedToolNames = new Set()) {
    if (typeof content === 'string') return { text: content, toolUses: [] };
    
    let thinkingContent = '';
    const textParts = [];
    const toolUses = [];
    
    for (const block of content || []) {
      if (block.type === 'thinking') {
        thinkingContent += block.thinking || '';
      } else if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        if (this.isUnsupportedTool(block.name)) continue;
        toolUses.push({
          toolUseId: block.id,
          name: this.getOrCreateKiroToolName(block.name, toolNameMap, usedToolNames),
          input: this.normalizeJsonObject(block.input || {})
        });
      }
    }
    
    let finalText = '';
    if (thinkingContent) {
      if (textParts.length > 0) {
        finalText = `<thinking>${thinkingContent}</thinking>\n\n${textParts.join('\n')}`;
      } else {
        finalText = `<thinking>${thinkingContent}</thinking>`;
      }
    } else {
      finalText = textParts.join('\n');
    }

    if (!finalText && toolUses.length > 0) {
      finalText = 'OK';
    }
    
    return { text: finalText, toolUses };
  }

  /**
   * 合并多个 user 消息
   */
  mergeUserMessages(messages, modelId) {
    const contentParts = [];
    const allToolResults = [];
    
    for (const msg of messages) {
      const { text, toolResults } = this.extractUserContent(msg.content);
      if (text) {
        contentParts.push(text);
      }
      allToolResults.push(...toolResults);
    }
    
    const content = contentParts.join('\n') || (allToolResults.length > 0 ? 'continue' : '');
    const userMsg = {
      content,
      modelId,
      origin: 'AI_EDITOR'
    };
    
    if (allToolResults.length > 0) {
      userMsg.userInputMessageContext = {
        toolResults: allToolResults
      };
    }
    
    return userMsg;
  }

   /**
    * 验证并过滤 tool_use/tool_result 配对
    * 
    * 收集所有 tool_use_id，验证 tool_result 是否匹配
    * 静默跳过孤立的 tool_use 和 tool_result，输出警告日志
    * 
    * @param {Array} history - 历史消息数组
    * @param {Array} toolResults - 当前消息中的 tool_result 列表
    * @returns {Object} { validatedResults: Array, orphanedToolUseIds: Set }
    */
   validateToolPairing(history, toolResults) {
     // 1. 收集所有历史中的 tool_use_id
     const allToolUseIds = new Set();
     // 2. 收集历史中已经有 tool_result 的 tool_use_id
     const historyToolResultIds = new Set();

     for (const msg of history) {
       if (msg.assistantResponseMessage?.toolUses) {
         for (const toolUse of msg.assistantResponseMessage.toolUses) {
           allToolUseIds.add(toolUse.toolUseId);
         }
       }
       if (msg.userInputMessage?.userInputMessageContext?.toolResults) {
         for (const result of msg.userInputMessage.userInputMessageContext.toolResults) {
           historyToolResultIds.add(result.toolUseId);
         }
       }
     }

     // 3. 计算真正未配对的 tool_use_ids（排除历史中已配对的）
     const unpairedToolUseIds = new Set();
     for (const id of allToolUseIds) {
       if (!historyToolResultIds.has(id)) {
         unpairedToolUseIds.add(id);
       }
     }

     // 4. 过滤并验证当前消息的 tool_results
     const filteredResults = [];
     const orphanedResults = [];

     for (const result of toolResults) {
       if (unpairedToolUseIds.has(result.toolUseId)) {
         // 配对成功
         filteredResults.push(result);
         unpairedToolUseIds.delete(result.toolUseId);
       } else if (allToolUseIds.has(result.toolUseId)) {
         // tool_use 存在但已经在历史中配对过了，这是重复的 tool_result
         console.warn(
           `⚠ 跳过重复的 tool_result：该 tool_use 已在历史中配对，tool_use_id=${result.toolUseId}`
         );
       } else {
         // 孤立 tool_result - 找不到对应的 tool_use
         console.warn(
           `⚠ 跳过孤立的 tool_result：找不到对应的 tool_use，tool_use_id=${result.toolUseId}`
         );
         orphanedResults.push(result.toolUseId);
       }
     }

     // 5. 检测真正孤立的 tool_use（有 tool_use 但在历史和当前消息中都没有 tool_result）
     for (const orphanedId of unpairedToolUseIds) {
       console.warn(
         `⚠ 检测到孤立的 tool_use：找不到对应的 tool_result，将从历史中移除，tool_use_id=${orphanedId}`
       );
     }

      return { validatedResults: filteredResults, orphanedToolUseIds: unpairedToolUseIds };
    }

    /**
     * 从历史消息中移除孤立的 tool_use
     * 
     * 遍历 history，从 assistantResponseMessage.toolUses 中移除孤立的 tool_use
     * 如果 toolUses 变空，设置为 undefined（避免空数组）
     * 
     * @param {Array} history - 历史消息数组
     * @param {Set} orphanedToolUseIds - 孤立的 tool_use_id 集合
     */
    removeOrphanedToolUses(history, orphanedToolUseIds) {
      if (orphanedToolUseIds.size === 0) return;
      
      let removedCount = 0;
      
      for (const msg of history) {
        if (msg.assistantResponseMessage?.toolUses) {
          const originalLength = msg.assistantResponseMessage.toolUses.length;
          
          // 过滤掉孤立的 tool_use
          msg.assistantResponseMessage.toolUses = 
            msg.assistantResponseMessage.toolUses.filter(
              tu => !orphanedToolUseIds.has(tu.toolUseId)
            );
          
          removedCount += originalLength - msg.assistantResponseMessage.toolUses.length;
          
          // 如果 toolUses 变空，设置为 undefined
          if (msg.assistantResponseMessage.toolUses.length === 0) {
            delete msg.assistantResponseMessage.toolUses;
          }
        }
      }
      
      if (removedCount > 0) {
        console.warn(`⚠ 从历史中移除了 ${removedCount} 个孤立的 tool_use`);
      }
    }

    /**
     * 发送 API 请求（流式）
     */
    async callApiStream(anthropicReq) {
    const token = await this.tokenManager.ensureValidToken();
    const region = this.config.region || 'us-east-1';
    const url = `https://q.${region}.amazonaws.com/generateAssistantResponse`;
    
    const { kiroRequest: kiroReq, toolNameMap } = this.convertRequest(anthropicReq);
    const headers = this.buildHeaders(token);
    const requestDebug = this.summarizeForDebug(kiroReq);

    // 超时控制（防止上游 hang 住）
    const timeout = parseInt(process.env.REQUEST_TIMEOUT) || 60000; // 默认 60 秒
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify(kiroReq),
      signal: controller.signal
    };

    // 代理支持
    if (this.config.proxyUrl) {
      try {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(this.config.proxyUrl);
      } catch (e) {
        // 代理模块未安装，忽略
      }
    }

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const error = await response.text();
        throw new KiroApiError(response.status, error, requestDebug);
      }

      return { response, toolNameMap };
    } catch (error) {
      clearTimeout(timeoutId);
      
      // 超时错误
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      
      throw error;
    }
  }
}
