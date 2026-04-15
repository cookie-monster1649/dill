// ── Backup Commands ───────────────────────────────────────────────────────────
//
// Handlers for /dill restore-backup, /dill delete-backup, and the dangerous
// /dill kill-kill-kill command. All three are storage-management operations
// that live here rather than in adminCommands.js because they touch
// persistentStorageService rather than rotation state.

// ── Restore ───────────────────────────────────────────────────────────────────

/**
 * Loads the most recent Slack backup and restores all stores from it.
 * Re-schedules all jobs after a successful restore so cron timers reflect
 * the restored config.
 *
 * @param {object} bot
 * @param {object} client
 * @param {object} body
 * @param {string} channel
 */
async function handleRestoreBackupCommand(bot, client, body, channel) {
  if (!bot.persistentStorageService) {
    return client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: ':warning: Persistent storage is not enabled. Cannot restore from backup.',
    });
  }

  await client.chat.postEphemeral({
    channel,
    user: body.user_id,
    text: ':hourglass: Attempting to restore from the latest Slack backup...',
  });

  try {
    const backup = await bot.persistentStorageService.loadFromSlack();
    if (backup && bot.persistentStorageService.restoreFromDump(backup)) {
      await client.chat.postEphemeral({
        channel,
        user: body.user_id,
        text: ':white_check_mark: Successfully restored from the latest Slack backup!',
      });
      bot.scheduleAll();
      return;
    }
    await client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: ':warning: No valid backup found or restore failed.',
    });
  } catch (error) {
    await client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: `:x: Error restoring from backup: ${error.message}`,
    });
  }
}

// ── Delete Backup ─────────────────────────────────────────────────────────────

/**
 * Opens a confirmation modal before deleting all Dill backup messages from
 * the backup channel. The modal submit handler is handleDeleteBackupConfirm.
 *
 * @param {object} bot
 * @param {object} client
 * @param {object} body
 * @param {string} channel
 */
async function handleDeleteBackupCommand(bot, client, body, channel) {
  if (!bot.persistentStorageService) {
    return client.chat.postEphemeral({
      channel,
      user: body.user_id,
      text: ':warning: Persistent storage is not enabled. Nothing to delete.',
    });
  }

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'delete_backup_confirm',
      private_metadata: JSON.stringify({ channel, user: body.user_id }),
      title: { type: 'plain_text', text: 'Delete All Backups?' },
      submit: { type: 'plain_text', text: 'Delete All' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: ':warning: *Are you sure you want to delete ALL Dill backups?*\n\nThis action cannot be undone.' },
      }],
    },
  });
}

/**
 * Modal submission handler for delete_backup_confirm.
 * Paginates through the backup channel deleting every Dill backup message.
 *
 * @param {object} bot
 * @param {object} payload - Slack Bolt { ack, body, view, client }
 */
async function handleDeleteBackupConfirm(bot, { ack, body, view, client }) {
  await ack();

  let meta;
  try {
    meta = JSON.parse(view.private_metadata);
  } catch {
    meta = {};
  }
  const { channel, user } = meta;

  if (!bot.persistentStorageService) {
    return client.chat.postEphemeral({
      channel,
      user,
      text: ':warning: Persistent storage is not enabled. Nothing to delete.',
    });
  }

  await client.chat.postEphemeral({ channel, user, text: ':hourglass: Deleting all Dill backups...' });

  try {
    const storageChannelId = bot.persistentStorageService.storageChannelId;
    let deletedCount = 0;
    let cursor;

    // Page through the channel history deleting Dill backup messages.
    // We check for the "Dill Bot Database Backup" marker so we never
    // accidentally delete unrelated messages in a shared channel.
    do {
      const result = await bot.app.client.conversations.history({
        channel: storageChannelId,
        limit: 200,
        cursor,
      });

      for (const msg of result.messages) {
        if (msg.bot_id && msg.text?.includes('Dill Bot Database Backup')) {
          try {
            await bot.app.client.chat.delete({ channel: storageChannelId, ts: msg.ts });
            deletedCount++;
          } catch {
            // Already deleted or no permission – skip silently
          }
        }
      }

      cursor = result.has_more ? result.response_metadata?.next_cursor : undefined;
    } while (cursor);

    await client.chat.postEphemeral({
      channel,
      user,
      text: `:white_check_mark: Deleted ${deletedCount} Dill backup message(s).`,
    });
  } catch (error) {
    await client.chat.postEphemeral({ channel, user, text: `:x: Error deleting backups: ${error.message}` });
  }
}

// ── Kill Switch ───────────────────────────────────────────────────────────────

/**
 * Erases all Dill data: JSON store files, in-memory stores, Slack backups, and
 * all scheduled jobs. Requires the user to append "confirm" to prevent accidents.
 *
 * This is intentionally destructive and irreversible. It exists for testing and
 * emergency cleanup, not normal operation.
 *
 * @param {object} bot
 * @param {object} client
 * @param {object} body
 * @param {string} channel
 * @param {string[]} args
 */
async function handleKillKillKillCommand(bot, client, body, channel, args) {
  const userId = body.user_id;

  if (args[0] !== 'confirm') {
    return client.chat.postEphemeral({
      channel,
      user: userId,
      text: ':warning: *DANGER ZONE!* This will erase ALL Dill data and backups.\nTo confirm, type: `/dill kill-kill-kill confirm`',
    });
  }

  // Clear in-memory stores then persist via each store's own save() method.
  // This ensures the correct file paths are used regardless of process.cwd().
  const errors = [];

  const storesToClear = [
    ['configStore', bot.configStore],
    ['queueStore',  bot.queueStore],
    ['stateStore',  bot.stateStore],
    ...(bot.analyticsService?.analyticsStore
      ? [['analyticsStore', bot.analyticsService.analyticsStore]]
      : []),
    ...(bot.leaveStore
      ? [['leaveStore', bot.leaveStore]]
      : []),
  ];

  for (const [label, store] of storesToClear) {
    try {
      store.data = {};
      store.save();
    } catch (e) {
      errors.push(`Failed to clear ${label}: ${e.message}`);
    }
  }

  bot.schedulerService.stopAllJobs();

  if (bot.persistentStorageService?.deleteAllBackups) {
    try {
      await bot.persistentStorageService.deleteAllBackups();
    } catch (e) {
      errors.push(`Failed to delete Slack backups: ${e.message}`);
    }
  }

  if (errors.length === 0) {
    await client.chat.postEphemeral({
      channel,
      user: userId,
      text: ':white_check_mark: All Dill data and backups have been erased. The bot is now reset to a clean slate.',
    });
  } else {
    await client.chat.postEphemeral({
      channel,
      user: userId,
      text: ':warning: Some errors occurred during reset:\n' + errors.join('\n'),
    });
  }
}

module.exports = {
  handleRestoreBackupCommand,
  handleDeleteBackupCommand,
  handleDeleteBackupConfirm,
  handleKillKillKillCommand,
};
