/**
 * Scheduling service for managing rotation cron jobs.
 * 
 * This module handles the creation, management, and cleanup of scheduled
 * rotation picks using cron jobs.
 */

const { CronJob } = require('cron');
const { DateTime } = require('luxon');

/**
 * Service for managing scheduled rotation jobs.
 */
class SchedulerService {
  /**
   * Creates a new SchedulerService instance.
   */
  constructor() {
    // Map to hold all active CronJob instances, keyed by "channel:name"
    this.scheduledJobs = new Map();
  }

  /**
   * Creates and starts a CronJob with standardized logging.
   * 
   * @param {string} cronExpr - Cron expression for the job
   * @param {string} timezone - Timezone for the job
   * @param {Function} onTick - Function to execute when job triggers
   * @param {string} description - Human-readable description for logging
   * @returns {CronJob | null} The created job, or null if creation failed
   * 
   * @example
   * const job = schedulerService.createCronJob(
   *   '0 9 * * 1,3,5',
   *   'Etc/GMT-5',
   *   () => console.log('Job triggered'),
   *   'PICK job for On-Call'
   * );
   */
  createCronJob(cronExpr, timezone, onTick, description) {
    try {
      const job = new CronJob(cronExpr, onTick, null, true, timezone);
      console.log(`[INFO] Scheduled ${description} @ ${cronExpr} (${timezone})`);
      return job;
    } catch (err) {
      console.error(`[ERROR] Scheduling ${description} failed:`, err);
      return null;
    }
  }

  /**
   * Schedules a rotation job based on its configuration.
   * 
   * @param {string} channel - The Slack channel ID
   * @param {string} name - The rotation name
   * @param {object} config - The rotation configuration
   * @param {Function} onPickCallback - Function to call when pick should be triggered
   * @param {Function} onDailyResetCallback - Function to call for daily reset in this rotation's timezone
   */
  scheduleJob(channel, name, config, onPickCallback, onDailyResetCallback) {
    const jobKey = `${channel}:${name}`;
    
    // Stop existing job if it exists
    if (this.scheduledJobs.has(jobKey)) {
      const { pickJob, dailyResetJob } = this.scheduledJobs.get(jobKey);
      if (pickJob) pickJob.stop();
      if (dailyResetJob) dailyResetJob.stop();
      this.scheduledJobs.delete(jobKey);
    }
    
    let pickJob = null;
    let dailyResetJob = null;
    
    // Only schedule if we have the required configuration
    if (config.days?.length > 0 && config.time && config.tz) {
      const [hour, minute] = config.time.split(':');
      const days = config.days.map(d => {
        const dayMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
        return dayMap[d];
      }).join(',');
      
      const pickCronExpr = `${minute} ${hour} * * ${days}`;
      const frequencyInterval = config.frequency === 'fortnightly' ? 2 :
                               config.frequency === 'monthly'      ? 4 : 1;

      // Pre-parse the rotation's start instant in its own timezone.
      // Done outside the tick callback so the parse only happens once.
      const startDt = config.startDate
        ? DateTime.fromISO(config.startDate).setZone(config.tz)
        : null;

      const onPickTick = () => {
        // Weekly rotations always fire – no interval gate needed.
        if (frequencyInterval === 1) {
          onPickCallback(channel, name);
          return;
        }

        // Older configs may lack startDate. Rather than silently suppressing
        // the pick via NaN arithmetic (the original bug), fall back to always
        // firing and log a warning so the operator knows to re-save the config.
        if (!startDt) {
          console.warn(`[WARN] Rotation '${name}' has no startDate – firing pick unconditionally. Re-save the rotation to fix this.`);
          onPickCallback(channel, name);
          return;
        }

        // Count whole weeks elapsed since startDate, evaluated in the rotation's
        // timezone. Using an absolute diff avoids two bugs in the original code:
        //   1. ISO week numbers reset to 1 each January, causing signed-modulo
        //      to return -1 instead of 0 across year boundaries.
        //   2. getWeekNumber(new Date()) used the server's UTC clock, which sits
        //      in the previous ISO week for east-of-UTC zones at pick time.
        const nowInZone    = DateTime.now().setZone(config.tz);
        const weeksElapsed = Math.round(nowInZone.diff(startDt, 'weeks').weeks);
        if (weeksElapsed % frequencyInterval === 0) {
          onPickCallback(channel, name);
        }
      };
      
      pickJob = this.createCronJob(pickCronExpr, config.tz, onPickTick, `PICK job for ${name}`);
      
      // Schedule daily reset job for this rotation in its timezone
      if (onDailyResetCallback) {
        const onDailyResetTick = () => {
          onDailyResetCallback(channel, name, config);
        };
        
        dailyResetJob = this.createCronJob(
          '1 0 * * *', // 00:01 in the rotation's timezone
          config.tz,
          onDailyResetTick,
          `Daily reset for ${name}`
        );
      }
    }
    
    // Store the jobs if they were created successfully
    if (pickJob || dailyResetJob) {
      this.scheduledJobs.set(jobKey, { pickJob, dailyResetJob });
    }
  }

  /**
   * Stops and removes a specific rotation job.
   * 
   * @param {string} channel - The Slack channel ID
   * @param {string} name - The rotation name
   */
  stopJob(channel, name) {
    const jobKey = `${channel}:${name}`;
    if (this.scheduledJobs.has(jobKey)) {
      const { pickJob, dailyResetJob } = this.scheduledJobs.get(jobKey);
      if (pickJob) pickJob.stop();
      if (dailyResetJob) dailyResetJob.stop();
      this.scheduledJobs.delete(jobKey);
      console.log(`[INFO] Stopped job for ${name} in ${channel}`);
    }
  }

  /**
   * Stops all scheduled jobs.
   */
  stopAllJobs() {
    this.scheduledJobs.forEach(({ pickJob, dailyResetJob }, jobKey) => {
      if (pickJob) pickJob.stop();
      if (dailyResetJob) dailyResetJob.stop();
    });
    this.scheduledJobs.clear();
    console.log('[INFO] Stopped all scheduled jobs');
  }

  /**
   * Gets the number of active scheduled jobs.
   * 
   * @returns {number} Number of active jobs
   */
  getActiveJobCount() {
    return this.scheduledJobs.size;
  }

  /**
   * Gets information about all active jobs.
   * 
   * @returns {Array} Array of job information objects
   */
  getActiveJobs() {
    const jobs = [];
    this.scheduledJobs.forEach(({ pickJob, dailyResetJob }, jobKey) => {
      const [channel, name] = jobKey.split(':');
      jobs.push({
        channel,
        name,
        isRunning: pickJob ? pickJob.running : false,
        nextDate: pickJob ? pickJob.nextDate() : null,
        hasDailyReset: !!dailyResetJob,
        dailyResetRunning: dailyResetJob ? dailyResetJob.running : false
      });
    });
    return jobs;
  }

  /**
   * Checks if a specific job is scheduled.
   * 
   * @param {string} channel - The Slack channel ID
   * @param {string} name - The rotation name
   * @returns {boolean} True if job is scheduled
   */
  isJobScheduled(channel, name) {
    return this.scheduledJobs.has(`${channel}:${name}`);
  }

  /**
   * Schedules a daily reset job to reset skip status for all rotations.
   * @deprecated This method is deprecated. Daily resets are now handled per-rotation
   * in each rotation's timezone via the scheduleJob method.
   * 
   * @param {Function} resetCallback - Function to call for daily reset
   */
  scheduleDailyReset(resetCallback) {
    console.warn('[WARN] scheduleDailyReset is deprecated. Daily resets are now handled per-rotation.');
    // Schedule daily reset at 00:01 UTC to reset skip status (legacy behavior)
    const dailyResetJob = this.createCronJob(
      '1 0 * * *',
      'UTC',
      resetCallback,
      'Daily reset of skip status (deprecated)'
    );
    
    if (dailyResetJob) {
      this.scheduledJobs.set('daily_reset', { dailyResetJob });
      console.log('[INFO] Scheduled legacy daily reset job');
    }
  }
}

module.exports = SchedulerService; 