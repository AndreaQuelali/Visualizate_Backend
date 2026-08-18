import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  // Database
  DATABASE_URL: Joi.string().required(),

  // JWT
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN_SECONDS: Joi.number().default(86400),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  // MinIO
  MINIO_ENDPOINT: Joi.string().default('localhost'),
  MINIO_PORT: Joi.number().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  MINIO_ACCESS_KEY: Joi.string().default('minioadmin'),
  MINIO_SECRET_KEY: Joi.string().default('minioadmin'),
  MINIO_BUCKET: Joi.string().default('visualizate'),

  // Render (PNG/PDF export)
  RENDER_CONCURRENCY: Joi.number().integer().min(1).max(8).default(2),
  RENDER_RETENTION_DAYS: Joi.number().integer().min(1).default(30),
  RENDER_MAX_ACTIVE: Joi.number().integer().min(1).default(3),
  RENDER_MAX_PER_HOUR: Joi.number().integer().min(1).default(20),

  // AI review (OpenAI). Without a key only the automatic rules run.
  OPENAI_API_KEY: Joi.string().optional().allow(''),
  AI_MODEL: Joi.string().default('gpt-4o'),
  AI_TIMEOUT_MS: Joi.number().integer().min(5000).default(60000),
  REVIEW_CONCURRENCY: Joi.number().integer().min(1).max(8).default(2),
  REVIEW_MAX_PER_PIECE_HOUR: Joi.number().integer().min(1).default(10),
  REVIEW_MONTHLY_QUOTA: Joi.number().integer().min(1).default(100),

  // SMTP (Mailpit in development / Gmail or custom SMTP in production)
  SMTP_HOST: Joi.string().default('localhost'),
  SMTP_PORT: Joi.number().default(1025),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().optional().allow(''),
  SMTP_PASS: Joi.string().optional().allow(''),
  SMTP_FROM: Joi.string().default('Visualizate <no-reply@visualizate.local>'),
});
