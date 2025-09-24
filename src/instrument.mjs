import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

// Check if Sentry should be disabled
const shouldDisableSentry = () => {
  // Check for --no-sentry flag
  if (process.argv.includes('--no-sentry')) {
    return true;
  }

  // Check for environment variable
  if (process.env.HIVE_MIND_NO_SENTRY === 'true' || process.env.DISABLE_SENTRY === 'true') {
    return true;
  }

  // Check for CI environment (disable in CI by default)
  if (process.env.CI === 'true') {
    return true;
  }

  return false;
};

// Initialize Sentry if not disabled
if (!shouldDisableSentry()) {
  try {
    Sentry.init({
      dsn: "https://77b711f23c84cbf74366df82090dc389@o4510072519983104.ingest.us.sentry.io/4510072523325440",
      integrations: [
        nodeProfilingIntegration(),
      ],

      // Application name
      environment: process.env.NODE_ENV || 'production',
      release: `hive-mind@${process.env.npm_package_version || '0.12.0'}`,

      // Send structured logs to Sentry
      enableLogs: true,

      // Tracing
      tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1, // 100% in dev, 10% in prod

      // Set sampling rate for profiling
      profileSessionSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

      // Trace lifecycle automatically enables profiling during active traces
      profileLifecycle: 'trace',

      // Setting this option to true will send default PII data to Sentry
      sendDefaultPii: false, // Disabled for privacy

      // Set debug mode based on environment
      debug: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',

      // Before send hook to filter out sensitive data
      beforeSend(event, hint) {
        // Filter out sensitive environment variables
        if (event.contexts && event.contexts.runtime && event.contexts.runtime.env) {
          const sensitiveKeys = ['API_KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'ANTHROPIC'];
          Object.keys(event.contexts.runtime.env).forEach(key => {
            if (sensitiveKeys.some(sensitive => key.includes(sensitive))) {
              delete event.contexts.runtime.env[key];
            }
          });
        }

        // Filter out sensitive data from extra context
        if (event.extra) {
          const sensitiveKeys = ['api_key', 'token', 'secret', 'password'];
          Object.keys(event.extra).forEach(key => {
            if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
              delete event.extra[key];
            }
          });
        }

        return event;
      },

      // Integration specific options
      ignoreErrors: [
        // Ignore specific errors that are expected or not relevant
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        /^NetworkError/,
        /^TimeoutError/,
      ],

      // Transaction name
      beforeTransaction(context) {
        // Customize transaction names to be more meaningful
        if (context.name && context.name.startsWith('hive-mind')) {
          return context;
        }
        context.name = `hive-mind.${context.name || 'unknown'}`;
        return context;
      }
    });

    // Log that Sentry has been initialized
    if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      console.log('✅ Sentry initialized successfully');
    }
  } catch (error) {
    // Silently fail if Sentry initialization fails
    if (process.env.DEBUG === 'true') {
      console.error('Failed to initialize Sentry:', error.message);
    }
  }
} else {
  // Log that Sentry is disabled
  if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
    console.log('ℹ️  Sentry is disabled (--no-sentry flag or environment variable detected)');
  }
}

// Export Sentry for use in other modules
export default Sentry;

// Export utility function to check if Sentry is enabled
export const isSentryEnabled = () => !shouldDisableSentry() && Sentry.getClient() !== undefined;

// Export function to safely capture exceptions
export const captureException = (error, context = {}) => {
  if (isSentryEnabled()) {
    Sentry.captureException(error, {
      extra: context
    });
  }
};

// Export function to safely capture messages
export const captureMessage = (message, level = 'info', context = {}) => {
  if (isSentryEnabled()) {
    Sentry.captureMessage(message, level, {
      extra: context
    });
  }
};

// Export function to create a transaction
export const startTransaction = (name, op = 'task') => {
  if (isSentryEnabled()) {
    return Sentry.startTransaction({
      op,
      name,
    });
  }
  // Return a dummy transaction object if Sentry is disabled
  return {
    finish: () => {},
    setStatus: () => {},
    setData: () => {},
  };
};