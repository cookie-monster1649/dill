const { getIsoDateTz } = require('./dateHelpers');

/**
 * @typedef {Object} Turn
 * @property {string} user       - The user ID.
 * @property {boolean} isSkipped - Whether this turn was skipped.
 * @property {string|null} lastAcceptedDate - ISO date string of when this user last accepted a pick, or null if never accepted.
 */

// ── Shared sort comparator ────────────────────────────────────────────────────

/**
 * Sorts Turn objects by lastAcceptedDate ascending; null (never accepted) sorts
 * before any date so unaccepted members always reach the front of the queue.
 *
 * Example order after sort:
 *   [
 *     { user: 'U3', lastAcceptedDate: null },       // never picked → first
 *     { user: 'U1', lastAcceptedDate: '2024-10-01' }, // oldest pick → second
 *     { user: 'U2', lastAcceptedDate: '2024-11-15' }, // most recent → last
 *   ]
 *
 * @param {Turn} a
 * @param {Turn} b
 * @returns {number}
 */
function compareByLastAccepted(a, b) {
  if (!a.lastAcceptedDate && !b.lastAcceptedDate) return 0;
  if (!a.lastAcceptedDate) return -1;
  if (!b.lastAcceptedDate) return 1;
  return a.lastAcceptedDate.localeCompare(b.lastAcceptedDate);
}

// ── Store helpers ─────────────────────────────────────────────────────────────

/**
 * Transactionally set and save the queueStore.
 * @private
 */
function persistSchedule(queueStore, channel, name, schedule) {
  queueStore.setItem(channel, name, schedule);
  queueStore.save();
}

/**
 * Generates a shuffled list of rotation members.
 * Creates a randomized list where each member appears exactly once.
 * Allows injection of a custom PRNG for deterministic testing.
 *
 * @param {string[]} members            - Array of user IDs to include in the rotation
 * @param {() => number} [randomFn]    - Function returning [0,1) for randomness (defaults to Math.random)
 * @returns {Turn[]}                   - Array of turn objects
 */
function generateShuffledRotation(members, randomFn = Math.random) {
  if (!Array.isArray(members)) {
    throw new TypeError('members must be an array of user IDs');
  }
  const queue = [...members];
  // Fisher–Yates shuffle
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue.map(user => ({ user, isSkipped: false, lastAcceptedDate: null }));
}

/**
 * Gets or initializes the rotation schedule for a channel and rotation name.
 * Maintains a single ordered list of users.
 *
 * @param {object}   queueStore       - The queue storage instance
 * @param {string}   channel          - The Slack channel ID
 * @param {string}   name             - The rotation name
 * @param {string[]} members          - Array of user IDs in the rotation
 * @param {() => number} [randomFn]   - Optional PRNG for shuffle
 * @returns {Turn[]}                  - Array of turns
 */
function getRotationSchedule(queueStore, channel, name, members, randomFn) {
  let schedule = queueStore.getItem(channel, name);

  // Validate structure: must be array of turns
  const valid = Array.isArray(schedule) && 
                schedule.every(turn => turn && typeof turn.user === 'string');

  if (!valid) {
    console.info(`[INFO] Initializing schedule for '${name}' in channel ${channel}`);
    schedule = generateShuffledRotation(members, randomFn);
    persistSchedule(queueStore, channel, name, schedule);
  } else {
    // Ensure all turns have the required fields (for backward compatibility)
    let needsUpdate = false;
    schedule = schedule.map(turn => {
      if (!turn.hasOwnProperty('lastAcceptedDate')) {
        needsUpdate = true;
        return { ...turn, lastAcceptedDate: null };
      }
      return turn;
    });
    
    if (needsUpdate) {
      console.info(`[INFO] Updated existing schedule for '${name}' in channel ${channel} to include lastAcceptedDate fields`);
      persistSchedule(queueStore, channel, name, schedule);
    }
  }

  return schedule;
}

/**
 * Gets the next user from the rotation queue.
 *
 * @param {object} queueStore       - The queue storage instance
 * @param {string} channel          - The Slack channel ID
 * @param {string} name             - The rotation name
 * @param {object} config           - The rotation configuration
 * @param {string[]} config.members - Array of user IDs
 * @param {() => number} [randomFn]  - Optional PRNG for shuffle
 * @returns {Turn|null}             - The next turn or null if none
 */
function getNextUser(queueStore, channel, name, config, randomFn) {
  const members = Array.isArray(config.members) ? config.members : [];
  if (members.length === 0) {
    console.warn(`[WARN] Rotation '${name}' in ${channel} has no members.`);
    return null;
  }

  let schedule = getRotationSchedule(queueStore, channel, name, members, randomFn);
  
  // If schedule is empty, regenerate it
  if (schedule.length === 0) {
    schedule = generateShuffledRotation(members, randomFn);
    persistSchedule(queueStore, channel, name, schedule);
  }

  const turn = schedule.shift() || null;
  console.log(`[INFO] Next user for '${name}':`, turn && turn.user);

  persistSchedule(queueStore, channel, name, schedule);
  return turn;
}

/**
 * Handles user skipping logic by moving the skipped user to the end of the rotation.
 *
 * @param {object} queueStore         - The queue storage instance
 * @param {string} channel            - The Slack channel ID
 * @param {string} name               - The rotation name
 * @param {string} skippedUserId      - The user ID being skipped
 * @param {object} config             - The rotation configuration
 * @param {string[]} config.members   - Array of user IDs
 * @param {() => number} [randomFn]   - Optional PRNG for shuffle
 * @returns {Turn|null}               - The next turn or null
 */
function handleUserSkip(queueStore, channel, name, skippedUserId, config, randomFn) {
  const members = Array.isArray(config.members) ? config.members : [];
  let schedule = getRotationSchedule(queueStore, channel, name, members, randomFn);

  const idx = schedule.findIndex(t => t.user === skippedUserId);
  if (idx !== -1) {
    // Remove the skipped user and move them to the end of the queue
    const [skippedTurn] = schedule.splice(idx, 1);
    skippedTurn.isSkipped = true;
    schedule.push(skippedTurn);
    
    persistSchedule(queueStore, channel, name, schedule);
    console.log(`[INFO] Skipped user '${skippedUserId}' in '${name}' - moved to end of queue, next user: ${schedule[0]?.user}`);
  } else {
    console.warn(`[WARN] Skipped user '${skippedUserId}' not found in rotation '${name}'`);
  }

  // Return the next user (now at the front) without removing them from queue
  const next = schedule[0] || null;
  return next;
}

/**
 * Handles skipping a future pick by index, moving them to the end of the rotation.
 *
 * @param {object} queueStore         - The queue storage instance
 * @param {string} channel            - The Slack channel ID
 * @param {string} name               - The rotation name
 * @param {number} index              - 0-based pick index
 * @param {object} config             - The rotation configuration
 * @param {string[]} config.members   - Array of user IDs
 * @param {() => number} [randomFn]   - Optional PRNG for shuffle
 */
function handleFutureSkip(queueStore, channel, name, index, config, randomFn) {
  const members = Array.isArray(config.members) ? config.members : [];
  let schedule = getRotationSchedule(queueStore, channel, name, members, randomFn);

  if (index >= 0 && index < schedule.length) {
    // Remove the skipped user and move them to the end of the queue
    const [skippedTurn] = schedule.splice(index, 1);
    skippedTurn.isSkipped = true;
    schedule.push(skippedTurn);
  } else {
    console.warn(`[WARN] Future skip index ${index} out of range.`);
  }

  persistSchedule(queueStore, channel, name, schedule);
}

/**
 * Peeks at the next user in the rotation queue without removing them.
 *
 * @param {object} queueStore         - The queue storage instance
 * @param {string} channel            - The Slack channel ID
 * @param {string} name               - The rotation name
 * @param {object} config             - The rotation configuration
 * @param {string[]} config.members   - Array of user IDs
 * @returns {Turn|null}               - The next turn or null
 */
function peekNextUser(queueStore, channel, name, config) {
  const members = Array.isArray(config.members) ? config.members : [];
  if (members.length === 0) return null;

  const schedule = getRotationSchedule(queueStore, channel, name, members);
  return schedule[0] || null;
}

/**
 * Handles a pick acceptance by updating the user's last accepted date.
 * The queue will be reordered based on this date.
 * This should be called after a pick is accepted.
 *
 * @param {object} queueStore         - The queue storage instance
 * @param {string} channel            - The Slack channel ID
 * @param {string} name               - The rotation name
 * @param {string} acceptedUserId     - The user ID who just accepted the pick
 * @param {object} config             - The rotation configuration
 * @param {string[]} config.members   - Array of user IDs
 * @param {() => number} [randomFn]   - Optional PRNG for shuffle
 */
function reorderAfterAccept(queueStore, channel, name, acceptedUserId, config, randomFn) {
  const members = Array.isArray(config.members) ? config.members : [];
  let schedule = getRotationSchedule(queueStore, channel, name, members, randomFn);

  // Find the accepted user in the schedule
  const acceptedIndex = schedule.findIndex(t => t.user === acceptedUserId);
  
  if (acceptedIndex !== -1) {
    // Update the user's last accepted date and reset skip status
    // Use timezone-aware date function to get the correct date in the rotation's timezone
    const now = new Date();
    schedule[acceptedIndex].lastAcceptedDate = getIsoDateTz(now, config.tz); // YYYY-MM-DD format in rotation timezone
    schedule[acceptedIndex].isSkipped = false;
    
    schedule.sort(compareByLastAccepted);
    persistSchedule(queueStore, channel, name, schedule);
    console.log(`[INFO] Accepted pick for '${name}' - ${acceptedUserId} marked as accepted on ${schedule[acceptedIndex].lastAcceptedDate} (timezone: ${config.tz})`);
  } else {
    console.warn(`[WARN] Accepted user '${acceptedUserId}' not found in rotation '${name}'`);
  }
}

/**
 * Resets skip status and reorders the queue based on last accepted dates.
 * This should be called daily to reset the rotation order.
 *
 * @param {object} queueStore         - The queue storage instance
 * @param {string} channel            - The Slack channel ID
 * @param {string} name               - The rotation name
 * @param {object} config             - The rotation configuration
 * @param {string[]} config.members   - Array of user IDs
 */
function resetDailySkips(queueStore, channel, name, config) {
  const members = Array.isArray(config.members) ? config.members : [];
  let schedule = getRotationSchedule(queueStore, channel, name, members);

  // Reset skip status for all users
  schedule.forEach(turn => {
    turn.isSkipped = false;
  });

  schedule.sort(compareByLastAccepted);
  persistSchedule(queueStore, channel, name, schedule);
  console.log(`[INFO] Reset daily skips and reordered queue for rotation '${name}'`);
  console.log(`[INFO] New queue order: ${schedule.map(t => `${t.user}${t.lastAcceptedDate ? ` (accepted: ${t.lastAcceptedDate})` : ' (never accepted)'}`).join(' → ')}`);
}

module.exports = {
  compareByLastAccepted,
  generateShuffledRotation,
  getRotationSchedule,
  getNextUser,
  handleUserSkip,
  handleFutureSkip,
  peekNextUser,
  reorderAfterAccept,
  resetDailySkips,
};