/**
 * Date and time utility functions for rotation scheduling.
 * 
 * This module contains helper functions for working with dates, weeks,
 * and timezone calculations used throughout the rotation system.
 */

/**
 * Maps weekday abbreviations to JavaScript Date.getDay() values.
 * Sunday = 0, Monday = 1, etc.
 */
const WEEKDAY_MAP = { 
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 
};

/**
 * Calculates the ISO week number for a given date.
 * Uses the ISO 8601 standard where weeks start on Monday.
 * 
 * @param {Date} date - The date to calculate the week number for
 * @returns {number} The ISO week number (1-53)
 * 
 * @example
 * const week = getWeekNumber(new Date('2024-01-15')); // Returns 3
 */
function getWeekNumber(date) {
  // Create a copy and set to UTC to avoid timezone issues
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  
  // Set to Thursday of the current week (ISO weeks start on Monday)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  
  // Get the first day of the year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  
  // Calculate week number
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Generate the next N pick dates for a rotation.
 *
 * @param {Object}   config
 * @param {string[]} config.days       – Array of day strings, e.g. ['mon','wed','fri'].
 * @param {string}   config.time       – Pick time in 'HH:mm' 24-hour format, e.g. '09:00'.
 * @param {string}   config.tz         – IANA timezone, e.g. 'Etc/GMT-10'.
 * @param {number}   [config.interval] – Number of weeks between cycles (default 1).
 * @param {Date}     anchorDate        – The date/time to start from.
 * @param {number}   count             – How many occurrences to return.
 *
 * @returns {Date[]} – Array of JavaScript Date objects for the next picks.
 */
function getNextOccurrences(config, count, anchorDate) {
  // 1. Validate
  if (
    !config.days ||
    !Array.isArray(config.days) ||
    config.days.length === 0 ||
    !config.time ||
    !config.tz
  ) {
    return [];
  }

  // 2. Map three-letter days to ISO weekdays (Mon=1…Sun=7)
  const ISO_DAY_MAP = { sun: 7, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const daysOfWeek = config.days.map(d => {
    const key = d.toLowerCase().slice(0, 3);
    if (!(key in ISO_DAY_MAP)) {
      throw new Error(`Invalid day name in config.days: "${d}"`);
    }
    return ISO_DAY_MAP[key];
  });

  // 3. Parse time components
  const [hour, minute] = config.time.split(':').map(n => parseInt(n, 10));
  if (isNaN(hour) || isNaN(minute)) {
    throw new Error(`Invalid time format: "${config.time}"`);
  }

  // 4. Anchoring
  const interval = config.interval && Number.isInteger(config.interval) && config.interval > 1
    ? config.interval
    : 1;
  // Anchor datetime and the “threshold” for including today
  const anchor = DateTime.fromJSDate(anchorDate, { zone: config.tz });
  const threshold = anchor;                                    // e.g. 2025-07-22T00:00 at midnight
  const anchorWeekNumber = anchor.weekNumber;                  // ISO week number of anchor

  // Start cursor at the beginning of the anchor’s day
  let cursor = anchor.startOf('day');

  const occurrences = [];
  let first = true;
  let iterations = 0;
  const MAX_ITERATIONS = 1000;

  // 5. Loop until we have count picks
  while (occurrences.length < count) {
    iterations++;
    if (iterations > MAX_ITERATIONS) {
      console.warn(`[WARN] getNextOccurrences: Exceeded max iterations (${MAX_ITERATIONS}) for config:`, JSON.stringify(config));
      break;
    }
    // Only in weeks that satisfy the interval
    const weeksSinceAnchor = cursor.weekNumber - anchorWeekNumber;
    if (weeksSinceAnchor % interval === 0) {
      // If this weekday is one of our pick days…
      if (daysOfWeek.includes(cursor.weekday)) {
        // Build the pick datetime at the scheduled time
        const pickDateTime = cursor.set({
          hour,
          minute,
          second: 0,
          millisecond: 0
        });

        if (first) {
          // Only include the anchor day if its pick time is strictly AFTER the anchor instant
          if (pickDateTime > threshold) {
            occurrences.push(pickDateTime.toJSDate());
            first = false;
          }
        } else {
          occurrences.push(pickDateTime.toJSDate());
        }
      }
    }

    // Move to the next day
    cursor = cursor.plus({ days: 1 }).startOf('day');
    // If we’ve rolled past the anchor day without picking, we’re now in “subsequent” mode
    if (first && cursor > anchor.startOf('day')) {
      first = false;
    }
  }

  return occurrences;
}

/**
 * Formats a date into a human-readable string.
 * 
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string or 'Invalid Date' if date is invalid
 * 
 * @example
 * const formatted = formatDate(new Date('2024-01-15')); // Returns 'Mon Jan 15 2024'
 */
function formatDate(date) {
  
  return date ? date.toDateString() : 'Invalid Date';
}

/**
 * Generates timezone options for the rotation form dropdown.
 *
 * Uses IANA named timezones (e.g. Australia/Sydney) instead of fixed-offset
 * Etc/GMT zones so that rotations automatically follow daylight saving time.
 * Sorted by standard UTC offset, west-to-east.
 *
 * Backwards compatibility: configs saved with old Etc/GMT values continue to
 * work at runtime (Luxon and cron both accept them). The edit modal just won't
 * show a pre-selected value for those configs – the user picks once and the new
 * IANA value is saved going forward.
 *
 * @returns {Array<{text: {type: string, text: string}, value: string}>}
 */
function generateTimezoneOptions() {
  // ── Zone list ──────────────────────────────────────────────────────────────
  // Offset shown is standard (winter) time. DST-observing zones are labelled
  // so users know their clocks shift; fixed-offset zones note "(no DST)".
  //
  // Example rendered entry: "(UTC-05:00) New York / Toronto"
  const zones = [
    // ── Americas ──
    { label: '(UTC-12:00) Baker Island',                    value: 'Etc/GMT+12'                    },
    { label: '(UTC-11:00) Pago Pago',                       value: 'Pacific/Pago_Pago'             },
    { label: '(UTC-10:00) Hawaii (no DST)',                  value: 'Pacific/Honolulu'              },
    { label: '(UTC-09:30) Marquesas Islands',                value: 'Pacific/Marquesas'             },
    { label: '(UTC-09:00) Alaska',                          value: 'America/Anchorage'             },
    { label: '(UTC-08:00) Los Angeles / Vancouver',          value: 'America/Los_Angeles'           },
    { label: '(UTC-07:00) Denver / Salt Lake City',          value: 'America/Denver'                },
    { label: '(UTC-07:00) Phoenix (no DST)',                 value: 'America/Phoenix'               },
    { label: '(UTC-06:00) Chicago / Mexico City',            value: 'America/Chicago'               },
    { label: '(UTC-05:00) New York / Toronto',               value: 'America/New_York'              },
    { label: '(UTC-04:00) Halifax / Caracas',                value: 'America/Halifax'               },
    { label: '(UTC-03:30) Newfoundland',                     value: 'America/St_Johns'              },
    { label: '(UTC-03:00) São Paulo',                        value: 'America/Sao_Paulo'             },
    { label: '(UTC-03:00) Buenos Aires (no DST)',            value: 'America/Argentina/Buenos_Aires'},
    // ── Atlantic ──
    { label: '(UTC-02:00) South Georgia',                   value: 'Atlantic/South_Georgia'        },
    { label: '(UTC-01:00) Azores',                          value: 'Atlantic/Azores'               },
    // ── Europe / Africa ──
    { label: '(UTC+00:00) London / Dublin / Lisbon',         value: 'Europe/London'                 },
    { label: '(UTC+01:00) Paris / Berlin / Rome / Lagos',    value: 'Europe/Paris'                  },
    { label: '(UTC+02:00) Cairo / Helsinki / Kyiv',          value: 'Europe/Helsinki'               },
    { label: '(UTC+03:00) Moscow / Istanbul / Nairobi',      value: 'Europe/Moscow'                 },
    { label: '(UTC+03:00) Riyadh / Kuwait (no DST)',         value: 'Asia/Riyadh'                   },
    // ── Asia ──
    { label: '(UTC+03:30) Tehran',                          value: 'Asia/Tehran'                   },
    { label: '(UTC+04:00) Dubai / Muscat (no DST)',          value: 'Asia/Dubai'                    },
    { label: '(UTC+04:30) Kabul (no DST)',                   value: 'Asia/Kabul'                    },
    { label: '(UTC+05:00) Karachi / Tashkent (no DST)',      value: 'Asia/Karachi'                  },
    { label: '(UTC+05:30) Mumbai / Delhi / Colombo (no DST)',value: 'Asia/Kolkata'                  },
    { label: '(UTC+05:45) Kathmandu (no DST)',               value: 'Asia/Kathmandu'                },
    { label: '(UTC+06:00) Dhaka / Almaty (no DST)',          value: 'Asia/Dhaka'                    },
    { label: '(UTC+06:30) Yangon (no DST)',                  value: 'Asia/Yangon'                   },
    { label: '(UTC+07:00) Bangkok / Jakarta / Hanoi (no DST)',value: 'Asia/Bangkok'                 },
    { label: '(UTC+08:00) Singapore / Kuala Lumpur (no DST)',value: 'Asia/Singapore'                },
    { label: '(UTC+08:00) Beijing / Shanghai / Taipei (no DST)',value: 'Asia/Shanghai'              },
    // ── Australia ──
    { label: '(UTC+08:00) Perth (no DST)',                   value: 'Australia/Perth'               },
    { label: '(UTC+08:45) Eucla (no DST)',                   value: 'Australia/Eucla'               },
    { label: '(UTC+09:00) Tokyo / Osaka (no DST)',           value: 'Asia/Tokyo'                    },
    { label: '(UTC+09:00) Seoul (no DST)',                   value: 'Asia/Seoul'                    },
    { label: '(UTC+09:30) Darwin (no DST)',                  value: 'Australia/Darwin'              },
    { label: '(UTC+09:30) Adelaide',                         value: 'Australia/Adelaide'            },
    { label: '(UTC+10:00) Brisbane (no DST)',                value: 'Australia/Brisbane'            },
    { label: '(UTC+10:00) Sydney / Melbourne',               value: 'Australia/Sydney'              },
    { label: '(UTC+10:30) Lord Howe Island',                 value: 'Australia/Lord_Howe'           },
    // ── Pacific ──
    { label: '(UTC+11:00) Noumea / Honiara (no DST)',        value: 'Pacific/Noumea'                },
    { label: '(UTC+12:00) Auckland / Wellington',            value: 'Pacific/Auckland'              },
    { label: '(UTC+12:00) Fiji',                             value: 'Pacific/Fiji'                  },
    { label: '(UTC+12:45) Chatham Islands',                  value: 'Pacific/Chatham'               },
    { label: '(UTC+13:00) Tonga (no DST)',                   value: 'Pacific/Tongatapu'             },
    { label: '(UTC+13:00) Samoa',                            value: 'Pacific/Apia'                  },
    { label: '(UTC+14:00) Line Islands (no DST)',            value: 'Pacific/Kiritimati'            },
  ];

  return zones.map(({ label, value }) => ({
    text: { type: 'plain_text', text: label },
    value,
  }));
}

const { DateTime } = require('luxon');

/**
 * Formats a date into a human-readable string in the given timezone.
 * @param {Date|DateTime|string} date - The date to format
 * @param {string} tz - The IANA timezone string (e.g., 'Etc/GMT-10')
 * @returns {string} Formatted date string
 */
function formatDateTz(date, tz) {
  let dt = date instanceof DateTime ? date : DateTime.fromJSDate(date instanceof Date ? date : new Date(date));
  if (tz) dt = dt.setZone(tz);
  return dt.toFormat('ccc LLL dd yyyy'); // e.g., Tue Jul 15 2025
}

/**
 * Gets the ISO date string (YYYY-MM-DD) for a given date in the given timezone.
 * @param {Date|DateTime|string} date - The date
 * @param {string} tz - The IANA timezone string
 * @returns {string} ISO date string (YYYY-MM-DD)
 */
function getIsoDateTz(date, tz) {
  let dt = date instanceof DateTime ? date : DateTime.fromJSDate(date instanceof Date ? date : new Date(date));
  if (tz) dt = dt.setZone(tz);
  return dt.toISODate();
}

module.exports = {
  WEEKDAY_MAP,
  getWeekNumber,
  getNextOccurrences,
  formatDate,
  generateTimezoneOptions,
  formatDateTz,
  getIsoDateTz
};