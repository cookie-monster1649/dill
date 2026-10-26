// ── Speaking Order Modal Blocks ───────────────────────────────────────────────
//
// Block Kit fragments for the rotation edit modal: the speaking-order
// checkbox plus its settings (shown only when the checkbox is ticked).

const { hasSpeakingOrder } = require('./speakingOrderHelpers');

// ── Options ───────────────────────────────────────────────────────────────────

const SPEAKING_ORDER_OPTION = {
  text: { type: 'plain_text', text: 'Post a speaking order list' },
  description: { type: 'plain_text', text: 'A shuffled, numbered list of members. People react :x: to drop out.' },
  value: 'enabled',
};

const LIST_DAY_OPTIONS = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'],
  ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
].map(([value, text]) => ({ text: { type: 'plain_text', text }, value }));

const DEFAULT_LIST_DAY = 'wed';

// ── Speaking order ────────────────────────────────────────────────────────────

/**
 * Checkbox plus, when ticked, the speaking-order settings. dispatch_action
 * makes Slack send a block action on toggle so the modal can re-render.
 */
function buildSpeakingOrderSettingsBlocks(existingConfig, preName) {
  const enabled = hasSpeakingOrder(existingConfig);

  const checkbox = {
    type: 'input',
    block_id: 'speaking_order_block',
    dispatch_action: true,
    optional: true,
    label: { type: 'plain_text', text: 'Speaking order' },
    element: {
      type: 'checkboxes',
      action_id: 'speaking_order_toggle',
      options: [SPEAKING_ORDER_OPTION],
      ...(enabled && { initial_options: [SPEAKING_ORDER_OPTION] }),
    },
  };
  if (!enabled) return [{ type: 'divider' }, checkbox];

  const listDay = existingConfig.speakingOrderDay || DEFAULT_LIST_DAY;

  return [
    { type: 'divider' },
    checkbox,
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_Posts at the pick time on the chosen day, in the same week as a pick. People on leave are left off. Anyone who reacts with :x: is removed._' }],
    },
    {
      type: 'input',
      block_id: 'speaking_order_day',
      label: { type: 'plain_text', text: 'Post speaking order on' },
      element: {
        type: 'static_select',
        action_id: 'speaking_order_day_select',
        initial_option: LIST_DAY_OPTIONS.find(o => o.value === listDay),
        options: LIST_DAY_OPTIONS,
      },
    },
    // Manual trigger for testing or a missed list; only once the rotation
    // exists. Ignores the pick-window check but won't post twice in a day.
    ...(preName ? [{
      type: 'actions',
      elements: [{
        type: 'button',
        action_id: 'speaking_order_post',
        text: { type: 'plain_text', text: 'Post Speaking Order Now' },
        confirm: {
          title: { type: 'plain_text', text: 'Post speaking order?' },
          text: { type: 'mrkdwn', text: 'Posts a freshly shuffled speaking order to the channel now, using the last saved settings.' },
          confirm: { type: 'plain_text', text: 'Post' },
          deny: { type: 'plain_text', text: 'Cancel' },
        },
      }],
    }] : []),
  ];
}

// ── Submission parsing ────────────────────────────────────────────────────────

/**
 * Reads speaking-order fields from a modal submission.
 *
 * @example
 * readSpeakingOrderFields(view.state.values)
 * // → { speakingOrder: true, speakingOrderDay: 'wed' }
 * // → { speakingOrder: false }
 */
function readSpeakingOrderFields(values) {
  const selected = values.speaking_order_block?.speaking_order_toggle?.selected_options || [];
  const speakingOrder = selected.length > 0;
  if (!speakingOrder) return { speakingOrder };

  return {
    speakingOrder,
    speakingOrderDay: values.speaking_order_day?.speaking_order_day_select?.selected_option?.value || DEFAULT_LIST_DAY,
  };
}

module.exports = { buildSpeakingOrderSettingsBlocks, readSpeakingOrderFields };
