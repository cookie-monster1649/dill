// ── Socket Mode Connection Management ────────────────────────────────────────
//
// Encapsulates everything related to the Slack WebSocket connection lifecycle:
// creating the socket receiver, wiring up reconnection logic, and exposing
// health-check helpers.
//
// These functions all receive the bot instance so they can access this.app,
// this.socketReceiver, etc., without needing to be class methods.

const { SocketModeReceiver, LogLevel } = require('@slack/bolt');

// ── Setup ─────────────────────────────────────────────────────────────────────

/**
 * Creates and configures the Socket Mode receiver, attaching all WebSocket
 * event listeners. Stores the result on bot.socketReceiver.
 *
 * Called once during bot construction, and again during restartSocketMode.
 *
 * @param {object} bot - The DillBot instance
 * @returns {SocketModeReceiver}
 */
function setupSocketReceiver(bot) {
  const socketReceiver = new SocketModeReceiver({
    appToken: process.env.SLACK_APP_TOKEN,
    logLevel: LogLevel.DEBUG,
    connectionTimeout: 30000,
    maxReconnectionAttempts: 10,
    reconnectionBackoff: 1000,
  });

  socketReceiver.client.on('unable_to_socket_mode_start', () => {
    console.error('[ERROR] Unable to start Socket Mode client');
    setTimeout(() => restartSocketMode(bot), 30000);
  });

  socketReceiver.client.on('unable_to_send_socket_request', (error) => {
    console.error('[ERROR] Unable to send socket request:', error);
  });

  // Slack closes the socket when it detects duplicate connections.
  // We back off longer in that case to give other instances time to die.
  socketReceiver.client.on('close', (code, reason) => {
    console.warn(`[WARN] Socket Mode connection closed (code: ${code}, reason: ${reason})`);
    if (reason === 'too_many_websockets') {
      console.error('[ERROR] Too many WebSocket connections – ensure only one bot instance is running.');
      setTimeout(() => restartSocketMode(bot), 60000);
    }
  });

  socketReceiver.client.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error);
    if (error.message?.includes('server explicit disconnect')) {
      console.error('[ERROR] Server explicitly disconnected – likely a network or Slack service issue.');
      setTimeout(() => restartSocketMode(bot), 30000);
    }
  });

  // Catch-all for promise rejections that bubble up from the socket layer.
  // We handle the known "server explicit disconnect" case gracefully; for
  // everything else we log but don't exit.
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled Rejection:', reason);
    if (reason?.message?.includes('server explicit disconnect')) {
      console.error('[ERROR] Handling server explicit disconnect gracefully.');
      setTimeout(() => restartSocketMode(bot), 30000);
      return;
    }
    console.error('[ERROR] Unhandled promise rejection – continuing execution.');
  });

  bot.socketReceiver = socketReceiver;
  return socketReceiver;
}

// ── Reconnection ──────────────────────────────────────────────────────────────

/**
 * Tears down the current socket connection and re-initialises the Slack app.
 * Retries itself after 60 s if the restart attempt itself fails.
 *
 * @param {object} bot - The DillBot instance
 */
async function restartSocketMode(bot) {
  try {
    console.log('[INFO] Restarting Socket Mode client...');

    if (bot.socketReceiver?.client) {
      try {
        await bot.socketReceiver.client.disconnect();
      } catch (e) {
        console.warn('[WARN] Error disconnecting existing client:', e.message);
      }
    }

    // Brief pause to let the old connection fully close before re-opening
    await new Promise(resolve => setTimeout(resolve, 2000));

    bot.initializeSlackApp();
    await bot.app.start();

    console.log('[INFO] Socket Mode client restarted successfully');
  } catch (error) {
    console.error('[ERROR] Failed to restart Socket Mode client:', error);
    setTimeout(() => restartSocketMode(bot), 60000);
  }
}

// ── Health Checks ─────────────────────────────────────────────────────────────

/**
 * Returns a status object describing the current WebSocket connection state.
 *
 * Example result:
 *   { connected: true, status: 'Connected', url: 'wss://...' }
 *
 * @param {object} bot - The DillBot instance
 * @returns {{ connected: boolean, status: string, url?: string }}
 */
function getConnectionStatus(bot) {
  if (!bot.socketReceiver?.client) {
    return { connected: false, status: 'No socket receiver' };
  }
  return {
    connected: bot.socketReceiver.client.connected,
    status: bot.socketReceiver.client.connected ? 'Connected' : 'Disconnected',
    url: bot.socketReceiver.client.url || 'Unknown',
  };
}

/** @param {object} bot */
function isConnectionHealthy(bot) {
  return bot.socketReceiver?.client?.connected ?? false;
}

/**
 * Logs a warning when the connection is down. Logs a success line
 * ~10% of the time when healthy (to avoid log noise on every health check).
 *
 * @param {object} bot
 */
function checkConnectionHealth(bot) {
  const status = getConnectionStatus(bot);
  if (!status.connected) {
    console.warn('[WARN] Slack connection is down:', status.status);
    if (bot.socketReceiver?.client) {
      const c = bot.socketReceiver.client;
      console.warn('[WARN] Connection details:', { url: c.url, readyState: c.readyState, connected: c.connected });
    }
  } else if (Math.random() < 0.1) {
    console.log('[INFO] Slack connection health check: OK');
  }
}

module.exports = { setupSocketReceiver, restartSocketMode, getConnectionStatus, isConnectionHealthy, checkConnectionHealth };
