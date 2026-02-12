/**
 * 结构化日志模块
 * 支持 JSON 格式输出和日志分级
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

class Logger {
  constructor(options = {}) {
    this.level = LOG_LEVELS[options.level?.toUpperCase()] ?? LOG_LEVELS.INFO;
    this.format = options.format || 'json'; // 'json' or 'text'
    this.service = options.service || 'kiro-api';
  }

  _log(level, message, meta = {}) {
    if (LOG_LEVELS[level] > this.level) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...meta
    };

    if (this.format === 'json') {
      console.log(JSON.stringify(logEntry));
    } else {
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      console.log(`[${logEntry.timestamp}] ${level}: ${message}${metaStr}`);
    }
  }

  error(message, meta) {
    this._log('ERROR', message, meta);
  }

  warn(message, meta) {
    this._log('WARN', message, meta);
  }

  info(message, meta) {
    this._log('INFO', message, meta);
  }

  debug(message, meta) {
    this._log('DEBUG', message, meta);
  }
}

// 全局实例
export const logger = new Logger({
  level: process.env.LOG_LEVEL || 'INFO',
  format: process.env.LOG_FORMAT || 'json'
});
