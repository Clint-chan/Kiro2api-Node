# 高并发组件使用示例

## 1. 熔断器使用

### 基础使用

```javascript
import { CircuitBreaker } from './circuit-breaker.js';

// 创建熔断器
const breaker = new CircuitBreaker({
  failureThreshold: 5,      // 5 次失败后熔断
  successThreshold: 2,      // 2 次成功后恢复
  timeout: 60000,           // 熔断 60 秒
  halfOpenMaxCalls: 3,      // 半开状态最多 3 个请求
  name: 'MyService'
});

// 使用熔断器执行请求
try {
  const result = await breaker.execute(async () => {
    return await someApiCall();
  });
  console.log('Success:', result);
} catch (error) {
  if (error.message.includes('Circuit breaker')) {
    console.log('服务熔断中，请稍后重试');
  } else {
    console.error('请求失败:', error);
  }
}

// 查看熔断器状态
console.log('State:', breaker.getState());  // CLOSED, OPEN, HALF_OPEN
console.log('Metrics:', breaker.getMetrics());
```

### 集成到账号池

```javascript
import { CircuitBreakerManager } from './circuit-breaker.js';

class EnhancedAccountPool extends AccountPool {
  constructor(config, db) {
    super(config, db);
    
    // 创建熔断器管理器
    this.circuitBreakers = new CircuitBreakerManager({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000
    });
  }

  async selectAccount() {
    const available = Array.from(this.accounts.values())
      .filter(a => {
        // 过滤掉熔断状态的账号
        const breakerState = this.circuitBreakers.getState(a.id);
        return a.status === 'active' && breakerState !== 'OPEN';
      });

    if (available.length === 0) return null;

    // 选择账号逻辑...
    const selected = available[0];

    return {
      id: selected.id,
      name: selected.name,
      tokenManager: this.tokenManagers.get(selected.id),
      circuitBreaker: this.circuitBreakers.getBreaker(selected.id)
    };
  }

  async executeRequest(accountId, fn) {
    return this.circuitBreakers.execute(accountId, fn);
  }
}
```

---

## 2. 重试策略使用

### 基础使用

```javascript
import { RetryPolicy, RetryPolicies } from './retry-policy.js';

// 使用预定义策略
const result = await RetryPolicies.STANDARD.execute(async () => {
  return await someApiCall();
});

// 自定义策略
const customRetry = new RetryPolicy({
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  factor: 2,
  jitter: true,
  timeout: 30000,
  nonRetryableErrors: ['INVALID_REQUEST']
});

try {
  const result = await customRetry.execute(async () => {
    return await someApiCall();
  });
} catch (error) {
  console.error('重试失败:', error);
}
```

### 集成到 Kiro Client

```javascript
import { RetryPolicies } from './retry-policy.js';

class EnhancedKiroClient extends KiroClient {
  constructor(config, tokenManager) {
    super(config, tokenManager);
    this.retryPolicy = RetryPolicies.STANDARD;
  }

  async sendMessage(request, stream = false) {
    return this.retryPolicy.execute(async () => {
      return super.sendMessage(request, stream);
    });
  }
}
```

---

## 3. 完整集成示例

### 增强的账号池

```javascript
import { CircuitBreakerManager } from './circuit-breaker.js';
import { RetryPolicies } from './retry-policy.js';

class ProductionAccountPool extends AccountPool {
  constructor(config, db) {
    super(config, db);
    
    // 熔断器
    this.circuitBreakers = new CircuitBreakerManager({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000
    });
    
    // 重试策略
    this.retryPolicy = RetryPolicies.STANDARD;
    
    // 指标收集
    this.metrics = {
      requests: new Map(),
      errors: new Map(),
      latencies: new Map()
    };
  }

  async selectAccount() {
    const available = Array.from(this.accounts.values())
      .filter(a => {
        const breakerState = this.circuitBreakers.getState(a.id);
        return a.status === 'active' && breakerState !== 'OPEN';
      });

    if (available.length === 0) {
      throw new Error('No available accounts');
    }

    // 加权选择：根据成功率和响应时间
    const scored = available.map(account => {
      const metrics = this.getAccountMetrics(account.id);
      const score = metrics.successRate * (1 - metrics.avgLatency / 10000);
      return { account, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0].account;

    selected.requestCount++;
    selected.lastUsedAt = new Date().toISOString();

    return {
      id: selected.id,
      name: selected.name,
      tokenManager: this.tokenManagers.get(selected.id),
      circuitBreaker: this.circuitBreakers.getBreaker(selected.id)
    };
  }

  async executeRequest(accountInfo, fn) {
    const startTime = Date.now();
    let success = false;

    try {
      // 使用熔断器和重试策略
      const result = await this.circuitBreakers.execute(
        accountInfo.id,
        () => this.retryPolicy.execute(fn)
      );
      
      success = true;
      return result;
    } catch (error) {
      success = false;
      
      // 记录错误
      await this.recordError(accountInfo.id, error.status === 429);
      throw error;
    } finally {
      // 记录指标
      const latency = Date.now() - startTime;
      this.recordMetrics(accountInfo.id, latency, success);
    }
  }

  recordMetrics(accountId, latency, success) {
    // 记录请求数
    const requests = this.metrics.requests.get(accountId) || 0;
    this.metrics.requests.set(accountId, requests + 1);

    // 记录错误数
    if (!success) {
      const errors = this.metrics.errors.get(accountId) || 0;
      this.metrics.errors.set(accountId, errors + 1);
    }

    // 记录延迟
    const latencies = this.metrics.latencies.get(accountId) || [];
    latencies.push(latency);
    if (latencies.length > 100) latencies.shift();
    this.metrics.latencies.set(accountId, latencies);
  }

  getAccountMetrics(accountId) {
    const requests = this.metrics.requests.get(accountId) || 0;
    const errors = this.metrics.errors.get(accountId) || 0;
    const latencies = this.metrics.latencies.get(accountId) || [];

    const successRate = requests > 0 ? (requests - errors) / requests : 1;
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    return { successRate, avgLatency, requests, errors };
  }

  getSystemMetrics() {
    const accounts = Array.from(this.accounts.keys());
    const metrics = {};

    for (const accountId of accounts) {
      metrics[accountId] = {
        ...this.getAccountMetrics(accountId),
        circuitBreaker: this.circuitBreakers.getMetrics(accountId)
      };
    }

    return metrics;
  }
}
```

### 在主服务中使用

```javascript
// src/index-new.js

import { ProductionAccountPool } from './enhanced-pool.js';

// 创建增强的账号池
const accountPool = new ProductionAccountPool(config, db);
await accountPool.load();

// 处理请求
app.post('/v1/messages', async (req, res) => {
  try {
    // 选择账号
    const accountInfo = await accountPool.selectAccount();
    
    if (!accountInfo) {
      return res.status(503).json({
        error: { message: '暂无可用账号' }
      });
    }

    // 执行请求（自动包含熔断和重试）
    const result = await accountPool.executeRequest(accountInfo, async () => {
      const token = await accountInfo.tokenManager.ensureValidToken();
      const client = new KiroClient(config, accountInfo.tokenManager);
      return await client.sendMessage(req.body, req.body.stream);
    });

    res.json(result);
  } catch (error) {
    console.error('请求失败:', error);
    res.status(500).json({
      error: { message: error.message }
    });
  }
});

// 监控端点
app.get('/metrics', (req, res) => {
  const metrics = accountPool.getSystemMetrics();
  res.json(metrics);
});
```

---

## 4. 监控和告警

### 查看系统指标

```bash
curl http://localhost:19864/metrics
```

响应示例：

```json
{
  "account-1": {
    "successRate": 0.95,
    "avgLatency": 1234,
    "requests": 1000,
    "errors": 50,
    "circuitBreaker": {
      "state": "CLOSED",
      "totalCalls": 1000,
      "successCalls": 950,
      "failureCalls": 50,
      "rejectedCalls": 0
    }
  },
  "account-2": {
    "successRate": 0.60,
    "avgLatency": 3456,
    "requests": 500,
    "errors": 200,
    "circuitBreaker": {
      "state": "OPEN",
      "totalCalls": 500,
      "successCalls": 300,
      "failureCalls": 200,
      "rejectedCalls": 50
    }
  }
}
```

### 告警规则建议

1. **成功率低于 90%** - 警告
2. **成功率低于 80%** - 严重
3. **平均延迟超过 5 秒** - 警告
4. **熔断器打开** - 通知
5. **所有账号不可用** - 严重

---

## 5. 性能优化建议

### 配置调优

```javascript
// 高并发场景
const highConcurrencyConfig = {
  circuitBreaker: {
    failureThreshold: 10,     // 提高阈值
    successThreshold: 3,
    timeout: 30000,           // 缩短熔断时间
    halfOpenMaxCalls: 5
  },
  retry: {
    maxRetries: 2,            // 减少重试次数
    initialDelay: 500,
    maxDelay: 5000,
    factor: 2
  }
};

// 低延迟场景
const lowLatencyConfig = {
  circuitBreaker: {
    failureThreshold: 3,      // 快速熔断
    successThreshold: 2,
    timeout: 10000,
    halfOpenMaxCalls: 2
  },
  retry: {
    maxRetries: 1,            // 最少重试
    initialDelay: 200,
    maxDelay: 1000,
    factor: 2
  }
};
```

### 负载测试

```bash
# 使用 Apache Bench
ab -n 10000 -c 100 -H "x-api-key: your-key" \
  -p request.json -T application/json \
  http://localhost:19864/v1/messages

# 使用 wrk
wrk -t12 -c400 -d30s \
  -H "x-api-key: your-key" \
  -s post.lua \
  http://localhost:19864/v1/messages
```

---

## 6. 故障演练

### 模拟账号失败

```javascript
// 手动触发熔断
accountPool.circuitBreakers.getBreaker(accountId).transitionTo('OPEN');

// 模拟高错误率
for (let i = 0; i < 10; i++) {
  await accountPool.recordError(accountId, false);
}

// 检查系统响应
const metrics = accountPool.getSystemMetrics();
console.log('System metrics:', metrics);
```

### 恢复测试

```javascript
// 重置熔断器
accountPool.circuitBreakers.reset(accountId);

// 或重置所有
accountPool.circuitBreakers.resetAll();

// 验证恢复
const state = accountPool.circuitBreakers.getState(accountId);
console.log('Circuit breaker state:', state);  // 应该是 CLOSED
```
