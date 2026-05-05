const required = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: missing required env var ${name}`);
    process.exit(1);
  }
  return v;
};

const config = {
  postgres: {
    user: process.env.POSTGRES_USER || 'presentator',
    password: required('POSTGRES_PASSWORD'),
    database: process.env.POSTGRES_DB || 'presentator',
    host: process.env.POSTGRES_HOST || 'postgres',
    port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
  },
  jwtSecret: required('JWT_SECRET'),
  internalApiKey: required('INTERNAL_API_KEY'),
  seedUserEmail: process.env.SEED_USER_EMAIL || 'test@presentator.local',
  seedUserPassword: required('SEED_USER_PASSWORD'),
  n8nWebhookUrl:
    process.env.N8N_WEBHOOK_URL ||
    'http://n8n:5678/webhook/presentator-pipeline',
  extractorBaseUrl:
    process.env.EXTRACTOR_BASE_URL || 'http://extractor-service:3003',
  port: parseInt(process.env.PORT, 10) || 3001,
  processingTimeoutMinutes: parseInt(process.env.PROCESSING_TIMEOUT_MINUTES, 10) || 8,
};

module.exports = config;
