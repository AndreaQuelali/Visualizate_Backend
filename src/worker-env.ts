// Imported first by worker.ts: this process only consumes queues, so it must
// run the workers regardless of how the API container is configured.
process.env.RUN_WORKERS = 'true';
