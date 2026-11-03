import 'dotenv/config';

const integer = (name: string, fallback: number) => Number(process.env[name] || fallback);

export const config = {
  port: integer('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || './data',
  databasePath: process.env.DATABASE_PATH || './data/app.db',
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  localStorageDir: process.env.LOCAL_STORAGE_DIR || './data/blobs',
  maxUploadBytes: integer('MAX_UPLOAD_BYTES', 50 * 1024 * 1024),
  sessionDays: integer('SESSION_DAYS', 14),
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret-before-deploying',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
  onlyOfficeUrl: process.env.ONLYOFFICE_URL || '',
  onlyOfficeSecret: process.env.ONLYOFFICE_JWT_SECRET || '',
  onlyOfficeInternalUrl: process.env.ONLYOFFICE_INTERNAL_URL || 'http://host.docker.internal:3000',
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  },
} as const;

if (process.env.NODE_ENV === 'production' && config.secret.length < 32) {
  throw new Error('生产环境必须设置长度至少为 32 的 SESSION_SECRET');
}
