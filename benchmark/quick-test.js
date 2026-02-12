#!/usr/bin/env node

/**
 * 快速测试脚本 - 测试基本功能
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:19864';
const API_KEY = 'zxc123';

async function test(name, fn) {
  process.stdout.write(`${name}... `);
  try {
    const startTime = Date.now();
    await fn();
    const duration = Date.now() - startTime;
    console.log(`✓ (${duration}ms)`);
    return true;
  } catch (error) {
    console.log(`✗ ${error.message}`);
    return false;
  }
}

async function testHealth() {
  const response = await fetch(`${BASE_URL}/health`);
  const data = await response.json();
  if (!data.status || !['healthy', 'unhealthy'].includes(data.status)) throw new Error('Invalid health status');
}

async function testModels() {
  const response = await fetch(`${BASE_URL}/v1/models`, {
    headers: { 'x-api-key': API_KEY }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.data || data.data.length === 0) throw new Error('No models returned');
}

async function testMessage() {
  const response = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say hello' }]
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }
  
  const data = await response.json();
  if (!data.content || data.content.length === 0) {
    throw new Error('No content in response');
  }
}

async function testConcurrent() {
  const requests = Array(5).fill(null).map(() => 
    fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 20,
        messages: [{ role: 'user', content: 'Hi' }]
      })
    })
  );
  
  const results = await Promise.all(requests);
  const allOk = results.every(r => r.ok);
  if (!allOk) throw new Error('Some requests failed');
}

async function main() {
  console.log('\n========================================');
  console.log('  Kiro2API-Node 快速测试');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  if (await test('健康检查', testHealth)) passed++; else failed++;
  if (await test('获取模型列表', testModels)) passed++; else failed++;
  if (await test('发送消息', testMessage)) passed++; else failed++;
  if (await test('并发请求 (5个)', testConcurrent)) passed++; else failed++;

  console.log('\n========================================');
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('========================================\n');

  if (failed > 0) {
    console.log('⚠️  部分测试失败，请检查服务状态和配置\n');
    process.exit(1);
  } else {
    console.log('✓ 所有测试通过！可以开始负载测试\n');
  }
}

main().catch(error => {
  console.error('\n❌ 测试失败:', error);
  process.exit(1);
});
