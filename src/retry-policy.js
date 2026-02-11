/**
 * 重试策略实现
 * 支持指数退避、抖动等策略
 */

export class RetryPolicy {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.initialDelay = options.initialDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this.factor = options.factor || 2;
    this.jitter = options.jitter !== false;
    this.timeout = options.timeout || 30000;
    
    // 不应该重试的错误类型
    this.nonRetryableErrors = new Set(options.nonRetryableErrors || [
      'AUTHENTICATION_ERROR',
      'INVALID_REQUEST',
      'QUOTA_EXCEEDED',
      'PERMISSION_DENIED'
    ]);
  }

  async execute(fn, context = {}) {
    let lastError;
    const startTime = Date.now();
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // 检查总超时
      if (Date.now() - startTime > this.timeout) {
        throw new Error(`Retry timeout after ${this.timeout}ms`);
      }

      try {
        const result = await this.executeWithTimeout(fn, this.timeout - (Date.now() - startTime));
        
        if (attempt > 0) {
          console.log(`✓ 重试成功 (尝试 ${attempt + 1}/${this.maxRetries + 1})`);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        // 判断是否应该重试
        if (!this.shouldRetry(error, attempt, context)) {
          throw error;
        }

        if (attempt < this.maxRetries) {
          const delay = this.calculateDelay(attempt);
          console.log(`⚠ 请求失败，${delay}ms 后重试 (${attempt + 1}/${this.maxRetries}): ${error.message}`);
          await this.sleep(delay);
        }
      }
    }

    console.error(`✗ 重试失败，已达最大重试次数 (${this.maxRetries + 1})`);
    throw lastError;
  }

  async executeWithTimeout(fn, timeout) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      )
    ]);
  }

  shouldRetry(error, attempt, context) {
    // 已达最大重试次数
    if (attempt >= this.maxRetries) {
      return false;
    }

    // 检查错误类型
    if (error.code && this.nonRetryableErrors.has(error.code)) {
      return false;
    }

    // 检查 HTTP 状态码
    if (error.status) {
      // 4xx 客户端错误通常不应重试（除了 429）
      if (error.status >= 400 && error.status < 500 && error.status !== 429) {
        return false;
      }
      
      // 5xx 服务器错误应该重试
      if (error.status >= 500) {
        return true;
      }
      
      // 429 Too Many Requests 应该重试
      if (error.status === 429) {
        return true;
      }
    }

    // 网络错误应该重试
    if (error.message && (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('timeout') ||
      error.message.includes('network')
    )) {
      return true;
    }

    // 默认不重试
    return false;
  }

  calculateDelay(attempt) {
    // 指数退避: delay = initialDelay * (factor ^ attempt)
    let delay = this.initialDelay * Math.pow(this.factor, attempt);
    
    // 限制最大延迟
    delay = Math.min(delay, this.maxDelay);

    // 添加随机抖动，避免惊群效应
    if (this.jitter) {
      // 在 50% - 100% 之间随机
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return Math.floor(delay);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 预定义的重试策略
 */
export const RetryPolicies = {
  // 快速重试：适用于临时性错误
  FAST: new RetryPolicy({
    maxRetries: 2,
    initialDelay: 500,
    maxDelay: 2000,
    factor: 2,
    timeout: 10000
  }),

  // 标准重试：适用于大多数场景
  STANDARD: new RetryPolicy({
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    factor: 2,
    timeout: 30000
  }),

  // 持久重试：适用于重要请求
  PERSISTENT: new RetryPolicy({
    maxRetries: 5,
    initialDelay: 2000,
    maxDelay: 30000,
    factor: 2,
    timeout: 60000
  }),

  // 无重试：用于测试或特殊场景
  NONE: new RetryPolicy({
    maxRetries: 0
  })
};
