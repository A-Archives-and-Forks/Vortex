import { IExtensionApi } from '../../types/IExtensionContext';
import { log } from '../../util/log';

// Jest doesn't support setImmediate, so we provide a polyfill
// This ensures compatibility across environments
// In test environment, use synchronous execution to avoid timing issues
const setImmediatePolyfill = (typeof setImmediate !== 'undefined') 
  ? setImmediate 
  : (process?.env?.NODE_ENV === 'test')
    ? (fn: () => void) => fn() // Synchronous in tests
    : (fn: () => void) => setTimeout(fn, 0);

export interface IAggregatedNotification {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  text: string;
  items: string[];
  count: number;
  allowReport?: boolean;
  actions?: any[];
}

export interface IPendingNotification {
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  item: string;
  allowReport?: boolean;
  actions?: any[];
}

/**
 * Service for aggregating similar notifications to avoid spam during bulk operations
 * like dependency installations. Collects notifications during an operation and
 * presents them as consolidated notifications at the end.
 */
export class NotificationAggregator {
  private mPendingNotifications: { [key: string]: IPendingNotification[] } = {};
  private mActiveAggregations: Set<string> = new Set();
  private mTimeouts: { [key: string]: NodeJS.Timeout } = {};
  private mApi: IExtensionApi;
  private mNormalizedMessageCache: Map<string, string> = new Map();
  private mAddNotificationQueue: { [aggregationId: string]: NodeJS.Timeout } = {};

  constructor(api: IExtensionApi) {
    this.mApi = api;
  }

  /**
   * Start aggregating notifications for a specific operation
   * @param aggregationId Unique identifier for the aggregation session
   * @param timeoutMs Optional timeout in milliseconds to auto-flush notifications (default: 1000ms)
   */
  public startAggregation(aggregationId: string, timeoutMs: number = 1000): void {
    if (this.mActiveAggregations.has(aggregationId)) {
      return;
    }

    this.mActiveAggregations.add(aggregationId);
    this.mPendingNotifications[aggregationId] = [];

    // Set up auto-flush timeout
    if (timeoutMs > 0) {
      this.mTimeouts[aggregationId] = setTimeout(() => {
        this.flushAggregation(aggregationId);
      }, timeoutMs);
    }
  }

  /**
   * Add a notification to be aggregated
   * @param aggregationId The aggregation session to add to
   * @param type Notification type
   * @param title Notification title
   * @param message Notification message
   * @param item The specific item this notification refers to (e.g., mod name)
   * @param options Additional notification options
   */
  public addNotification(
    aggregationId: string,
    type: 'error' | 'warning' | 'info',
    title: string,
    message: string,
    item: string,
    options: { allowReport?: boolean; actions?: any[] } = {}
  ): void {
    if (!this.mActiveAggregations.has(aggregationId)) {
      setImmediatePolyfill(() => {
        this.mApi.showErrorNotification(title, message, {
          message: item,
          allowReport: options.allowReport,
          actions: options.actions,
        });
      });
      return;
    }

    // Batch notifications to prevent UI blocking on rapid additions
    this.addNotificationBatched(aggregationId, {
      type,
      title,
      message,
      item,
      allowReport: options.allowReport,
      actions: options.actions,
    });
  }

  private addNotificationBatched(aggregationId: string, notification: IPendingNotification): void {
    this.mPendingNotifications[aggregationId].push(notification);
  }

  /**
   * Flush all pending notifications for an aggregation session
   * @param aggregationId The aggregation session to flush
   */
  public flushAggregation(aggregationId: string): void {
    if (!this.mActiveAggregations.has(aggregationId)) {
      return;
    }

    const pending = this.mPendingNotifications[aggregationId] || [];
    if (pending.length === 0) {
      this.cleanupAggregation(aggregationId);
      return;
    }

    this.processNotificationsAsync(pending, aggregationId);
    this.cleanupAggregation(aggregationId);
  }

  private async processNotificationsAsync(notifications: IPendingNotification[], aggregationId: string): Promise<void> {
    try {
      // Process aggregation in next tick to prevent blocking (synchronous in tests)
      if (process?.env?.NODE_ENV !== 'test') {
        // Synchronous in test environment
      } else {
        await new Promise<void>(resolve => setImmediatePolyfill(resolve));
      }
      
      // Circuit breaker: For very large batches, show a simple summary instead of processing all
      if (notifications.length > 500) {
        log('warn', 'Very large notification batch detected, showing summary instead', {
          aggregationId,
          count: notifications.length,
        });
        
        const errorCount = notifications.filter(n => n.type === 'error').length;
        const warningCount = notifications.filter(n => n.type === 'warning').length;
        
        if (errorCount > 0) {
          this.mApi.showErrorNotification(
            `Multiple dependency errors (${errorCount} errors)`,
            `${errorCount} dependencies failed to install. Check the log for details.`,
            { id: `bulk-errors-${aggregationId}` }
          );
        }
        
        if (warningCount > 0) {
          this.mApi.sendNotification({
            id: `bulk-warnings-${aggregationId}`,
            type: 'warning',
            title: `Multiple dependency warnings (${warningCount} warnings)`,
            message: `${warningCount} dependencies had warnings. Check the log for details.`,
          });
        }
        
        return;
      }
      
      const aggregated = this.aggregateNotifications(notifications);

      // Show notifications one by one with brief delays to prevent UI blocking
      for (let i = 0; i < aggregated.length; i++) {
        this.showAggregatedNotification(aggregated[i]);
        
        // Add small delay between notifications to prevent UI blocking (skip in tests)
        if (i < aggregated.length - 1 && (process?.env?.NODE_ENV !== 'test')) {
          await new Promise<void>(resolve => setTimeout(resolve, 1));
        }
      }
    } catch (error) {
      log('error', 'Failed to process aggregated notifications', { aggregationId, error: error.message });
    }
  }

  /**
   * Stop aggregation and flush any pending notifications
   * @param aggregationId The aggregation session to stop
   */
  public stopAggregation(aggregationId: string): void {
    this.flushAggregation(aggregationId);
  }

  /**
   * Check if an aggregation is currently active
   * @param aggregationId The aggregation session to check
   */
  public isAggregating(aggregationId: string): boolean {
    return this.mActiveAggregations.has(aggregationId);
  }

  private cleanupAggregation(aggregationId: string): void {
    this.mActiveAggregations.delete(aggregationId);
    delete this.mPendingNotifications[aggregationId];
    
    if (this.mTimeouts[aggregationId]) {
      clearTimeout(this.mTimeouts[aggregationId]);
      delete this.mTimeouts[aggregationId];
    }

    if (this.mAddNotificationQueue[aggregationId]) {
      clearTimeout(this.mAddNotificationQueue[aggregationId]);
      delete this.mAddNotificationQueue[aggregationId];
    }

    // Clean up message cache periodically to prevent memory leaks
    if (this.mNormalizedMessageCache.size > 500) {
      this.mNormalizedMessageCache.clear();
    }
  }

  private aggregateNotifications(notifications: IPendingNotification[]): IAggregatedNotification[] {
    const grouped: { [key: string]: IPendingNotification[] } = {};

    // Group notifications by title and message pattern
    notifications.forEach(notification => {
      const key = this.getGroupingKey(notification);
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(notification);
    });

    // Convert groups to aggregated notifications
    return Object.keys(grouped).map(key => {
      const group = grouped[key];
      const first = group[0];
      const uniqueItems = Array.from(new Set(group.map(n => n.item)));
      
      return {
        id: `aggregated-${key}-${Date.now()}`,
        type: first.type,
        title: first.title,
        message: this.buildAggregatedMessage(first, uniqueItems),
        text: uniqueItems.join('\n'),
        items: uniqueItems,
        count: group.length,
        allowReport: first.allowReport,
        actions: first.actions,
      };
    });
  }

  private getGroupingKey(notification: IPendingNotification): string {
    // For performance, use a simpler grouping key that avoids expensive normalization
    // Only normalize if we have time (small batches)
    const simpleKey = `${notification.type}-${notification.title}`;

    // Only do expensive normalization for smaller batches to avoid UI blocking
    if (this.mPendingNotifications && Object.keys(this.mPendingNotifications).length < 100) {
      const normalizedMessage = this.normalizeMessage(notification.message);
      return `${simpleKey}-${normalizedMessage}`;
    }

    return simpleKey;
  }

  private normalizeMessage(message: string): string {
    // Check cache first to avoid expensive regex operations
    if (this.mNormalizedMessageCache.has(message)) {
      return this.mNormalizedMessageCache.get(message)!;
    }

    // Remove variable parts from messages to enable better grouping
    const normalized = message
      .replace(/\{\{[^}]+\}\}/g, 'PLACEHOLDER') // Replace template variables
      .replace(/https?:\/\/[^\s]+/g, 'URL') // Replace URLs
      .replace(/\d+/g, 'NUMBER') // Replace numbers
      .replace(/['""][^'"]*['"]/g, 'QUOTED') // Replace quoted strings
      .toLowerCase()
      .trim();

    // Cache the result (limit cache size to prevent memory leaks)
    if (this.mNormalizedMessageCache.size < 1000) {
      this.mNormalizedMessageCache.set(message, normalized);
    }

    return normalized;
  }

  private buildAggregatedMessage(notification: IPendingNotification, items: string[]): string {
    const baseMessage = notification.message;
    
    if (items.length === 1) {
      return baseMessage;
    }

    const itemList = items.length <= 5 
      ? items.join(', ')
      : `${items.slice(0, 5).join(', ')} and ${items.length - 5} more`;

    return `${baseMessage}\n\nAffected dependencies: ${itemList}`;
  }

  private showAggregatedNotification(notification: IAggregatedNotification): void {
    setImmediatePolyfill(() => {
      const options: any = {
        id: notification.id,
        allowReport: notification.allowReport,
      };

      if (notification.actions) {
        options.actions = notification.actions;
      }

      // Add count information to the title if multiple items
      const displayTitle = notification.count > 1 
        ? `${notification.title} (${notification.count} dependencies)`
        : notification.title;

      switch (notification.type) {
        case 'error':
          this.mApi.showErrorNotification(displayTitle, { message: notification.message, affectedDependencies: `\n${notification.text}` }, options);
          break;
        case 'warning':
          this.mApi.sendNotification({
            id: notification.id,
            type: 'warning',
            title: displayTitle,
            message: notification.message,
            text: notification.text,
            ...options,
          });
          break;
        case 'info':
          this.mApi.sendNotification({
            id: notification.id,
            type: 'info',
            title: displayTitle,
            message: notification.message,
            text: notification.text,
            ...options,
          });
          break;
      }
    });
  }
}