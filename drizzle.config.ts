import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.SQL_HOST!,
    user: process.env.SQL_ADMIN_USER!,
    password: process.env.SQL_ADMIN_PASSWORD!,
    database: process.env.SQL_DB_NAME!,
    ssl: false,
  },
});
