import pg from 'pg';

let pool = null;

function databaseUrl() {
  return process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || '';
}

export function hasPostgres() {
  return Boolean(databaseUrl());
}

export function getPool() {
  if (pool) return pool;
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error('postgres_not_configured');
  }
  pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  return pool;
}

export async function query(sql, params = []) {
  return getPool().query(sql, params);
}
