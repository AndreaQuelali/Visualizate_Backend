// Runs before the app is imported so ConfigModule sees these values.
process.env.RUN_WORKERS = 'false';
process.env.QUOTA_ACTIVE_PIECES = '3';
process.env.LOG_LEVEL = 'silent';
process.env.THROTTLE_USER_LIMIT = '100000';
process.env.THROTTLE_IP_LIMIT = '100000';
