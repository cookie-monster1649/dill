// ── Bot Lifecycle ─────────────────────────────────────────────────────────────
//
// HTTP health-check server and graceful shutdown. Separated from app.js so that
// the operational plumbing doesn't obscure the bot's core wiring.

const http = require('http');
const { getConnectionStatus } = require('./connection');
const config = require('../../config');

// ── HTTP Health Server ────────────────────────────────────────────────────────

/**
 * Starts a minimal HTTP server for health checks and Heroku PORT binding.
 * Stores the server instance on bot.httpServer for graceful shutdown.
 *
 * Responds to GET / and GET /health with a JSON status payload:
 *   { status: 'healthy'|'degraded', uptime, memory, activeJobs, connection }
 *
 * @param {object} bot - The DillBot instance
 */
function startHttpServer(bot) {
  const port = process.env.PORT || 3000;

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === '/health' || req.url === '/') {
      const connectionStatus = getConnectionStatus(bot);
      const activeJobs = bot.schedulerService.getActiveJobCount();
      const memoryMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: connectionStatus.connected ? 'healthy' : 'degraded',
        service: 'dill-bot',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: `${memoryMb}MB`,
        activeJobs,
        connection: connectionStatus,
        message: connectionStatus.connected
          ? 'Dill Bot is running and healthy!'
          : 'Dill Bot is running but connection is down',
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(port, () => {
    console.log(`[INFO] HTTP server listening on port ${port}`);
    console.log(`[INFO] Health check available at http://localhost:${port}/health`);
  });

  bot.httpServer = server;
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

/**
 * Registers SIGINT/SIGTERM handlers and an uncaughtException guard.
 *
 * The 10-second force-exit ensures the process doesn't hang if Slack's stop
 * call never resolves (e.g. during network outages at shutdown time).
 *
 * @param {object} bot - The DillBot instance
 */
function setupGracefulShutdown(bot) {
  const shutdown = async (signal) => {
    console.log(`[INFO] Received ${signal}, shutting down gracefully...`);
    try {
      bot.schedulerService.stopAllJobs();
      console.log('[INFO] Scheduler jobs stopped');

      if (bot.httpServer) {
        await new Promise(resolve => bot.httpServer.close(resolve));
        console.log('[INFO] HTTP server closed');
      }

      if (bot.app?.stop) {
        await bot.app.stop();
        console.log('[INFO] Slack app stopped');
      }
    } catch (err) {
      console.error('[ERROR] Error during shutdown:', err);
    } finally {
      process.exit(0);
    }
  };

  let shutdownInitiated = false;
  const shutdownOnce = (signal) => {
    if (shutdownInitiated) return;
    shutdownInitiated = true;
    // Force-exit if graceful shutdown hangs (e.g. Slack API unresponsive)
    setTimeout(() => {
      console.error('[ERROR] Shutdown taking too long, forcing exit');
      process.exit(1);
    }, config.GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    shutdown(signal);
  };

  process.on('SIGINT', () => shutdownOnce('SIGINT'));
  process.on('SIGTERM', () => shutdownOnce('SIGTERM'));

  // WebSocket state machine errors are non-fatal; let the app recover via
  // the reconnection logic in connection.js rather than crashing.
  process.on('uncaughtException', (error) => {
    console.error('[FATAL] Uncaught Exception:', error);
    if (error.message?.includes('Unhandled event')) {
      console.error('[FATAL] WebSocket state machine error – attempting recovery.');
      return;
    }
    setTimeout(() => {
      console.error('[FATAL] Exiting due to uncaught exception');
      process.exit(1);
    }, 5000);
  });
}

module.exports = { startHttpServer, setupGracefulShutdown };
