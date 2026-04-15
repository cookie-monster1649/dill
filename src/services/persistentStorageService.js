/**
 * Persistent Storage Service using Slack Canvases
 *
 * This service provides persistent storage by updating a dedicated Slack Canvas
 * with database dumps. The Canvas is cleared and replaced with the latest backup
 * each time a backup occurs.
 *
 * Required permissions: canvases:write
 * Set DILL_STORAGE_CANVAS_ID in your environment to the Canvas ID to use.
 */

const { slackApiCall } = require('../utils/slackHelpers');
const crypto = require('crypto');
const zlib = require('zlib');

/**
 * Persistent Storage Service class for Slack-based data persistence.
 */
class PersistentStorageService {
  /**
   * Creates a new PersistentStorageService instance.
   * @param {object} slackClient - The Slack client instance
   * @param {string} storageChannelId - The Slack Channel ID for storage
   * @param {object} stores - Object containing all data stores
   * @param {object} config - Application configuration
   */
  constructor(slackClient, storageChannelId, stores, config) {
    this.slackClient = slackClient;
    if (!storageChannelId || !storageChannelId.match(/^C[A-Z0-9]{9,}$/)) {
      throw new Error('Invalid storage channel ID format. Must start with "C" followed by 9+ characters.');
    }
    this.storageChannelId = storageChannelId;
    this.stores = stores;
    this.config = config;
    this.lastBackupTimestamp = null;
    this.lastBackupTime = 0;
    this.lastBackupMessageTs = null; // Store the last backup message timestamp
    this.pendingBackup = false;
    this.backupThrottleMs = config.BACKUP_THROTTLE_MS;
  }

  /**
   * Creates a comprehensive database dump containing all bot data.
   * 
   * @returns {object} Complete database state
   */
  createDatabaseDump() {
    const timestamp = new Date().toISOString();
    const dump = {
      version: '1.0',
      timestamp: timestamp,
      schema: {
        configs: 'Channel -> Rotation Name -> Configuration',
        rotations: 'Channel -> Rotation Name -> Queue/Cycles',
        activestate: 'Channel -> Message TS -> Pick State',
        analytics: 'Date -> Events Array'
      },
      data: {
        configs: this.stores.configStore.data || {},
        rotations: this.stores.queueStore.data || {},
        activestate: this.stores.stateStore.data || {},
        analytics: this.stores.analyticsService?.analyticsStore.data || {},
        leave: this.stores.leaveStore?.data || {}
      },
      metadata: {
        totalChannels: Object.keys(this.stores.configStore.data || {}).length,
        totalRotations: this.countTotalRotations(),
        totalActivePicks: this.countActivePicks(),
        totalAnalyticsEvents: this.countTotalAnalyticsEvents()
      }
    };

    return dump;
  }

  /**
   * Counts the total number of rotations across all channels.
   * 
   * @returns {number} Total rotation count
   */
  countTotalRotations() {
    const configs = this.stores.configStore.data || {};
    let count = 0;
    for (const channelId in configs) {
      count += Object.keys(configs[channelId] || {}).length;
    }
    return count;
  }

  /**
   * Counts the total number of active picks across all channels.
   * 
   * @returns {number} Total active picks count
   */
  countActivePicks() {
    const activestate = this.stores.stateStore.data || {};
    let count = 0;
    for (const channelId in activestate) {
      count += Object.keys(activestate[channelId] || {}).length;
    }
    return count;
  }

  /**
   * Counts the total number of analytics events.
   * 
   * @returns {number} Total analytics events count
   */
  countTotalAnalyticsEvents() {
    const analytics = this.stores.analyticsService?.analyticsStore.data || {};
    let count = 0;
    for (const date in analytics.events || {}) {
      count += (analytics.events[date] || []).length;
    }
    return count;
  }

  /**
   * Creates a compact backup representation that fits in a single Slack block.
   * 
   * @param {object} dump - The full database dump
   * @returns {string} Compact backup text
   */
  createCompactBackup(dump) {
    const { data, metadata } = dump;
    
    // Create a compact summary
    let summary = `*📊 Database Summary*\n`;
    summary += `• Channels: ${metadata.totalChannels}\n`;
    summary += `• Rotations: ${metadata.totalRotations}\n`;
    summary += `• Active Picks: ${metadata.totalActivePicks}\n`;
    summary += `• Analytics Events: ${metadata.totalAnalyticsEvents}\n\n`;
    
    // Add channel breakdown
    summary += `*📋 Channel Breakdown*\n`;
    const configs = data.configs || {};
    for (const channelId in configs) {
      const channelConfigs = configs[channelId] || {};
      const rotationCount = Object.keys(channelConfigs).length;
      const activePicks = (data.activestate?.[channelId] || {});
      const activePickCount = Object.keys(activePicks).length;
      
      summary += `• <#${channelId}>: ${rotationCount} rotations, ${activePickCount} active picks\n`;
    }
    
    // Add recent analytics summary (last 7 days)
    summary += `\n*📈 Recent Activity (7 days)*\n`;
    const analytics = data.analytics || {};
    const events = analytics.events || {};
    const recentDates = Object.keys(events).sort().slice(-7);
    
    if (recentDates.length > 0) {
      for (const date of recentDates) {
        const dayEvents = events[date] || [];
        const eventCount = dayEvents.length;
        if (eventCount > 0) {
          summary += `• ${date}: ${eventCount} events\n`;
        }
      }
    } else {
      summary += `• No recent activity\n`;
    }
    
    // Add compressed data hash for integrity checking
    const dataHash = this.createDataHash(data);
    summary += `\n*🔐 Data Integrity*\n`;
    summary += `• Hash: \`${dataHash}\`\n`;
    summary += `• Timestamp: ${dump.timestamp}\n`;
    
    // Ensure we stay within Slack's limit
    if (summary.length > 2800) {
      summary = summary.substring(0, 2797) + '...';
    }
    
    return summary;
  }

  /**
   * Creates a SHA-256 hash of the data for integrity checking.
   * Returns the first 16 hex chars (64 bits) – enough to catch corruption
   * without bloating the backup summary.
   *
   * @param {object} data - The data to hash
   * @returns {string} Hex hash string
   */
  createDataHash(data) {
    const dataString = JSON.stringify(data);
    return crypto.createHash('sha256').update(dataString).digest('hex').slice(0, 16);
  }

  /**
   * Splits a string into chunks of specified size.
   * @param {string} str - The string to split
   * @param {number} size - The size of each chunk
   * @returns {Array<string>} Array of string chunks
   */
  splitJsonForSlack(str, size = 2900) {
    const chunks = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Backs up the database by posting a message to a Slack channel.
   * Only one backup message is kept in the channel at any time.
   */
  async backupToSlackChannel() {
    const now = Date.now();
    if (now - this.lastBackupTime < this.backupThrottleMs) {
      if (!this.pendingBackup) {
        this.pendingBackup = true;
        const waitMs = this.backupThrottleMs - (now - this.lastBackupTime);
        console.log(`[INFO] Backup throttled. Will run in ${Math.ceil(waitMs/1000)}s.`);
        setTimeout(async () => {
          this.pendingBackup = false;
          await this.backupToSlackChannel();
        }, waitMs);
      } else {
        console.log('[INFO] Backup already scheduled, skipping duplicate request.');
      }
      return;
    }
    this.lastBackupTime = now;
    try {
      const dump = this.createDatabaseDump();
      const dumpJson = JSON.stringify(dump, null, 2);
      const summary = this.createCompactBackup(dump);
      // Compress the JSON data with brotli
      let compressedData;
      try {
        compressedData = zlib.brotliCompressSync(Buffer.from(dumpJson, 'utf8'));
        console.log(`[INFO] Compressed backup JSON from ${dumpJson.length} to ${compressedData.length} bytes (brotli)`);
      } catch (e) {
        console.warn('[WARN] Failed to compress backup data with brotli:', e.message);
        compressedData = Buffer.from(dumpJson, 'utf8');
      }
      // Optionally encrypt the compressed bytes before encoding.
      // When the key is absent the backup is still brotli-compressed but plaintext.
      let payloadBuffer = compressedData;
      if (ENCRYPTION_KEY) {
        const encrypted = encrypt(compressedData.toString('base64'), ENCRYPTION_KEY);
        payloadBuffer = Buffer.from(encrypted, 'utf8');
        console.log('[INFO] Backup payload encrypted with AES-256-CBC');
      }

      // Encode as base64 for Slack
      const b64 = payloadBuffer.toString('base64');
      // Compose blocks: summary, then compressed backup as code block
      const blocks = [
        { type: "section", text: { type: "mrkdwn", text: `*Dill Bot Database Backup*\n${summary}` } },
        { type: "section", text: { type: "mrkdwn", text: '```' + b64 + '```' } }
      ];

      // Always find the most recent backup message in the channel
      let backupMsgTs = null;
      try {
        const result = await slackApiCall(this.slackClient.conversations.history, {
          channel: this.storageChannelId,
          limit: 20
        });
        for (const msg of result.messages) {
          if (
            msg.blocks &&
            msg.blocks.length >= 2 &&
            msg.blocks[0].type === 'section' &&
            msg.blocks[0].text &&
            msg.blocks[0].text.text &&
            msg.blocks[0].text.text.startsWith('*Dill Bot Database Backup*') &&
            msg.blocks[1].type === 'section' &&
            msg.blocks[1].text &&
            msg.blocks[1].text.text &&
            msg.blocks[1].text.text.startsWith('```')
          ) {
            backupMsgTs = msg.ts;
            break;
          }
        }
      } catch (err) {
        console.warn(`[WARN] Could not search for previous backup messages: ${err.message}`);
      }

      if (backupMsgTs) {
        // Update the most recent backup message
        try {
          await slackApiCall(this.slackClient.chat.update, {
            channel: this.storageChannelId,
            ts: backupMsgTs,
            text: "Dill Bot Database Backup",
            blocks
          });
          this.lastBackupTimestamp = dump.timestamp;
          console.log(`[INFO] Updated previous backup message in Slack channel ${this.storageChannelId}`);
          return true;
        } catch (err) {
          console.warn(`[WARN] Failed to update previous backup message: ${err.message}`);
          // If update fails (e.g., message deleted), fall through to post a new message
        }
      }

      // If no previous message or update failed, post a new one
      const postResult = await slackApiCall(this.slackClient.chat.postMessage, {
        channel: this.storageChannelId,
        text: "Dill Bot Database Backup",
        blocks
      });
      this.lastBackupTimestamp = dump.timestamp;
      console.log(`[INFO] Posted new backup message to Slack channel ${this.storageChannelId}`);
      return true;
    } catch (error) {
      console.error('[ERROR] Failed to backup database to Slack channel:', error);
      throw error;
    }
  }

  /**
   * Loads the most recent full database backup from the storage channel.
   * @returns {Promise<object|null>} The database dump or null if not found
   */
  async loadFromSlack() {
    try {
      // Get the most recent 100 messages from the storage channel
      const result = await slackApiCall(this.slackClient.conversations.history, {
        channel: this.storageChannelId,
        limit: 100
      });
      if (!result.messages || result.messages.length === 0) {
        console.log('[INFO] No previous database backups found in Slack channel');
        return null;
      }
      // Find the most recent backup message with the expected format
      let found = null;
      for (const msg of result.messages) {
        if (!msg.blocks || msg.blocks.length < 2) continue;
        const firstBlock = msg.blocks[0];
        const secondBlock = msg.blocks[1];
        if (
          firstBlock.type === 'section' &&
          firstBlock.text &&
          firstBlock.text.text &&
          firstBlock.text.text.startsWith('*Dill Bot Database Backup*') &&
          secondBlock.type === 'section' &&
          secondBlock.text &&
          secondBlock.text.text &&
          secondBlock.text.text.startsWith('```')
        ) {
          found = msg;
          break;
        }
      }
      if (!found) {
        console.log('[INFO] No valid database backup found in Slack channel');
        return null;
      }
      // Extract the base64 code block from the second block
      const b64Match = found.blocks[1].text.text.match(/```([\s\S]+?)```/);
      if (!b64Match) {
        console.warn('[WARN] Could not extract base64 data from backup message');
        return null;
      }
      const b64 = b64Match[1].trim();

      // Decode from base64, then optionally decrypt, then brotli-decompress.
      // The key must match whatever was set when the backup was written.
      let payloadBuffer = Buffer.from(b64, 'base64');
      if (ENCRYPTION_KEY) {
        try {
          const decryptedB64 = decrypt(payloadBuffer.toString('utf8'), ENCRYPTION_KEY);
          payloadBuffer = Buffer.from(decryptedB64, 'base64');
          console.log('[INFO] Backup payload decrypted successfully');
        } catch (e) {
          console.error('[ERROR] Failed to decrypt backup data – wrong key or unencrypted backup?', e.message);
          return null;
        }
      }

      // Decompress with brotli
      let decompressedJson;
      try {
        const decompressedBuf = zlib.brotliDecompressSync(payloadBuffer);
        decompressedJson = decompressedBuf.toString('utf8');
        console.log(`[INFO] Decompressed backup JSON to ${decompressedJson.length} bytes`);
      } catch (e) {
        console.error('[ERROR] Failed to decompress backup data with brotli:', e.message);
        return null;
      }
      if (!decompressedJson.trim() || decompressedJson[0] !== '{' || decompressedJson[decompressedJson.length - 1] !== '}') {
        console.warn('[WARN] Decompressed backup data appears incomplete or corrupted. It does not start/end with curly braces.');
      }
      let dump;
      try {
        dump = JSON.parse(decompressedJson);
      } catch (jsonError) {
        console.error('[ERROR] Failed to parse JSON from Slack backup:', jsonError.message);
        console.error('[ERROR] Offending JSON (first 200 chars):', decompressedJson.slice(0, 200));
        console.error('[ERROR] Offending JSON length:', decompressedJson.length);
        // Optionally, write the bad JSON to a file for manual inspection
        try {
          require('fs').writeFileSync('bad-slack-backup.json', decompressedJson);
          console.error('[ERROR] Wrote bad JSON to bad-slack-backup.json for inspection.');
        } catch (fsError) {
          console.error('[ERROR] Failed to write bad JSON to file:', fsError.message);
        }
        if (!decompressedJson.trim().endsWith('}')) {
          console.error('[ERROR] JSON appears to be truncated (does not end with "}").');
        }
        return null;
      }
      console.log(`[INFO] Loaded database backup from Slack (timestamp: ${dump.timestamp})`);
      return dump;
    } catch (error) {
      console.error('[ERROR] Failed to load database from Slack:', error);
      return null;
    }
  }



  /**
   * Extracts backup information from a compact backup message.
   * 
   * @param {object} message - The Slack message object
   * @returns {object|null} The backup info or null
   */
  extractBackupInfo(message) {
    if (!message.blocks) return null;
    
    for (const block of message.blocks) {
      if (block.type === 'section' && block.text && block.text.text) {
        const text = block.text.text;
        
        // Extract timestamp from the text
        const timestampMatch = text.match(/Timestamp: (.+)/);
        const hashMatch = text.match(/Hash: `([a-f0-9]+)`/);
        
        if (timestampMatch && hashMatch) {
          return {
            timestamp: timestampMatch[1],
            dataHash: hashMatch[1],
            type: 'compact',
            message: text
          };
        }
      }
    }
    
    return null;
  }

  /**
   * Restores the database from a backup dump.
   * 
   * @param {object} dump - The database dump object
   */
  restoreFromDump(dump) {
    try {
      if (!dump) {
        console.warn('[WARN] Invalid database dump format');
        return false;
      }

      // Handle compact backup format (read-only)
      if (dump.type === 'compact') {
        console.log('[INFO] Compact backup found - this is a summary only, cannot restore full data');
        console.log('[INFO] Backup summary:', dump.message);
        this.lastBackupTimestamp = dump.timestamp;
        return true;
      }

      // Handle full backup format
      if (!dump.data) {
        console.warn('[WARN] Invalid database dump format - missing data');
        return false;
      }

      // Restore each store
      if (dump.data.configs) {
        this.stores.configStore.data = dump.data.configs;
        this.stores.configStore.save();
        console.log('[INFO] Restored configs store');
      }

      if (dump.data.rotations) {
        this.stores.queueStore.data = dump.data.rotations;
        this.stores.queueStore.save();
        console.log('[INFO] Restored rotations store');
      }

      if (dump.data.activestate) {
        this.stores.stateStore.data = dump.data.activestate;
        this.stores.stateStore.save();
        console.log('[INFO] Restored activestate store');
      }

      if (dump.data.analytics && this.stores.analyticsService) {
        this.stores.analyticsService.analyticsStore.data = dump.data.analytics;
        console.log('[INFO] Restored analytics store');
      }

      // Guard for older backups that pre-date the leave feature
      if (dump.data.leave && this.stores.leaveStore) {
        this.stores.leaveStore.data = dump.data.leave;
        this.stores.leaveStore.save();
        console.log('[INFO] Restored leave store');
      }

      this.lastBackupTimestamp = dump.timestamp;
      console.log(`[INFO] Database restored from backup (timestamp: ${dump.timestamp})`);
      return true;

    } catch (error) {
      console.error('[ERROR] Failed to restore database from dump:', error);
      return false;
    }
  }

  /**
   * Initializes the storage channel and loads the most recent backup.
   * 
   * @returns {Promise<boolean>} True if backup was loaded successfully
   */
  async initialize() {
    try {
      console.log('[INFO] Initializing persistent storage service...');
      
      // Try to load the most recent backup
      const backup = await this.loadFromSlack();
      
      if (backup) {
        const restored = this.restoreFromDump(backup);
        if (restored) {
          console.log('[INFO] Database restored from Slack backup');
          return true;
        }
      }
      
      console.log('[INFO] No valid backup found, starting with fresh database');
      return false;
      
    } catch (error) {
      console.error('[ERROR] Failed to initialize persistent storage:', error);
      return false;
    }
  }

  /**
   * Creates a backup and writes it to the Slack Canvas.
   * This should be called whenever important data changes.
   *
   * @returns {Promise<boolean>} True if backup was successful
   */
  async createBackup() {
    try {
      await this.backupToSlackChannel();
      return true;
    } catch (error) {
      console.error('[ERROR] Failed to create backup:', error);
      return false;
    }
  }

  /**
   * Gets backup statistics.
   * 
   * @returns {object} Backup statistics
   */
  getBackupStats() {
    return {
      lastBackupTimestamp: this.lastBackupTimestamp,
      storageChannelId: this.storageChannelId,
      isInitialized: !!this.slackClient
    };
  }

  /**
   * Deletes all backup messages from the storage Slack channel.
   * Used for full data wipes (kill-kill-kill).
   */
  async deleteAllBackups() {
    try {
      // Search for all backup messages in the storage channel
      let cursor = undefined;
      let deleted = 0;
      do {
        const res = await this.slackClient.conversations.history({
          channel: this.storageChannelId,
          limit: 200,
          cursor
        });
        for (const msg of res.messages || []) {
          if (msg.blocks && msg.blocks[0]?.text?.text?.startsWith('*Dill Bot Database Backup*')) {
            try {
              await this.slackClient.chat.delete({ channel: this.storageChannelId, ts: msg.ts });
              deleted++;
            } catch (e) {
              // Log and continue
              console.warn(`[WARN] Failed to delete backup message ${msg.ts}: ${e.message}`);
            }
          }
        }
        cursor = res.response_metadata?.next_cursor;
      } while (cursor);
      return deleted;
    } catch (e) {
      throw new Error('Failed to delete all Slack backups: ' + e.message);
    }
  }
}

const ENCRYPTION_KEY = process.env.DILL_BACKUP_ENCRYPTION_KEY;
const ENCRYPTION_ALGO = 'aes-256-cbc';
const ENCRYPTION_IV_LENGTH = 16; // 128 bits

function encrypt(text, key) {
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

function decrypt(enc, key) {
  const [ivB64, encrypted] = enc.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, Buffer.from(key, 'hex'), iv);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = PersistentStorageService; 