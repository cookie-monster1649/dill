// ── Pick Action Handlers ───────────────────────────────────────────────────────
//
// Handles the three real-time interaction buttons that appear on a rotation pick
// message: Accept, Skip, and Future Skip.
//
// All three handlers follow the same pattern:
//   1. ack() the Slack interaction immediately
//   2. Mutate queue state via rotationHelpers
//   3. Update the Slack message to reflect the new state
//   4. Trigger a backup

const { buildPickBlocks, extractRotationInfo } = require('../utils/slackHelpers');
const { handleUserSkip, handleFutureSkip }     = require('../utils/rotationHelpers');
const { reorderAfterAccept }                   = require('../utils/rotationHelpers');
const { formatDateTz, getIsoDateTz }           = require('../utils/dateHelpers');
const { DateTime }                             = require('luxon');
const config                                   = require('../../config');

class PickActionHandlers {
  /**
   * @param {import('../app')} bot - The main DillBot instance
   */
  constructor(bot) {
    this.bot = bot;
  }

  // ── Accept ───────────────────────────────────────────────────────────────────

  /**
   * Handles the 'Accept' button on a pick message.
   * Updates the picked user's lastAcceptedDate and rewrites the message to a
   * confirmed-accepted state (no more buttons).
   */
  async handleAcceptAction({ ack, body, client }) {
    await ack();

    const channelId  = body.channel.id;
    const messageTs  = body.message.ts;
    const responder  = body.user.id;

    // ── Rate limiting ────────────────────────────────────────────────────────
    if (this.bot.rateLimiter.isUserRateLimited(responder)) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: responder,
        text: ':warning: You\'re clicking too fast. Please wait a moment before trying again.'
      });
      return;
    }

    // ── Extract rotation info from the message blocks ────────────────────────
    const rotationInfo = extractRotationInfo(body.message.blocks);
    if (!rotationInfo) return;
    const { rotationName: name, userId: user } = rotationInfo;

    const cfg     = this.bot.configStore.getItem(channelId, name) || {};
    const date    = new Date();
    const dateISO = getIsoDateTz(date, cfg.tz);

    // ── Track analytics ──────────────────────────────────────────────────────
    this.bot.analyticsService.trackEvent('pick_accepted', {
      channelId, responder, messageTs,
      name,       // rotation name
      user,       // picked user
      date: dateISO
    });

    // ── Update queue state ───────────────────────────────────────────────────
    reorderAfterAccept(this.bot.queueStore, channelId, name, user, cfg);

    // ── Update the Slack message ─────────────────────────────────────────────
    const dateString = formatDateTz(date, cfg.tz);
    const newText    = `*${name}*: <@${user}>\n*Date*: ${dateString}\n*Status*: Accepted ✅`;
    await client.chat.update({
      channel: channelId,
      ts:      messageTs,
      text:    `Rotation ${name} accepted.`,
      blocks:  [{ type: 'section', text: { type: 'mrkdwn', text: newText } }]
    });

    await this.bot.createBackup();
  }

  // ── Skip ─────────────────────────────────────────────────────────────────────

  /**
   * Handles the 'Skip' button on a pick message.
   * Moves the skipped user to the end of the current cycle and picks the next
   * person, updating the original message in place.
   */
  async handleSkipAction({ ack, body, client }) {
    await ack();

    const channelId   = body.channel.id;
    const messageTs   = body.message.ts;
    const responder   = body.user.id;

    // ── Rate limiting ────────────────────────────────────────────────────────
    if (this.bot.rateLimiter.isUserRateLimited(responder)) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: responder,
        text: ':warning: You\'re clicking too fast. Please wait a moment before trying again.'
      });
      return;
    }

    this.bot.analyticsService.trackEvent('pick_skipped', { channelId, responder, messageTs });

    // ── Extract rotation info ────────────────────────────────────────────────
    const rotationInfo = extractRotationInfo(body.message.blocks);
    if (!rotationInfo) return;
    const { rotationName: name, userId: skippedUser } = rotationInfo;

    const cfg = this.bot.configStore.getItem(channelId, name) || {};

    // ── Advance the queue ────────────────────────────────────────────────────
    const nextTurn = handleUserSkip(this.bot.queueStore, channelId, name, skippedUser, cfg);
    const nextUser = nextTurn?.user;

    // ── Post a thread note then update the original message ──────────────────
    await client.chat.postMessage({
      channel:   channelId,
      thread_ts: messageTs,
      text: `*${name}*: <@${responder}> skipped <@${skippedUser}>. Moving on to <@${nextUser}>.`
    });

    const now    = DateTime.now().setZone(cfg.tz);
    const blocks = buildPickBlocks(name, nextUser, cfg.tz, now.toJSDate(), false);
    await client.chat.update({
      channel: channelId,
      ts:      messageTs,
      text:    `Rotation pick for ${name}: <@${nextUser}>`,
      blocks
    });

    await this.bot.createBackup();
  }

  // ── Future Skip ──────────────────────────────────────────────────────────────

  /**
   * Handles the 'Future Skip' button inside the rotations modal.
   * Marks a future queue slot as skipped and refreshes the modal view.
   */
  async handleFutureSkipAction({ ack, body, client }) {
    await ack();

    // ── Rate limiting ────────────────────────────────────────────────────────
    if (this.bot.rateLimiter.isUserRateLimited(body.user.id)) {
      try {
        await client.chat.postEphemeral({
          channel: body.channel?.id || body.view?.private_metadata,
          user:    body.user.id,
          text: ':warning: You\'re clicking too fast. Please wait a moment before trying again.'
        });
      } catch (_) { /* ephemeral from a modal context may fail – ignore */ }
      return;
    }

    try {
      let parsedValue;
      try {
        parsedValue = JSON.parse(body.actions[0].value);
      } catch (parseError) {
        console.error('[ERROR] Failed to parse future_skip action value:', parseError);
        return;
      }

      const { channel, name, index } = parsedValue;
      const cfg = this.bot.configStore.getItem(channel, name) || {};

      handleFutureSkip(this.bot.queueStore, channel, name, index, cfg);

      // ── Refresh the modal ────────────────────────────────────────────────
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), config.FUTURE_SKIP_BUILD_TIMEOUT_MS)
        );
        const newBlocks = await Promise.race([
          this.bot.buildRotationsViewBlocks(channel),
          timeoutPromise
        ]);

        // Small delay to reduce concurrent update conflicts
        await new Promise(resolve => setTimeout(resolve, 100));

        let retryCount = 0;
        const maxRetries = 2;
        while (retryCount <= maxRetries) {
          try {
            await client.views.update({
              view_id: body.view.id,
              hash:    body.view.hash,
              view: {
                type:             'modal',
                callback_id:      'dill_select',
                private_metadata: channel,
                title:  { type: 'plain_text', text: 'Dill Rotations' },
                close:  { type: 'plain_text', text: 'Close' },
                blocks: newBlocks
              }
            });
            break;
          } catch (updateError) {
            const isHashConflict = updateError.code === 'slack_webapi_platform_error' &&
                                   updateError.data?.error === 'hash_conflict';
            if (isHashConflict && retryCount < maxRetries) {
              retryCount++;
              console.warn(`[WARN] Hash conflict on attempt ${retryCount}, retrying...`);
              await new Promise(resolve => setTimeout(resolve, 200 * retryCount));
              if (updateError.data?.view?.hash) {
                body.view.hash = updateError.data.view.hash;
              }
            } else {
              throw updateError;
            }
          }
        }
      } catch (viewError) {
        if (viewError.message === 'TIMEOUT') {
          console.warn('[WARN] Building rotation blocks timed out during skip.');
        } else if (viewError.data?.error === 'not_found') {
          console.warn('[WARN] Could not update modal view – it may have been closed.');
        } else if (viewError.data?.error === 'hash_conflict') {
          console.warn('[WARN] Hash conflict updating modal view after future skip.');
        } else {
          console.error('[ERROR] Failed to update modal view:', viewError);
        }
      }

      await this.bot.createBackup();

    } catch (error) {
      console.error('[ERROR] Handling future_skip action:', error);
      try {
        const parsedValue = JSON.parse(body.actions[0].value);
        await client.chat.postEphemeral({
          channel: parsedValue.channel,
          user:    body.user.id,
          text: ':x: Sorry, there was an error processing your skip request. Please try again.'
        });
      } catch (fallbackError) {
        console.error('[ERROR] Could not send fallback error message:', fallbackError);
      }
    }
  }
}

module.exports = PickActionHandlers;
