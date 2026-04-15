// ── Leave Handlers ─────────────────────────────────────────────────────────────
//
// Action and view-submission handlers for the Leave Calendar UI.
//
//   openLeaveModal         – opens the Leave Calendar modal (action: open_leave_tab)
//   handleLeaveAddOpen     – pushes the add-leave form onto the modal stack (action: leave_add_open)
//   handleLeaveAddSubmit   – persists new leave blocks and refreshes the parent modal (view: dill_leave_add)
//   handleLeaveRemove      – deletes a leave block and refreshes the modal in place (action: leave_remove)

const { pruneExpiredLeave, addLeaveBlock, removeLeaveBlock } = require('../bot/leaveHelpers');
const { buildLeaveView, buildLeaveFormView } = require('../bot/leaveModalBuilders');

// ── Open Leave Calendar ───────────────────────────────────────────────────────

/**
 * Switches the current modal to the Leave Calendar by updating the view in
 * place. Prunes expired blocks first so users only see upcoming leave.
 *
 * Uses views.update (not views.open) so the transition happens within the
 * same modal window rather than opening a second modal on top.
 *
 * @param {object} bot
 * @param {object} client
 * @param {string} viewId    – body.view.id from the action payload
 * @param {string} viewHash  – body.view.hash for optimistic concurrency
 * @param {string} channel
 */
async function openLeaveModal(bot, client, viewId, viewHash, channel) {
  pruneExpiredLeave(bot.leaveStore, channel);
  const view = buildLeaveView(bot.leaveStore, channel);
  await client.views.update({ view_id: viewId, hash: viewHash, view });
}

// ── Open Add-Leave Form ───────────────────────────────────────────────────────

/**
 * Pushes the add-leave form onto the modal stack. The user picks one or more
 * team members and a date range; on submit, dill_leave_add is handled below.
 *
 * @param {object} bot    - unused here but consistent with handler signatures
 * @param {object} client
 * @param {string} triggerId
 * @param {string} channel
 */
async function handleLeaveAddOpen(bot, client, triggerId, channel) {
  const view = buildLeaveFormView(channel);
  await client.views.push({ trigger_id: triggerId, view });
}

// ── Submit Add-Leave Form ─────────────────────────────────────────────────────

/**
 * Handles the dill_leave_add view submission.
 * Persists a leave block for each selected user then updates the parent Leave
 * Calendar modal so the user sees the changes without reopening.
 *
 * @param {object} bot
 * @param {object} ack
 * @param {object} view
 * @param {object} client
 */
async function handleLeaveAddSubmit(bot, { ack, view, client }) {
  const values   = view.state.values;
  const channel  = view.private_metadata;
  const userIds  = values.leave_users?.users_input?.selected_users || [];
  const startDate = values.leave_start?.start_input?.selected_date;
  const endDate   = values.leave_end?.end_input?.selected_date;

  // ── Validate dates ──
  if (!startDate || !endDate) {
    return ack({
      response_action: 'errors',
      errors: { leave_start: 'Both start and end dates are required.' },
    });
  }
  if (endDate < startDate) {
    return ack({
      response_action: 'errors',
      errors: { leave_end: 'End date must be on or after the start date.' },
    });
  }
  if (userIds.length === 0) {
    return ack({
      response_action: 'errors',
      errors: { leave_users: 'Please select at least one team member.' },
    });
  }

  await ack();

  for (const userId of userIds) {
    addLeaveBlock(bot.leaveStore, channel, userId, startDate, endDate);
  }

  await bot.createBackup();

  // Refresh the parent Leave Calendar modal in place. The parent is the view
  // directly under dill_leave_add in the view stack.
  try {
    const refreshedView = buildLeaveView(bot.leaveStore, channel);
    // hash is required by views.update to prevent race conditions
    await client.views.update({
      view_id: view.previous_view_id,
      view: refreshedView,
    });
  } catch (e) {
    // Non-fatal – the leave was saved even if the refresh fails
    console.warn('[WARN] Could not refresh Leave Calendar after add:', e.message);
  }
}

// ── Remove Leave Block ────────────────────────────────────────────────────────

/**
 * Handles the leave_remove button action. Deletes the targeted leave block then
 * updates the Leave Calendar modal to reflect the removal.
 *
 * @param {object} bot
 * @param {object} ack
 * @param {object} action
 * @param {object} body
 * @param {object} client
 */
async function handleLeaveRemove(bot, { ack, action, body, client }) {
  await ack();

  let parsed;
  try {
    parsed = JSON.parse(action.value);
  } catch {
    console.error('[ERROR] leave_remove: could not parse action value', action.value);
    return;
  }

  const { channel, userId, id } = parsed;
  removeLeaveBlock(bot.leaveStore, channel, userId, id);

  await bot.createBackup();

  // Refresh the modal in place so the removed entry disappears immediately
  try {
    const refreshedView = buildLeaveView(bot.leaveStore, channel);
    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      view: refreshedView,
    });
  } catch (e) {
    console.warn('[WARN] Could not refresh Leave Calendar after remove:', e.message);
  }
}

module.exports = { openLeaveModal, handleLeaveAddOpen, handleLeaveAddSubmit, handleLeaveRemove };
