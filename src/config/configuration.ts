export default () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  defaultLang: process.env.DEFAULT_LANG || 'lo',
  // Database connection is read directly by Prisma from DATABASE_URL.
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  cors: {
    // Comma-separated allowed origins for the browser apps (credentials mode).
    origins: (
      process.env.CORS_ORIGINS ||
      'http://localhost:5173,http://127.0.0.1:5173'
    )
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  cookie: {
    name: process.env.COOKIE_NAME || 'access_token',
    secure: process.env.COOKIE_SECURE === 'true',
    // JWT lifetime in ms for the cookie maxAge (defaults to 1 day).
    maxAgeMs: parseInt(process.env.COOKIE_MAX_AGE_MS || '86400000', 10),
  },
  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@hrapp.la',
    adminUsername: process.env.SEED_ADMIN_USERNAME || 'admin',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  },
});
