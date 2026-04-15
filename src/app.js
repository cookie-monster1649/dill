// ── Dill Bot – Orchestrator ───────────────────────────────────────────────────
//
// This file wires together all the modules that make up the bot. It should
// contain no business logic – just construction, registration, and delegation.
//
// If you're looking for a specific behaviour, check these modules:
//   Slack connection/reconnection  →  src/bot/connection.js
//   HTTP server + shutdown         →  src/bot/lifecycle.js
//   Pick posting + scheduling      →  src/bot/pickLifecycle.js
//   Rotation data (delete/rename)  →  src/bot/rotationData.js
//   Modal building                 →  src/bot/modalBuilders.js
//   /dill help|status|reset|pick   →  src/commands/adminCommands.js
//   /dill restore-backup etc.      →  src/commands/backupCommands.js
//   Button/modal callbacks         →  src/handlers/actionHandlers.js
//   Leave calendar UI              →  src/handlers/leaveHandlers.js

require('dotenv').config();

const { App, LogLevel } = require('@slack/bolt');

// ── Module imports ────────────────────────────────────────────────────────────

const NestedStore              = require('./stores/NestedStore');
const AnalyticsService         = require('./services/analyticsService');
const SchedulerService         = require('./services/schedulerService');
const PersistentStorageService = require('./services/persistentStorageService');
const ActionHandlers           = require('./handlers/actionHandlers');

const { RateLimiter }            = require('./utils/slackHelpers');
const { generateTimezoneOptions } = require('./utils/dateHelpers');

const { setupSocketReceiver }    = require('./bot/connection');
const { startHttpServer, setupGracefulShutdown } = require('./bot/lifecycle');
const { startPick, scheduleAll, performRotationDailyReset } = require('./bot/pickLifecycle');
const { cleanupRotationData, renameRotationData }           = require('./bot/rotationData');
const { openSelectModal, openNewRotationModal, buildNewRotationViewForBot, buildRotationsViewBlocks, buildRotationsView } = require('./bot/modalBuilders');
const { handleHelpCommand, handleStatusCommand, handleResetCommand, handlePickCommand } = require('./commands/adminCommands');
const { handleRestoreBackupCommand, handleDeleteBackupCommand, handleDeleteBackupConfirm, handleKillKillKillCommand } = require('./commands/backupCommands');
const { openLeaveModal, handleLeaveAddOpen, handleLeaveAddSubmit, handleLeaveRemove } = require('./handlers/leaveHandlers');

const config = require('../config');

// ── DillBot class ─────────────────────────────────────────────────────────────

class DillBot {

  // ── Construction ────────────────────────────────────────────────────────────

  constructor() {
    this.config = config;

    this.configStore   = new NestedStore('configs.json');
    this.queueStore    = new NestedStore('rotations.json');
    this.stateStore    = new NestedStore('activestate.json');
    this.leaveStore    = new NestedStore('leave.json');

    this.analyticsService  = new AnalyticsService(config.ANALYTICS_RETENTION_DAYS);
    this.schedulerService  = new SchedulerService();

    this.rateLimiter = new RateLimiter(config.RATE_LIMIT_WINDOW, config.RATE_LIMIT_MAX_ACTIONS);

    // Timezone options are expensive to generate; compute once at startup
    this.timezoneOptions = generateTimezoneOptions();

    this.persistentStorageService = null;

    this.initializeSlackApp();
  }

  // ── Slack App Initialisation ─────────────────────────────────────────────────

  initializeSlackApp() {
    const socketReceiver = setupSocketReceiver(this);

    // Map LOG_LEVEL env var to the Bolt LogLevel enum.
    // Defaults to INFO – DEBUG logs full HTTP payloads including auth headers,
    // so it should only be enabled explicitly during local development.
    const boltLogLevel = LogLevel[config.LOG_LEVEL?.toUpperCase()] ?? LogLevel.INFO;

    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      receiver: socketReceiver,
      logLevel: boltLogLevel,
    });

    this.app.error(async (error) => {
      console.error('[GLOBAL ERROR] Unhandled error in Slack Bolt app:', error);
      const ctx = error?.context?.body;
      if (ctx?.user_id && ctx?.channel_id) {
        try {
          await this.app.client.chat.postEphemeral({
            channel: ctx.channel_id,
            user: ctx.user_id,
            text: ':x: Something went wrong. Please try again or contact support.',
          });
        } catch (e) {
          console.error('[GLOBAL ERROR] Could not notify user:', e);
        }
      }
    });

    this.setupEventHandlers();
  }

  // ── Event Handler Registration ───────────────────────────────────────────────

  setupEventHandlers() {
    const handlers = new ActionHandlers(this);
    this.actionHandlers = handlers;

    this.app.command('/dill', this.handleSlashCommand.bind(this));

    this.app.view('dill_select',            handlers.handleViewSubmission.bind(handlers));
    this.app.view('dill_new',               handlers.handleRotationFormSubmission.bind(handlers));
    this.app.view('rotation_settings',      handlers.handleRotationSettingsSubmission.bind(handlers));
    this.app.view('delete_rotation_confirm',handlers.handleDeleteConfirmation.bind(handlers));
    this.app.view('delete_backup_confirm',  this.handleDeleteBackupConfirm.bind(this));

    this.app.action('create_new',           handlers.handleCreateNewAction.bind(handlers));
    this.app.action('edit_rotation',        handlers.handleEditRotationAction.bind(handlers));
    this.app.action('rotation_settings',    handlers.handleRotationSettingsAction.bind(handlers));
    this.app.action('delete_rotation_start',handlers.handleDeleteStartAction.bind(handlers));
    this.app.action('accept',               handlers.handleAcceptAction.bind(handlers));
    this.app.action('skip',                 handlers.handleSkipAction.bind(handlers));
    this.app.action('future_skip',          handlers.handleFutureSkipAction.bind(handlers));

    // ── Leave actions / views ──────────────────────────────────────────────
    // Both tab buttons use views.update to swap the modal content in place,
    // so the user never sees a second modal opening on top of the first.
    this.app.action('open_leave_tab', async ({ ack, body, client }) => {
      await ack();
      const channel = body.view?.private_metadata;
      return openLeaveModal(this, client, body.view.id, body.view.hash, channel);
    });
    this.app.action('open_rotations_tab', async ({ ack, body, client }) => {
      await ack();
      const channel = body.view?.private_metadata;
      try {
        const view = await buildRotationsView(this, channel);
        await client.views.update({ view_id: body.view.id, hash: body.view.hash, view });
      } catch (e) {
        console.error('[ERROR] Failed to switch to Rotations tab:', e);
      }
    });
    this.app.action('leave_add_open', async ({ ack, action, body, client }) => {
      await ack();
      return handleLeaveAddOpen(this, client, body.trigger_id, action.value);
    });
    this.app.action('leave_remove',   async (payload) => handleLeaveRemove(this, payload));
    this.app.view('dill_leave_add',   async (payload) => handleLeaveAddSubmit(this, payload));
  }

  // ── Slash Command Router ─────────────────────────────────────────────────────

  async handleSlashCommand({ ack, body, client, command }) {
    await ack();
    const channel = body.channel_id;
    const [subcommand, ...args] = (command.text || '').trim().split(' ');
    console.log('[LOG] Slash command:', { subcommand, args, channel, user: body.user_id });

    try {
      switch (subcommand.toLowerCase()) {
        case 'help':           return handleHelpCommand(this, client, body, channel);
        case 'status':         return handleStatusCommand(this, client, body, channel);
        case 'reset':          return handleResetCommand(this, client, body, channel, args);
        case 'pick':           return handlePickCommand(this, client, body, channel, args);
        case 'restore-backup': return handleRestoreBackupCommand(this, client, body, channel);
        case 'delete-backup':  return handleDeleteBackupCommand(this, client, body, channel);
        case 'kill-kill-kill': return handleKillKillKillCommand(this, client, body, channel, args);
        default: {
          const text = (command.text || '').trim();
          if (text) {
            return this.openNewRotationModal(client, body.trigger_id, channel, text);
          }
          return this.openSelectModal(client, body.trigger_id, channel);
        }
      }
    } catch (error) {
      console.error('[ERROR] Slash command failed:', error);
      try {
        await client.chat.postEphemeral({
          channel,
          user: body.user_id,
          text: ':x: Something went wrong. Please try again or contact support.',
        });
      } catch (e) {
        console.error('[ERROR] Could not notify user of slash command error:', e);
      }
    }
  }

  // ── Persistent Storage ───────────────────────────────────────────────────────

  async initializePersistentStorage() {
    const storageChannelId = process.env.DILL_STORAGE_CHANNEL_ID;
    if (!storageChannelId) {
      console.warn('[WARN] DILL_STORAGE_CHANNEL_ID not set – persistent storage disabled');
      return;
    }

    this.persistentStorageService = new PersistentStorageService(
      this.app.client,
      storageChannelId,
      { configStore: this.configStore, queueStore: this.queueStore, stateStore: this.stateStore, analyticsService: this.analyticsService, leaveStore: this.leaveStore },
      config
    );

    const restored = await this.persistentStorageService.initialize();
    if (restored) {
      console.log('[INFO] Database restored from Slack backup');
    } else {
      console.log('[INFO] No backup found – starting fresh and creating initial backup');
      await this.persistentStorageService.createBackup();
    }
  }

  async createBackup() {
    if (this.persistentStorageService) {
      try {
        await this.persistentStorageService.createBackup();
      } catch (error) {
        console.error('[ERROR] Failed to create backup:', error);
      }
    }
  }

  // ── Startup ──────────────────────────────────────────────────────────────────

  async start() {
    console.log('[INFO] Starting Dill Bot...');
    await this.app.start();
    console.log('[INFO] Slack app started');

    await this.initializePersistentStorage();
    this.scheduleAll();
    startHttpServer(this);
    setupGracefulShutdown(this);

    console.log('[INFO] Dill Bot is ready!');
  }

  // ── Delegate Methods ─────────────────────────────────────────────────────────
  //
  // These thin wrappers exist so that actionHandlers.js can call this.bot.*
  // without needing to import the underlying modules directly. They have no
  // logic of their own.

  startPick(channel, name)                               { return startPick(this, channel, name); }
  scheduleAll()                                          { return scheduleAll(this); }
  performRotationDailyReset(channel, name, config)       { return performRotationDailyReset(this, channel, name, config); }
  cleanupRotationData(channel, name)                     { return cleanupRotationData(this, channel, name); }
  renameRotationData(channel, oldName, newName)          { return renameRotationData(this, channel, oldName, newName); }
  openSelectModal(client, triggerId, channel)            { return openSelectModal(this, client, triggerId, channel); }
  openNewRotationModal(client, triggerId, channel, pre)  { return openNewRotationModal(this, client, triggerId, channel, pre); }
  buildNewRotationView(channel, preName)                 { return buildNewRotationViewForBot(this, channel, preName); }
  buildRotationsViewBlocks(channel)                      { return buildRotationsViewBlocks(this, channel); }

  // Forwarded to backupCommands so it can be bound as a Bolt view handler
  async handleDeleteBackupConfirm(payload) {
    return handleDeleteBackupConfirm(this, payload);
  }
}

module.exports = DillBot;
