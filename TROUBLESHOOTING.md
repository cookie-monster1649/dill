# Dill Bot Troubleshooting Guide

## Recent Issue: WebSocket Connection Problems

### What Was Happening

Your Dill Bot was experiencing a **WebSocket connection issue** with Slack's Socket Mode that caused the application to crash with this error:

```
[FATAL] Unhandled Rejection at: Promise {
  <rejected> Error: Unhandled event 'server explicit disconnect' in state 'connecting'.
```

### Root Causes

1. **Multiple Bot Instances**: The error "too_many_websockets" indicated that multiple instances of the bot were trying to connect to Slack simultaneously
2. **Incomplete Error Handling**: The bot didn't properly handle the specific "server explicit disconnect" scenario during connection
3. **No Graceful Recovery**: The application crashed instead of attempting to reconnect

### Solutions Implemented

#### 1. Enhanced Error Handling

- **Graceful Disconnect Handling**: Added specific handling for "server explicit disconnect" errors
- **Automatic Reconnection**: The bot now automatically attempts to reconnect after connection failures
- **Better Logging**: More detailed error messages to help diagnose issues

#### 2. Process Lock Mechanism

- **Single Instance Enforcement**: Added a process lock file (`.dill-bot.lock`) to prevent multiple bot instances
- **Automatic Cleanup**: Lock files are automatically cleaned up when the bot stops
- **Stale Lock Detection**: The system detects and removes stale lock files from crashed instances

#### 3. Management Script

Created `scripts/manage-bot.sh` for easy bot management:

```bash
# Check bot status
./scripts/manage-bot.sh status

# Start the bot
./scripts/manage-bot.sh start

# Stop the bot
./scripts/manage-bot.sh stop

# Restart the bot
./scripts/manage-bot.sh restart

# View recent logs
./scripts/manage-bot.sh logs
```

### Current Status

✅ **Fixed**: The bot now runs stably with proper error handling
✅ **Fixed**: Multiple instance prevention is working
✅ **Fixed**: Automatic reconnection on connection failures
✅ **Fixed**: Graceful shutdown and cleanup

### Health Check

The bot provides a health check endpoint at `http://localhost:3000/health` that returns:

```json
{
  "status": "healthy",
  "service": "dill-bot",
  "timestamp": "2025-08-21T05:46:11.377Z",
  "uptime": 48.972894542,
  "memory": "13MB",
  "activeJobs": 1,
  "connection": {
    "connected": true,
    "status": "Connected",
    "url": "Unknown"
  },
  "message": "Dill Bot is running and healthy!"
}
```

### Prevention Tips

1. **Always use the management script** to start/stop the bot
2. **Check for running instances** before starting: `./scripts/manage-bot.sh status`
3. **Monitor logs** regularly: `./scripts/manage-bot.sh logs`
4. **Don't run multiple instances** - the process lock will prevent this automatically

### If Issues Persist

1. **Check the logs**: `./scripts/manage-bot.sh logs`
2. **Restart the bot**: `./scripts/manage-bot.sh restart`
3. **Verify Slack tokens**: Ensure your `.env` file has valid Slack credentials
4. **Check network connectivity**: Ensure the bot can reach Slack's servers

### Technical Details

The improvements include:

- **Socket Mode Error Handling**: Comprehensive error handling for all Socket Mode events
- **Unhandled Promise Rejection Handling**: Prevents crashes from unhandled rejections
- **Process Management**: Proper process lifecycle management with cleanup
- **Health Monitoring**: Built-in health checks and status reporting
- **Logging**: Enhanced logging for debugging and monitoring
