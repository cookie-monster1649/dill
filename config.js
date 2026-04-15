// Configuration file for Dill Bot
module.exports = {
  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Performance settings
  RATE_LIMIT_WINDOW: 5000,      // 5 seconds
  RATE_LIMIT_MAX_ACTIONS: 3,    // Max 3 actions per window per user

  // Timeouts
  VIEW_BUILD_TIMEOUT_MS: 1500,        // Max time to build a modal view before giving up
  FUTURE_SKIP_BUILD_TIMEOUT_MS: 2000, // Slightly longer – future-skip rebuilds more blocks
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: 10000, // Force-exit if shutdown hangs past this point

  // Analytics settings
  ANALYTICS_RETENTION_DAYS: 90,
  

  
  // Display settings
  MAX_DISPLAY_ITEMS: 10,
  MAX_ROTATION_NAME_LENGTH: 50,
  
  // Validation patterns
  ROTATION_NAME_PATTERN: /^[a-zA-Z0-9\s\-_]+$/,
  
  // File paths
  CONFIG_FILE: 'configs.json',
  QUEUE_FILE: 'rotations.json',
  STATE_FILE: 'activestate.json',
  ANALYTICS_FILE: 'analytics.json',
  
  // Persistent Storage settings
  PERSISTENT_STORAGE_ENABLED: process.env.DILL_STORAGE_CHANNEL_ID ? true : false,
  BACKUP_INTERVAL_MINUTES: 30,    // How often to create automatic backups
  BACKUP_THROTTLE_MS: 60000,      // Minimum ms between successive backup writes
  MAX_BACKUP_MESSAGE_SIZE: 40000, // Slack message size limit
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',
  
  // Production settings
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  
  // Timezone options (UTC offsets from -12 to +14)
  TIMEZONE_OFFSETS: Array.from({ length: 27 }, (_, i) => {
    const offset = 12 - i;
    return {
      label: `UTC${offset >= 0 ? '+' : ''}${offset.toString().padStart(2, '0')}:00`,
      value: `Etc/GMT${offset > 0 ? `-${offset}` : `+${Math.abs(offset)}`}`
    };
  })
}; 