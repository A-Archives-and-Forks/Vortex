import { NotificationAggregator } from '../src/extensions/mod_management/NotificationAggregator';

// Mock API for testing
const mockApi = {
  showErrorNotification: jest.fn(),
  sendNotification: jest.fn(),
};

describe('NotificationAggregator', () => {
  let aggregator: NotificationAggregator;

  beforeEach(() => {
    aggregator = new NotificationAggregator(mockApi as any);
    jest.clearAllMocks();
  });

  test('should show notifications immediately when aggregation is not active', async () => {
    aggregator.addNotification(
      'test-session',
      'error',
      'Test Error',
      'Test message',
      'TestMod',
      { allowReport: false }
    );

    // Wait for async notification to be processed
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockApi.showErrorNotification).toHaveBeenCalledWith('Test Error', 'Test message', {
      message: 'TestMod',
      allowReport: false,
      actions: undefined,
    });
  });

  test('should aggregate similar notifications', async () => {
    aggregator.startAggregation('test-session', 0);

    // Add multiple similar notifications
    aggregator.addNotification('test-session', 'error', 'Failed to install dependency', 'Download failed', 'Mod1');
    aggregator.addNotification('test-session', 'error', 'Failed to install dependency', 'Download failed', 'Mod2');
    aggregator.addNotification('test-session', 'error', 'Failed to install dependency', 'Download failed', 'Mod3');

    // Flush aggregation
    aggregator.flushAggregation('test-session');

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockApi.showErrorNotification).toHaveBeenCalledTimes(1);
    expect(mockApi.showErrorNotification).toHaveBeenCalledWith(
      "Failed to install dependency (3 dependencies)",
      {
        message: expect.stringContaining('Affected dependencies: Mod1, Mod2, Mod3'),
        affectedDependencies: expect.stringContaining('Mod1\nMod2\nMod3')
      },
      expect.objectContaining({
        allowReport: undefined,
        id: expect.stringContaining("aggregated-")
      })
    );
  });

  test('should handle different error types separately', async () => {
    aggregator.startAggregation('test-session', 0);

    aggregator.addNotification('test-session', 'error', 'Failed to install dependency', 'Download failed', 'Mod1');
    aggregator.addNotification('test-session', 'error', 'Failed to install dependency', 'Invalid URL', 'Mod2');

    aggregator.flushAggregation('test-session');

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockApi.showErrorNotification).toHaveBeenCalledTimes(2);
  });

  test('should handle many dependencies by truncating the list', async () => {
    aggregator.startAggregation('test-session', 0);

    // Add more than 5 dependencies
    for (let i = 1; i <= 7; i++) {
      aggregator.addNotification('test-session', 'error', 'Failed to install dependency', 'Download failed', `Mod${i}`);
    }

    aggregator.flushAggregation('test-session');

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockApi.showErrorNotification).toHaveBeenCalledWith(
      "Failed to install dependency (7 dependencies)",
      {
        affectedDependencies: expect.stringContaining("Mod1\nMod2\nMod3\nMod4\nMod5\nMod6\nMod7"),
        message: expect.stringContaining("and 2 more")
      },
      expect.objectContaining({
        allowReport: undefined,
        id: expect.stringContaining("aggregated-error-Failed to install dependency")
      })
    );
  });

  test('should auto-flush on timeout', async () => {
    aggregator.startAggregation('test-session', 100); // 100ms timeout

    aggregator.addNotification('test-session', 'error', 'Test Error', 'Test message', 'TestMod');

    // Wait for timeout and additional processing time
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockApi.showErrorNotification).toHaveBeenCalledTimes(1);
  });

  test('should stop aggregation and flush notifications', async () => {
    aggregator.startAggregation('test-session', 0);
    aggregator.addNotification('test-session', 'error', 'Test Error', 'Test message', 'TestMod');

    aggregator.stopAggregation('test-session');

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockApi.showErrorNotification).toHaveBeenCalledTimes(1);
    expect(aggregator.isAggregating('test-session')).toBe(false);
  });
});