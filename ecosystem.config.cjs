module.exports = {
  apps: [{
    name: 'kiro2api-node',
    script: './src/index-new.js',
    
    // 实例配置
    instances: 1,
    exec_mode: 'fork',
    
    // 自动重启配置
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
    
    // 监听配置
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'data'],
    
    // 资源限制
    max_memory_restart: '1G',
    
    // 环境变量 - 从 .env 文件读取
    env: {
      NODE_ENV: 'production',
      PORT: 19864,
      API_KEY: 'zxc123',
      ADMIN_KEY: 'zxc123',
      DATA_DIR: './data',
      REGION: 'us-east-1',
      KIRO_VERSION: '0.8.0',
      PROXY_URL: 'http://127.0.0.1:10808'
    },
    
    // 环境变量 - 开发环境
    env_development: {
      NODE_ENV: 'development'
    },
    
    // 日志配置
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // 日志轮转
    max_size: '10M',
    retain: 7,
    
    // Windows 特定配置
    windowsHide: true,
    kill_timeout: 5000,
    wait_ready: false,
    listen_timeout: 10000,
    
    // 进程管理
    pid_file: './logs/kiro2api-node.pid',
    
    // 时间配置
    time: true,
    
    // 崩溃自动重启
    exp_backoff_restart_delay: 100
  }]
};
