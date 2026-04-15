// ── Rotation CRUD Handlers ────────────────────────────────────────────────────
//
// Handles all create / edit / delete / settings interactions for rotations.
// These are triggered by button clicks and modal submissions from the Dill
// rotations management modal.

const { compareByLastAccepted } = require('../utils/rotationHelpers');
const config                    = require('../../config');

class RotationCrudHandlers {
  /**
   * @param {import('../app')} bot - The main DillBot instance
   */
  constructor(bot) {
    this.bot = bot;
  }

  // ── Modal open actions ────────────────────────────────────────────────────────

  /**
   * Handles the 'Create New' button – pushes the new-rotation form onto the
   * modal stack.
   */
  async handleCreateNewAction({ ack, body, client }) {
    await ack();
    try {
      const channel = body.view.private_metadata;

      const view = await Promise.race([
        Promise.resolve(this.bot.buildNewRotationView(channel)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), config.VIEW_BUILD_TIMEOUT_MS)
        )
      ]);

      await client.views.push({ trigger_id: body.trigger_id, view });
    } catch (error) {
      this._handleModalOpenError(error, body, client, 'creating the rotation');
    }
  }

  /**
   * Handles the 'Edit Rotation' button – pushes the edit form pre-filled with
   * the rotation's current config.
   */
  async handleEditRotationAction({ ack, body, client }) {
    await ack();
    try {
      const channel      = body.view.private_metadata;
      const rotationName = body.actions[0].value;

      const view = await Promise.race([
        Promise.resolve(this.bot.buildNewRotationView(channel, rotationName)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), config.VIEW_BUILD_TIMEOUT_MS)
        )
      ]);

      await client.views.push({ trigger_id: body.trigger_id, view });
    } catch (error) {
      this._handleModalOpenError(error, body, client, 'editing the rotation');
    }
  }

  /**
   * Handles the 'Delete' button – pushes a confirmation modal before any data
   * is touched.
   */
  async handleDeleteStartAction({ ack, body, client }) {
    await ack();
    try {
      const channel      = body.view.private_metadata;
      const rotationName = body.actions[0].value;

      await client.views.push({
        trigger_id: body.trigger_id,
        view: {
          type:             'modal',
          callback_id:      'delete_rotation_confirm',
          private_metadata: JSON.stringify({ channel, name: rotationName }),
          title:  { type: 'plain_text', text: 'Confirm Deletion' },
          submit: { type: 'plain_text', text: 'Delete' },
          close:  { type: 'plain_text', text: 'Cancel' },
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Are you sure you want to delete the *${rotationName}* rotation?\n\nThis action cannot be undone.`
            }
          }]
        }
      });
    } catch (error) {
      this._handleModalOpenError(error, body, client, 'deleting the rotation');
    }
  }

  /**
   * Handles the 'Settings' button – pushes the per-member last-accepted-date
   * settings modal.
   */
  async handleRotationSettingsAction({ ack, body, client }) {
    await ack();
    try {
      const channel      = body.view.private_metadata;
      const rotationName = body.actions[0].value;
      const cfg          = this.bot.configStore.getItem(channel, rotationName);
      if (!cfg) {
        console.error(`[ERROR] Rotation '${rotationName}' not found in channel ${channel}`);
        return;
      }

      const { getRotationSchedule } = require('../utils/rotationHelpers');
      const schedule = getRotationSchedule(this.bot.queueStore, channel, rotationName, cfg.members);
      const view     = this._buildRotationSettingsView(channel, rotationName, cfg, schedule);

      await client.views.push({ trigger_id: body.trigger_id, view });
    } catch (error) {
      this._handleModalOpenError(error, body, client, 'opening the settings');
    }
  }

  // ── Modal submissions ─────────────────────────────────────────────────────────

  /**
   * Handles the selection modal submission (the top-level rotations view).
   * No-op – the modal is just an overview; no data to process.
   */
  async handleViewSubmission({ ack }) {
    await ack();
  }

  /**
   * Handles the create/edit rotation form submission.
   * Validates input, writes config + queue, reschedules, and refreshes the
   * overview modal.
   */
  async handleRotationFormSubmission({ ack, body, view, client }) {
    const v = view.state.values;
    let parsedMetadata;

    try {
      parsedMetadata = JSON.parse(view.private_metadata);
    } catch (parseError) {
      console.error('[ERROR] Failed to parse view private_metadata:', parseError);
      return ack({
        response_action: 'errors',
        errors: { name_block: 'Invalid configuration. Please try again.' }
      });
    }

    const { channel, editingName } = parsedMetadata;

    // ── Validate rotation name ───────────────────────────────────────────────
    const newName = v.name_block.name_input.value.trim();

    if (!newName) {
      return ack({ response_action: 'errors', errors: { name_block: 'Rotation name cannot be empty.' } });
    }
    if (newName.length > config.MAX_ROTATION_NAME_LENGTH) {
      return ack({ response_action: 'errors', errors: { name_block: `Rotation name must be ${config.MAX_ROTATION_NAME_LENGTH} characters or less.` } });
    }
    // Reject control characters (newlines, tabs, etc.)
    if (/[^\P{C}]/u.test(newName)) {
      return ack({ response_action: 'errors', errors: { name_block: 'Rotation name cannot contain control characters (newlines, tabs, etc.).' } });
    }

    // ── Extract form values ──────────────────────────────────────────────────
    const newMembers = v.member_block.members_select.selected_users || [];
    const days       = v.schedule_days.days_select.selected_options?.map(o => o.value) || [];
    const time       = v.schedule_time.time_input.selected_time;
    const frequency  = v.frequency_block.frequency_select.selected_option?.value || 'weekly';
    const tzValue    = v.schedule_tz.tz_select.selected_option?.value || 'Etc/GMT+0';

    const oldCfg     = this.bot.configStore.getItem(channel, editingName);
    const oldMembers = oldCfg?.members || [];

    await ack();

    // ── Write config ─────────────────────────────────────────────────────────
    const newConfig = {
      days, time, members: newMembers, tz: tzValue, frequency,
      startDate: oldCfg?.startDate || new Date().toISOString()
    };
    this.bot.configStore.setItem(channel, newName, newConfig);

    // ── Update queue ─────────────────────────────────────────────────────────
    if (editingName) {
      if (editingName !== newName) {
        this.bot.renameRotationData(channel, editingName, newName);
      }

      const membersAdded   = newMembers.filter(m => !oldMembers.includes(m));
      const membersRemoved = oldMembers.filter(m => !newMembers.includes(m));

      if (membersRemoved.length > 0) {
        console.log(`[INFO] Removing ${membersRemoved.length} members from rotation "${newName}": ${membersRemoved.join(', ')}`);
      }

      const { getRotationSchedule } = require('../utils/rotationHelpers');
      let schedule = getRotationSchedule(this.bot.queueStore, channel, newName, oldMembers);
      schedule     = schedule.filter(turn => !membersRemoved.includes(turn.user));

      if (membersAdded.length > 0) {
        console.log(`[INFO] Adding ${membersAdded.length} new members to rotation "${newName}": ${membersAdded.join(', ')}`);
        for (const user of membersAdded) {
          schedule.push({ user, isSkipped: false, lastAcceptedDate: null });
        }
      }

      this.bot.queueStore.setItem(channel, newName, schedule);
    } else {
      const { generateShuffledRotation } = require('../utils/rotationHelpers');
      this.bot.queueStore.setItem(channel, newName, generateShuffledRotation(newMembers));
    }

    this.bot.configStore.save();
    this.bot.queueStore.save();
    await this.bot.createBackup();
    this.bot.scheduleAll();

    // ── Refresh the overview modal ───────────────────────────────────────────
    await this._refreshOverviewModal(client, body.view.root_view_id, channel);
  }

  /**
   * Handles the rotation settings form submission (last-accepted-date updates).
   */
  async handleRotationSettingsSubmission({ ack, body, view, client }) {
    try {
      await ack();

      let parsedMetadata;
      try {
        parsedMetadata = JSON.parse(view.private_metadata);
      } catch (parseError) {
        console.error('[ERROR] Failed to parse settings metadata:', parseError);
        return;
      }

      const { channel, rotationName } = parsedMetadata;
      const cfg = this.bot.configStore.getItem(channel, rotationName);
      if (!cfg) {
        console.error(`[ERROR] Rotation '${rotationName}' not found in channel ${channel}`);
        return;
      }

      const { getRotationSchedule } = require('../utils/rotationHelpers');
      let schedule   = getRotationSchedule(this.bot.queueStore, channel, rotationName, cfg.members);
      const values   = view.state.values;
      let hasChanges = false;

      cfg.members.forEach((memberId, index) => {
        const blockId  = `member_${index}`;
        const actionId = `date_${memberId}`;
        if (!values[blockId]?.[actionId]) return;

        const newDate      = values[blockId][actionId].selected_date;
        const memberEntry  = schedule.find(s => s.user === memberId);
        if (!memberEntry) return;

        const normalizedDate = newDate || null;
        if (normalizedDate !== memberEntry.lastAcceptedDate) {
          console.log(`[INFO] Updated last accepted date for ${memberId} in ${rotationName}: ${memberEntry.lastAcceptedDate} -> ${normalizedDate ?? 'null'}`);
          memberEntry.lastAcceptedDate = normalizedDate;
          hasChanges = true;
        }
      });

      if (hasChanges) {
        schedule.sort(compareByLastAccepted);
        this.bot.queueStore.setItem(channel, rotationName, schedule);
        this.bot.queueStore.save();
        await this.bot.createBackup();
        console.log(`[INFO] Updated rotation settings for '${rotationName}' in channel ${channel}`);
      }

      await this._refreshOverviewModal(client, body.view.root_view_id, channel);
    } catch (error) {
      console.error('[ERROR] Failed to handle rotation settings submission:', error);
    }
  }

  /**
   * Handles the delete-confirmation modal submission.
   */
  async handleDeleteConfirmation({ ack, view, client, body }) {
    let parsedMetadata;
    try {
      parsedMetadata = JSON.parse(view.private_metadata);
    } catch (parseError) {
      console.error('[ERROR] Failed to parse delete confirmation metadata:', parseError);
      return ack({ response_action: 'errors', errors: { name_block: 'Invalid configuration. Please try again.' } });
    }

    const { channel, name } = parsedMetadata;
    await ack();

    this.bot.cleanupRotationData(channel, name);
    await this.bot.createBackup();

    await this._refreshOverviewModal(client, body.view.root_view_id, channel);
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Builds the rotation settings modal (last-accepted-date pickers per member).
   *
   * @param {string} channel
   * @param {string} rotationName
   * @param {object} cfg - Rotation config from configStore
   * @param {Array}  schedule - Queue entries from queueStore
   * @returns {object} Slack modal view
   *
   * @example schedule entry: { user: 'U123', lastAcceptedDate: '2024-01-15', isSkipped: false }
   */
  _buildRotationSettingsView(channel, rotationName, cfg, schedule) {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${rotationName}* – Last Accepted Date Settings\n\nSet the last accepted date for each member. This affects the rotation order.`
        }
      },
      { type: 'divider' }
    ];

    cfg.members.forEach((memberId, index) => {
      const memberEntry = schedule.find(s => s.user === memberId);
      const currentDate = memberEntry?.lastAcceptedDate || '';

      blocks.push({
        type:     'input',
        block_id: `member_${index}`,
        label:    { type: 'plain_text', text: `<@${memberId}>` },
        element: {
          type:        'datepicker',
          action_id:   `date_${memberId}`,
          placeholder: { type: 'plain_text', text: 'Select date (leave empty for never accepted)' },
          ...(currentDate && { initial_date: currentDate })
        }
      });
    });

    return {
      type:             'modal',
      callback_id:      'rotation_settings',
      private_metadata: JSON.stringify({ channel, rotationName }),
      title:  { type: 'plain_text', text: 'Rotation Settings' },
      submit: { type: 'plain_text', text: 'Save' },
      close:  { type: 'plain_text', text: 'Cancel' },
      blocks
    };
  }

  /**
   * Refreshes the root overview modal (dill_select) after any CRUD operation.
   * Swallows non-fatal Slack API errors (modal closed, hash conflict) so the
   * caller doesn't need to handle them.
   *
   * @param {object} client   - Slack client
   * @param {string} viewId   - root_view_id of the modal stack
   * @param {string} channel  - Slack channel ID
   */
  async _refreshOverviewModal(client, viewId, channel) {
    try {
      const newBlocks = await this.bot.buildRotationsViewBlocks(channel);
      await client.views.update({
        view_id: viewId,
        view: {
          type:             'modal',
          callback_id:      'dill_select',
          private_metadata: channel,
          title: { type: 'plain_text', text: 'Dill Rotations' },
          close: { type: 'plain_text', text: 'Close' },
          blocks: newBlocks
        }
      });
    } catch (viewError) {
      if (viewError.data?.error === 'not_found') {
        console.warn('[WARN] Could not update modal view – it may have been closed.');
      } else if (viewError.data?.error === 'hash_conflict') {
        console.warn('[WARN] Hash conflict updating modal view – view may have been modified concurrently.');
      } else {
        console.error('[ERROR] Could not update overview modal:', viewError.data?.error || viewError.message);
      }
    }
  }

  /**
   * Centralised error handler for modal-open failures.
   * Handles the two recoverable Slack errors (timeout, expired trigger) without
   * notifying the user; all other errors fall through to an ephemeral message.
   *
   * @param {Error}  error   - The thrown error
   * @param {object} body    - Slack interaction body
   * @param {object} client  - Slack client
   * @param {string} context - Short human-readable description for the error message
   */
  async _handleModalOpenError(error, body, client, context) {
    if (error.message === 'TIMEOUT') {
      console.warn(`[WARN] Building view timed out (${context}).`);
      return;
    }
    if (error.code === 'slack_webapi_platform_error' && error.data?.error === 'expired_trigger_id') {
      console.warn(`[WARN] Trigger ID expired while ${context}.`);
      return;
    }

    console.error(`[ERROR] Failed to open modal (${context}):`, error);

    if (body.user && body.channel) {
      try {
        await client.chat.postEphemeral({
          channel: body.channel.id || body.channel,
          user:    body.user.id    || body.user,
          text:    `:x: Sorry, something went wrong ${context}. Please try again.`
        });
      } catch (notifyError) {
        console.error('[ERROR] Failed to notify user of modal error:', notifyError);
      }
    }
  }
}

module.exports = RotationCrudHandlers;
