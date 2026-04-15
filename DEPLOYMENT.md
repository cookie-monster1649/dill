# 🚀 Production Deployment Guide

This guide will help you deploy Dill Bot to production safely and efficiently.

## Prerequisites

1. **Slack App Setup**: Complete the Slack app configuration
2. **Hosting Platform**: Choose a 24/7 hosting solution
3. **Domain/SSL**: For webhook endpoints (if not using Socket Mode)

## Step 1: Slack App Configuration

### Required OAuth Scopes
Your Slack app needs these scopes:
- `chat:write` - Post messages to channels
- `commands` - Add slash commands
- `users:read` - Read user information
- `channels:read` - Read channel information
- `groups:read` - Read private channel information
- `im:read` - Read direct messages
- `mpim:read` - Read group direct messages

### Required Event Subscriptions
- `message.channels` - For channel messages
- `app_mention` - For @mentions

### Slash Commands
- `/dill` - Main command

## Step 2: Environment Variables

Create a `.env` file with these variables:

```env
# Required
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret

# Optional
NODE_ENV=production
LOG_LEVEL=INFO
```

## Step 3: Choose Your Hosting Platform

### Option A: Heroku (Recommended for beginners)

1. **Install Heroku CLI**
2. **Create Heroku app**:
   ```bash
   heroku create your-dill-bot
   ```

3. **Set environment variables**:
   ```bash
   heroku config:set SLACK_BOT_TOKEN=xoxb-your-token
   heroku config:set SLACK_APP_TOKEN=xapp-your-token
   heroku config:set SLACK_SIGNING_SECRET=your-secret
   heroku config:set NODE_ENV=production
   ```

4. **Deploy**:
   ```bash
   git push heroku main
   ```

5. **Scale to always-on**:
   ```bash
   heroku ps:scale web=1
   ```

6. **Verify deployment**:
   ```bash
   heroku logs --tail
   # Check health endpoint
   curl https://your-dill-bot.herokuapp.com/health
   ```

### Option B: Railway

1. **Connect your GitHub repo**
2. **Set environment variables** in Railway dashboard
3. **Deploy automatically** on push

### Option C: DigitalOcean App Platform

1. **Create new app** from GitHub
2. **Set environment variables**
3. **Deploy**

## Step 4: Monitoring and Maintenance

### Health Checks
- Use `/dill status` to check bot health
- Monitor logs for errors
- Set up uptime monitoring (UptimeRobot, Pingdom)

### Logs
- Monitor application logs for errors
- Set up log aggregation (Papertrail, Loggly)

### Data Backup
- JSON files are automatically backed up
- Consider periodic manual backups
- Monitor disk space usage

## Step 5: Security Checklist

- [ ] Environment variables are set securely
- [ ] No sensitive data in code
- [ ] Rate limiting is enabled
- [ ] Input validation is working
- [ ] SSL/TLS is enabled (if using webhooks)

## Step 6: Testing Production

1. **Test slash commands** in your workspace
2. **Create a test rotation** to verify functionality
3. **Test scheduling** with a short timeout
4. **Verify error handling** works correctly

## Troubleshooting

### Common Issues

1. **Bot not responding**:
   - Check if app is running: `heroku logs --tail`
   - Verify environment variables are set
   - Check Slack app permissions
   - Test health endpoint: `curl https://your-app.herokuapp.com/health`

2. **Scheduling not working**:
   - Verify timezone settings
   - Check cron job creation in logs
   - Test with `/dill pick` command

3. **Memory issues**:
   - Monitor memory usage with `/dill status`
   - Consider upgrading hosting plan
   - Check for memory leaks in logs

4. **Heroku R10 Boot Timeout**:
   - Ensure Procfile exists with `web: npm start`
   - Verify app binds to `$PORT` environment variable
   - Check that HTTP server starts properly in logs

### Support

- Check logs first: `heroku logs --tail`
- Use `/dill help` for user commands
- Review this documentation
- Check Slack API status: https://status.slack.com/

## Maintenance Schedule

- **Daily**: Check logs for errors
- **Weekly**: Review analytics data
- **Monthly**: Update dependencies
- **Quarterly**: Review and clean up old data 