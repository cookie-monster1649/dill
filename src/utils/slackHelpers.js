/**
 * Slack API utility functions and helpers.
 * 
 * This module contains helper functions for making Slack API calls,
 * rate limiting, and other Slack-related utilities.
 */

const { formatDateTz } = require('./dateHelpers');

/**
 * A hardened Slack API call wrapper with retry mechanism.
 * Provides consistent error handling and logging for all Slack API calls.
 * 
 * @param {Function} apiMethod - The Slack API method to call (e.g., app.client.chat.postMessage)
 * @param {object} args - The arguments for the API method
 * @param {number} retries - The number of retries to attempt (default: 1)
 * @returns {Promise<object>} The result of the API call
 * 
 * @example
 * const result = await slackApiCall(
 *   app.client.chat.postMessage,
 *   { channel: 'C123', text: 'Hello!' }
 * );
 */
async function slackApiCall(apiMethod, args, retries = 1) {
  try {
    return await apiMethod(args);
  } catch (error) {
    console.error(`[ERROR] Slack API call failed: ${error.message}`);
    
    if (retries > 0) {
      console.log(`[INFO] Retrying in 1 second...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return slackApiCall(apiMethod, args, retries - 1);
    }
    
    // Re-throw the error after the final attempt fails
    throw error;
  }
}

/**
 * Rate limiting system for user actions.
 * Prevents users from spamming the bot with too many requests.
 */
class RateLimiter {
  constructor(windowMs, maxActions) {
    this.windowMs = windowMs;
    this.maxActions = maxActions;
    this.userActionCooldowns = new Map();
  }

  /**
   * Checks if a user is rate limited.
   * @param {string} userId - The user ID to check
   * @returns {boolean} True if user is rate limited
   */
  isUserRateLimited(userId) {
    const now = Date.now();
    const userActions = this.userActionCooldowns.get(userId) || [];
    
    // Remove old actions outside the window
    const recentActions = userActions.filter(timestamp => now - timestamp < this.windowMs);
    
    if (recentActions.length >= this.maxActions) {
      return true;
    }
    
    // Add current action
    recentActions.push(now);
    this.userActionCooldowns.set(userId, recentActions);
    
    return false;
  }

  /**
   * Clears rate limit data for a user.
   * @param {string} userId - The user ID to clear
   */
  clearUserRateLimit(userId) {
    this.userActionCooldowns.delete(userId);
  }
}

/**
 * Builds Slack message blocks for a rotation pick.
 * Creates a formatted message with Accept/Skip buttons, or an expired notice if the pick is expired.
 * 
 * @param {string} rotationName - The name of the rotation
 * @param {string} userId - The user ID selected for the pick
 * @param {string} tz - The timezone string
 * @param {Date} [pickDate] - The date of the pick (optional, defaults to now)
 * @param {boolean} [expired] - Whether the pick is expired (optional)
 * @returns {Array} Array of Slack blocks for the message
 * 
 * @example
 * const blocks = buildPickBlocks('On-Call', 'U123', 'Etc/GMT-5', new Date(), false);
 * // Returns blocks for a message with Accept/Skip buttons
 */
function buildPickBlocks(rotationName, userId, tz, pickDate = new Date()) {
  const dateString = formatDateTz(pickDate, tz);
  const text = `*${rotationName}*: It's your turn, <@${userId}>!\n*Date*: ${dateString}`;
  const blocks = [
    { 
      type: 'section', 
      text: { type: 'mrkdwn', text } 
    },
    {
      type: 'actions',
      block_id: `dill_confirm::${rotationName}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Accept' },
          style: 'primary',
          action_id: 'accept'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Skip' },
          style: 'danger',
          action_id: 'skip'
        }
      ]
    }
  ];
  return blocks;
}

/**
 * Builds the main rotation creation/editing modal view.
 * Creates a comprehensive form for configuring a rotation.
 * 
 * @param {string} channel - The Slack channel ID
 * @param {string} preName - Pre-filled rotation name (for editing)
 * @param {object} existingConfig - Existing configuration (for editing)
 * @param {Array} timezoneOptions - Available timezone options
 * @returns {object} Slack modal view configuration
 */
function buildNewRotationView(channel, preName = '', existingConfig = null, timezoneOptions = []) {
  const members = (existingConfig || {}).members || [];
  
  const dayOptions = [
    { text: { type: 'plain_text', text: 'Mon' }, value: 'mon' },
    { text: { type: 'plain_text', text: 'Tue' }, value: 'tue' },
    { text: { type: 'plain_text', text: 'Wed' }, value: 'wed' },
    { text: { type: 'plain_text', text: 'Thu' }, value: 'thu' },
    { text: { type: 'plain_text', text: 'Fri' }, value: 'fri' },
    { text: { type: 'plain_text', text: 'Sat' }, value: 'sat' },
    { text: { type: 'plain_text', text: 'Sun' }, value: 'sun' }
  ];



  const frequencyOptions = [
    { text: { type: 'plain_text', text: 'Weekly' }, value: 'weekly' },
    { text: { type: 'plain_text', text: 'Fortnightly' }, value: 'fortnightly' },
    { text: { type: 'plain_text', text: 'Monthly (every 4 weeks)' }, value: 'monthly' }
  ];

  // Set initial values for editing
  const initialDayOptions = existingConfig?.days ? 
    dayOptions.filter(opt => existingConfig.days.includes(opt.value)) : [];
  

  
  const initialFrequencyOption = existingConfig?.frequency ? 
    frequencyOptions.find(opt => opt.value === existingConfig.frequency) : 
    frequencyOptions[0];
  
  const initialTimezoneOption = existingConfig?.tz ? 
    timezoneOptions.find(opt => opt.value === existingConfig.tz) : 
    null;
  
  return {
    type: 'modal',
    callback_id: 'dill_new',
    private_metadata: JSON.stringify({ channel, editingName: preName }),
    title: { type: 'plain_text', text: preName ? 'Edit Rotation' : 'New Rotation' },
    close: { type: 'plain_text', text: 'Cancel' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks: [
      // Rotation name
      { 
        type: 'input', 
        block_id: 'name_block', 
        label: { type: 'plain_text', text: 'Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'name_input',
          initial_value: preName
        } 
      },
      
      // Members selection
      { 
        type: 'input', 
        block_id: 'member_block', 
        label: { type: 'plain_text', text: 'Members' },
        element: {
          type: 'multi_users_select',
          action_id: 'members_select',
          ...(members.length > 0 && { initial_users: members })
        } 
      },
      
      { type: 'divider' },
      { type: 'header', text: { type: 'plain_text', text: 'Schedule' } },
      
      // Frequency selection
      { 
        type: 'input', 
        block_id: 'frequency_block', 
        label: { type: 'plain_text', text: 'Frequency' },
        element: {
          type: 'static_select',
          action_id: 'frequency_select',
          placeholder: { type: 'plain_text', text: 'Select frequency' },
          initial_option: initialFrequencyOption,
          options: frequencyOptions
        } 
      },
      
      // Days selection
      { 
        type: 'input', 
        block_id: 'schedule_days', 
        label: { type: 'plain_text', text: 'On' },
        element: {
          type: 'multi_static_select',
          action_id: 'days_select',
          ...(initialDayOptions.length > 0 && { initial_options: initialDayOptions }),
          options: dayOptions
        } 
      },
      
      // Time selection
      { 
        type: 'input', 
        block_id: 'schedule_time', 
        label: { type: 'plain_text', text: 'At (Time)' },
        element: {
          type: 'timepicker',
          action_id: 'time_input',
          placeholder: { type: 'plain_text', text: 'Select time' },
          ...(existingConfig?.time && { initial_time: existingConfig.time })
        } 
      },
      
      // Timezone selection
      { 
        type: 'input', 
        block_id: 'schedule_tz', 
        label: { type: 'plain_text', text: 'In (Timezone)' },
        element: {
          type: 'static_select',
          action_id: 'tz_select',
          placeholder: { type: 'plain_text', text: 'Select a timezone' },
          ...(initialTimezoneOption && { initial_option: initialTimezoneOption }),
          options: timezoneOptions
        } 
      },


      

    ]
  };
}

/**
 * Extracts rotation information from Slack message blocks.
 * 
 * @param {Array} blocks - The Slack message blocks
 * @returns {object|null} Object with rotationName and userId, or null if not found
 */
function extractRotationInfo(blocks) {
  if (!Array.isArray(blocks)) return null;
  
  let rotationName = null;
  let userId = null;
  
  // Extract rotation name from block_id
  for (const block of blocks) {
    if (block.block_id && block.block_id.startsWith('dill_confirm::')) {
      rotationName = block.block_id.replace('dill_confirm::', '');
      break;
    }
  }
  
  // Extract user ID from text content
  for (const block of blocks) {
    if (block.text && block.text.text) {
      const match = block.text.text.match(/<@([A-Z0-9]+)>/);
      if (match) {
        userId = match[1];
        break;
      }
    }
  }
  
  return rotationName && userId ? { rotationName, userId } : null;
}

module.exports = {
  slackApiCall,
  RateLimiter,
  buildPickBlocks,
  buildNewRotationView,
  extractRotationInfo
}; 