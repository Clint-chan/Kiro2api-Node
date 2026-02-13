/**
 * CLIProxyAPI Management API 客户端
 * 封装所有 Management API 调用
 */

export class CLIProxyClient {
  /**
   * 初始化 CLIProxyClient
   * @param {string} managementUrl - CLIProxyAPI Management 服务地址，默认 http://localhost:8317
   * @param {string} managementKey - CLIProxyAPI Management API 密钥
   */
  constructor(managementUrl, managementKey) {
    this.managementUrl = managementUrl || process.env.CLIPROXY_MANAGEMENT_URL || 'http://localhost:8317';
    this.managementKey = managementKey || process.env.CLIPROXY_MANAGEMENT_KEY;

    if (!this.managementKey) {
      throw new Error('CLIPROXY_MANAGEMENT_KEY is required');
    }
  }

  /**
   * 统一的 HTTP 请求方法
   * @param {string} path - API 路径（不包含 /v0/management 前缀）
   * @param {object} options - fetch 选项
   * @returns {Promise<object>} 响应 JSON 数据
   * @throws {Error} 请求失败时抛出错误
   */
  async request(path, options = {}) {
    const url = `${this.managementUrl}/v0/management${path}`;
    const headers = {
      'Authorization': `Bearer ${this.managementKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
        } catch (e) {
          // 如果响应不是 JSON，使用默认错误消息
        }
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`CLIProxyAPI request failed: ${error.message}`);
    }
  }

  // ==================== 账号管理 ====================

  /**
   * 获取所有认证文件列表
   * @returns {Promise<object>} 认证文件列表
   */
  async listAuthFiles() {
    return await this.request('/auth-files');
  }

  /**
   * 删除认证文件
   * @param {string} name - 认证文件名称
   * @returns {Promise<object>} 删除结果
   */
  async deleteAuthFile(name) {
    return await this.request(`/auth-files?name=${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
  }

  /**
   * 修改认证文件状态（启用/禁用）
   * @param {string} name - 认证文件名称
   * @param {boolean} disabled - 是否禁用
   * @returns {Promise<object>} 修改结果
   */
  async patchAuthFileStatus(name, disabled) {
    return await this.request('/auth-files/status', {
      method: 'PATCH',
      body: JSON.stringify({ name, disabled })
    });
  }

  // ==================== OAuth 流程 ====================

  /**
   * 获取 Antigravity OAuth 授权 URL
   * @returns {Promise<object>} 包含授权 URL 和 state 的对象
   */
  async getAntigravityAuthUrl() {
    return await this.request('/antigravity-auth-url?is_webui=true');
  }

  /**
   * 获取 OAuth 认证状态
   * @param {string} state - OAuth state 参数
   * @returns {Promise<object>} 认证状态信息
   */
  async getAuthStatus(state) {
    return await this.request(`/get-auth-status?state=${encodeURIComponent(state)}`);
  }

  // ==================== 使用统计 ====================

  /**
   * 获取使用统计信息
   * @returns {Promise<object>} 使用统计数据
   */
  async getUsage() {
    return await this.request('/usage');
  }

  /**
   * 导出使用统计数据
   * @returns {Promise<object>} 导出的统计数据
   */
  async exportUsage() {
    return await this.request('/usage/export');
  }

  /**
   * 导入使用统计数据
   * @param {object} data - 要导入的统计数据
   * @returns {Promise<object>} 导入结果
   */
  async importUsage(data) {
    return await this.request('/usage/import', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // ==================== 日志 ====================

  /**
   * 获取日志
   * @param {number} after - 时间戳，获取该时间之后的日志
   * @returns {Promise<object>} 日志数据
   */
  async getLogs(after) {
    const query = after ? `?after=${after}` : '';
    return await this.request(`/logs${query}`);
  }

  /**
   * 删除所有日志
   * @returns {Promise<object>} 删除结果
   */
  async deleteLogs() {
    return await this.request('/logs', { method: 'DELETE' });
  }

  /**
   * 获取请求错误日志文件列表
   * @returns {Promise<object>} 错误日志文件列表
   */
  async getRequestErrorLogs() {
    return await this.request('/request-error-logs');
  }

  /**
   * 下载请求错误日志文件
   * @param {string} name - 日志文件名称
   * @returns {Promise<string>} 日志文件内容
   */
  async downloadRequestErrorLog(name) {
    const url = `${this.managementUrl}/v0/management/request-error-logs/${encodeURIComponent(name)}`;
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.managementKey}` }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      throw new Error(`Failed to download error log: ${error.message}`);
    }
  }

  // ==================== 配置管理 ====================

  /**
   * 获取完整配置
   * @returns {Promise<object>} 配置信息
   */
  async getConfig() {
    return await this.request('/config');
  }

  /**
   * 获取调试模式状态
   * @returns {Promise<object>} 调试模式配置
   */
  async getDebug() {
    return await this.request('/debug');
  }

  /**
   * 设置调试模式
   * @param {boolean} value - 是否启用调试模式
   * @returns {Promise<object>} 设置结果
   */
  async putDebug(value) {
    return await this.request('/debug', {
      method: 'PUT',
      body: JSON.stringify({ value })
    });
  }

  /**
   * 获取代理 URL
   * @returns {Promise<object>} 代理 URL 配置
   */
  async getProxyUrl() {
    return await this.request('/proxy-url');
  }

  /**
   * 设置代理 URL
   * @param {string} value - 代理 URL（如 socks5://127.0.0.1:1080）
   * @returns {Promise<object>} 设置结果
   */
  async putProxyUrl(value) {
    return await this.request('/proxy-url', {
      method: 'PUT',
      body: JSON.stringify({ value })
    });
  }

  /**
   * 删除代理 URL 配置
   * @returns {Promise<object>} 删除结果
   */
  async deleteProxyUrl() {
    return await this.request('/proxy-url', { method: 'DELETE' });
  }

  /**
   * 通用 API 调用代理
   * @param {string} authIndex - 认证文件索引
   * @param {string} method - HTTP 方法
   * @param {string} url - 目标 URL
   * @param {object} header - 请求头
   * @param {string} data - 请求体数据
   * @returns {Promise<object>} API 调用结果
   */
  async apiCall(authIndex, method, url, header, data) {
    return await this.request('/api-call', {
      method: 'POST',
      body: JSON.stringify({ authIndex, method, url, header, data })
    });
  }

  /**
   * 获取请求重试配置
   * @returns {Promise<object>} 重试配置
   */
  async getRequestRetry() {
    return await this.request('/request-retry');
  }

  /**
   * 设置请求重试次数
   * @param {number} value - 重试次数
   * @returns {Promise<object>} 设置结果
   */
  async putRequestRetry(value) {
    return await this.request('/request-retry', {
      method: 'PUT',
      body: JSON.stringify({ value })
    });
  }

  /**
   * 获取配额超限配置
   * @returns {Promise<object>} 配额超限配置（包含 switch-project 和 switch-preview-model）
   */
  async getQuotaExceeded() {
    const switchProject = await this.request('/quota-exceeded/switch-project');
    const switchPreview = await this.request('/quota-exceeded/switch-preview-model');
    return {
      'switch-project': switchProject['switch-project'],
      'switch-preview-model': switchPreview['switch-preview-model']
    };
  }

  /**
   * 设置配额超限时是否切换项目
   * @param {boolean} value - 是否启用切换项目
   * @returns {Promise<object>} 设置结果
   */
  async putQuotaExceededSwitchProject(value) {
    return await this.request('/quota-exceeded/switch-project', {
      method: 'PUT',
      body: JSON.stringify({ value })
    });
  }

  /**
   * 设置配额超限时是否切换预览模型
   * @param {boolean} value - 是否启用切换预览模型
   * @returns {Promise<object>} 设置结果
   */
  async putQuotaExceededSwitchPreviewModel(value) {
    return await this.request('/quota-exceeded/switch-preview-model', {
      method: 'PUT',
      body: JSON.stringify({ value })
    });
  }
}
