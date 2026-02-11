/**
 * 熔断器模式实现
 * 参考 Netflix Hystrix 和 Resilience4j
 */

export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 60000;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls || 3;
    this.name = options.name || 'CircuitBreaker';
    
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this.halfOpenCalls = 0;
    
    this.metrics = {
      totalCalls: 0,
      successCalls: 0,
      failureCalls: 0,
      rejectedCalls: 0,
      lastStateChange: Date.now()
    };
  }

  async execute(fn) {
    this.metrics.totalCalls++;

    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        this.metrics.rejectedCalls++;
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
      this.transitionTo('HALF_OPEN');
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
        this.metrics.rejectedCalls++;
        throw new Error(`Circuit breaker ${this.name} HALF_OPEN limit reached`);
      }
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.metrics.successCalls++;
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.transitionTo('CLOSED');
        this.successCount = 0;
        this.halfOpenCalls = 0;
      }
    }
  }

  onFailure() {
    this.metrics.failureCalls++;
    this.failureCount++;
    this.successCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      this.halfOpenCalls = 0;
    } else if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.metrics.lastStateChange = Date.now();

    if (newState === 'OPEN') {
      this.nextAttempt = Date.now() + this.timeout;
    }

    console.log(`[CircuitBreaker:${this.name}] ${oldState} → ${newState}`);
  }

  getState() {
    return this.state;
  }

  getMetrics() {
    return {
      ...this.metrics,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenCalls = 0;
    this.metrics.lastStateChange = Date.now();
  }
}

/**
 * 熔断器管理器
 * 为每个账号管理独立的熔断器
 */
export class CircuitBreakerManager {
  constructor(options = {}) {
    this.breakers = new Map();
    this.defaultOptions = options;
  }

  getBreaker(accountId) {
    if (!this.breakers.has(accountId)) {
      this.breakers.set(accountId, new CircuitBreaker({
        ...this.defaultOptions,
        name: `Account-${accountId.substring(0, 8)}`
      }));
    }
    return this.breakers.get(accountId);
  }

  async execute(accountId, fn) {
    const breaker = this.getBreaker(accountId);
    return breaker.execute(fn);
  }

  getState(accountId) {
    const breaker = this.breakers.get(accountId);
    return breaker ? breaker.getState() : 'UNKNOWN';
  }

  getMetrics(accountId) {
    const breaker = this.breakers.get(accountId);
    return breaker ? breaker.getMetrics() : null;
  }

  getAllMetrics() {
    const metrics = {};
    for (const [accountId, breaker] of this.breakers) {
      metrics[accountId] = breaker.getMetrics();
    }
    return metrics;
  }

  reset(accountId) {
    const breaker = this.breakers.get(accountId);
    if (breaker) {
      breaker.reset();
    }
  }

  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}
