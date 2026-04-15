/**
 * Analytics service for tracking bot usage and events.
 * 
 * This module handles tracking of user interactions, rotation events,
 * and cleanup of old analytics data.
 */

const NestedStore = require('../stores/NestedStore');

/**
 * Analytics service class for tracking bot events and usage.
 */
class AnalyticsService {
  /**
   * Creates a new AnalyticsService instance.
   * @param {number} retentionDays - Number of days to retain analytics data
   */
  constructor(retentionDays = 90, createBackupCallback = null) {
    this.analyticsStore = new NestedStore('analytics.json');
    this.retentionDays = retentionDays;
    this.createBackup = createBackupCallback;
  }

  /**
   * Tracks an analytics event with timestamp and data.
   * 
   * @param {string} eventType - The type of event (e.g., 'pick_accepted', 'pick_skipped')
   * @param {object} data - Event-specific data
   * 
   * @example
   * analyticsService.trackEvent('pick_accepted', {
   *   channelId: 'C123',
   *   responder: 'U456',
   *   messageTs: '1234567890.123456'
   * });
   */
  trackEvent(eventType, data) {
    const now = new Date().toISOString();
    const event = {
      timestamp: now,
      type: eventType,
      data
    };
    
    const today = new Date().toISOString().split('T')[0];
    const dailyEvents = this.analyticsStore.getItem('events', today) || [];
    dailyEvents.push(event);
    this.analyticsStore.setItem('events', today, dailyEvents);
    this.analyticsStore.save();
    if (this.createBackup) this.createBackup();
  }

  /**
   * Cleans up old analytics data based on retention policy.
   * Removes events older than the specified retention period.
   */
  cleanupAnalytics() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
    
    const events = this.analyticsStore.get('events') || {};
    let cleaned = false;
    
    for (const date in events) {
      if (new Date(date) < cutoffDate) {
        this.analyticsStore.deleteItem('events', date);
        cleaned = true;
      }
    }
    
    if (cleaned) {
      this.analyticsStore.save();
      if (this.createBackup) this.createBackup();
      console.log('[INFO] Cleaned up old analytics data');
    }
  }

  /**
   * Gets analytics data for a specific date range.
   * 
   * @param {Date} startDate - Start date for the range
   * @param {Date} endDate - End date for the range
   * @returns {Array} Array of events within the date range
   */
  getEventsInRange(startDate, endDate) {
    const events = this.analyticsStore.get('events') || {};
    const allEvents = [];
    
    for (const date in events) {
      const eventDate = new Date(date);
      if (eventDate >= startDate && eventDate <= endDate) {
        allEvents.push(...events[date]);
      }
    }
    
    return allEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  /**
   * Gets summary statistics for a date range.
   * 
   * @param {Date} startDate - Start date for the range
   * @param {Date} endDate - End date for the range
   * @returns {object} Summary statistics
   */
  getSummaryStats(startDate, endDate) {
    const events = this.getEventsInRange(startDate, endDate);
    const stats = {
      totalEvents: events.length,
      eventTypes: {},
      uniqueUsers: new Set(),
      uniqueChannels: new Set()
    };
    
    events.forEach(event => {
      // Count event types
      stats.eventTypes[event.type] = (stats.eventTypes[event.type] || 0) + 1;
      
      // Track unique users and channels
      if (event.data.responder) {
        stats.uniqueUsers.add(event.data.responder);
      }
      if (event.data.channelId) {
        stats.uniqueChannels.add(event.data.channelId);
      }
    });
    
    return {
      totalEvents: stats.totalEvents,
      eventTypes: stats.eventTypes,
      uniqueUsers: stats.uniqueUsers.size,
      uniqueChannels: stats.uniqueChannels.size
    };
  }
}

module.exports = AnalyticsService; 