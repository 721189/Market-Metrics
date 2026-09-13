import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;
let dbInstance: any = null;

export function getDb() {
  if (!dbInstance) {
    if (!poolInstance) {
      poolInstance = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 10,
        connectionTimeoutMillis: 15000,
      });

      poolInstance.on('error', (err) => {
        console.error('Unexpected error on idle SQL pool client:', err);
      });
    }
    dbInstance = drizzle(poolInstance, { schema });
  }
  return dbInstance;
}
