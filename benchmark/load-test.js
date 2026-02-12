#!/usr/bin/env node

/**
 * 负载测试脚本
 * 测试 Kiro2API-Node 的并发性能
 */

import fetch from 'node-fetch';

class LoadTester {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:19864';
    this.apiKey = options.apiKey || 'zxc123';
    this.concurrency = options.concurrency || 10;
    this.duration = options.duration || 30000; // 30秒
    this.requestTimeout = options.requestTimeout || 30000;
    
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      timeout: 0,
      latencies: [],
      errors: new Map(),
      startTime: null,
      endTime: null
    };
  }

  async testHealth() {
    console.log('🔍 检查服务健康状态...');
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        timeout: 5000
      });
      const data = await response.json();
      console.log('✓ 服务正常:', data);
      return true;
    } catch (error) {
      console.error('✗ 服务不可用:', error.message);
      return false;
    }
  }

  async sendRequest() {
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 100,
          messages: [
            { role: 'user', content: 'Hello! Please respond with a short greeting.' }
          ]
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      if (response.ok) {
        await response.json(); // 消费响应体
        this.stats.success++;
        this.stats.latencies.push(latency);
        return { success: true, latency };
      } else {
        this.stats.failed++;
        const error = await response.text();
        this.recordError(error);
        return { success: false, latency, error };
      }
    } catch (error) {
      const latency = Date.now() - startTime;
      
      if (error.name === 'AbortError') {
        this.stats.timeout++;
        this.recordError('TIMEOUT');
      } else {
        this.stats.failed++;
        this.recordError(error.message);
      }
      
      return { success: false, latency, error: error.message };
    } finally {
      this.stats.total++;
    }
  }

  recordError(error) {
    const errorKey = typeof error === 'string' ? error : error.substring(0, 100);
    const count = this.stats.errors.get(errorKey) || 0;
    this.stats.errors.set(errorKey, count + 1);
  }

  async runWorker() {
    const endTime = Date.now() + this.duration;
    
    while (Date.now() < endTime) {
      await this.sendRequest();
    }
  }

  async run() {
    console.log('\n========================================');
    console.log('  Kiro2API-Node 负载测试');
    console.log('========================================\n');
    console.log(`目标地址: ${this.baseUrl}`);
    console.log(`并发数: ${this.concurrency}`);
    console.log(`持续时间: ${this.duration / 1000}秒`);
    console.log(`请求超时: ${this.requestTimeout / 1000}秒\n`);

    // 健康检查
    const healthy = await this.testHealth();
    if (!healthy) {
      console.error('\n❌ 服务不可用，测试终止');
      process.exit(1);
    }

    console.log('\n🚀 开始压测...\n');
    this.stats.startTime = Date.now();

    // 启动进度显示
    const progressInterval = setInterval(() => {
      this.showProgress();
    }, 2000);

    // 启动并发 workers
    const workers = [];
    for (let i = 0; i < this.concurrency; i++) {
      workers.push(this.runWorker());
    }

    await Promise.all(workers);
    clearInterval(progressInterval);

    this.stats.endTime = Date.now();
    this.showResults();
  }

  showProgress() {
    const elapsed = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);
    const qps = (this.stats.total / (elapsed || 1)).toFixed(2);
    const successRate = this.stats.total > 0 
      ? ((this.stats.success / this.stats.total) * 100).toFixed(2)
      : 0;

    process.stdout.write(`\r⏱️  ${elapsed}s | 请求: ${this.stats.total} | 成功: ${this.stats.success} | 失败: ${this.stats.failed} | QPS: ${qps} | 成功率: ${successRate}%`);
  }

  showResults() {
    console.log('\n\n========================================');
    console.log('  测试结果');
    console.log('========================================\n');

    const duration = (this.stats.endTime - this.stats.startTime) / 1000;
    const qps = (this.stats.total / duration).toFixed(2);
    const successRate = ((this.stats.success / this.stats.total) * 100).toFixed(2);

    console.log('📊 总体统计:');
    console.log(`  总请求数: ${this.stats.total}`);
    console.log(`  成功: ${this.stats.success} (${successRate}%)`);
    console.log(`  失败: ${this.stats.failed}`);
    console.log(`  超时: ${this.stats.timeout}`);
    console.log(`  持续时间: ${duration.toFixed(2)}秒`);
    console.log(`  QPS: ${qps}`);

    let sorted = null;
    if (this.stats.latencies.length > 0) {
      sorted = this.stats.latencies.sort((a, b) => a - b);
      const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];

      console.log('\n⏱️  延迟统计 (ms):');
      console.log(`  最小: ${min}`);
      console.log(`  最大: ${max}`);
      console.log(`  平均: ${avg.toFixed(2)}`);
      console.log(`  P50: ${p50}`);
      console.log(`  P95: ${p95}`);
      console.log(`  P99: ${p99}`);
    }

    if (this.stats.errors.size > 0) {
      console.log('\n❌ 错误统计:');
      const sortedErrors = Array.from(this.stats.errors.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      
      for (const [error, count] of sortedErrors) {
        console.log(`  ${error}: ${count}次`);
      }
    }

    console.log('\n========================================\n');

    // 性能评级
    this.showRating(qps, successRate, sorted);
  }

  showRating(qps, successRate, sorted) {
    console.log('🏆 性能评级:\n');

    let score = 0;
    let rating = '';

    // QPS 评分 (40分)
    if (qps >= 100) score += 40;
    else if (qps >= 50) score += 30;
    else if (qps >= 20) score += 20;
    else if (qps >= 10) score += 10;

    // 成功率评分 (40分)
    if (successRate >= 99) score += 40;
    else if (successRate >= 95) score += 30;
    else if (successRate >= 90) score += 20;
    else if (successRate >= 80) score += 10;

    // 延迟评分 (20分)
    if (sorted && sorted.length > 0) {
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      if (p95 <= 1000) score += 20;
      else if (p95 <= 2000) score += 15;
      else if (p95 <= 3000) score += 10;
      else if (p95 <= 5000) score += 5;
    }

    if (score >= 90) rating = 'S (优秀)';
    else if (score >= 80) rating = 'A (良好)';
    else if (score >= 70) rating = 'B (中等)';
    else if (score >= 60) rating = 'C (及格)';
    else rating = 'D (需要优化)';

    console.log(`  总分: ${score}/100`);
    console.log(`  评级: ${rating}`);

    console.log('\n💡 建议:');
    if (qps < 50) {
      console.log('  - QPS 较低，考虑优化账号池策略或增加账号数量');
    }
    if (successRate < 95) {
      console.log('  - 成功率偏低，检查账号状态和错误日志');
    }
    if (sorted && sorted.length > 0) {
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      if (p95 > 3000) {
        console.log('  - P95 延迟较高，考虑启用熔断器和重试策略');
      }
    }
    console.log('');
  }
}

// 命令行参数解析
const args = process.argv.slice(2);
const options = {
  baseUrl: 'http://localhost:19864',
  apiKey: 'zxc123',
  concurrency: 10,
  duration: 30000
};

for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, '');
  const value = args[i + 1];
  
  if (key === 'url') options.baseUrl = value;
  else if (key === 'key') options.apiKey = value;
  else if (key === 'concurrency' || key === 'c') options.concurrency = parseInt(value);
  else if (key === 'duration' || key === 'd') options.duration = parseInt(value) * 1000;
}

// 运行测试
const tester = new LoadTester(options);
tester.run().catch(error => {
  console.error('\n❌ 测试失败:', error);
  process.exit(1);
});
