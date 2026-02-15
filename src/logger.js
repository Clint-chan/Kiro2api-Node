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

    // Serialize Error objects in meta
    const serializedMeta = {};
    for (const [key, value] of Object.entries(meta)) {
      if (value instanceof Error) {
        serializedMeta[key] = {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      } else {
        serializedMeta[key] = value;
      }
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...serializedMeta
    };

    // Determine output stream based on log level
    const isError = level === 'ERROR' || level === 'WARN';
    const outputFn = isError ? console.error : console.log;

    if (this.format === 'json') {
      outputFn(JSON.stringify(logEntry));
    } else {
      const metaStr = Object.keys(serializedMeta).length > 0 ? ` ${JSON.stringify(serializedMeta)}` : '';
      outputFn(`[${logEntry.timestamp}] ${level}: ${message}${metaStr}`);
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
