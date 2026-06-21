import pg from 'pg';

let pool = null;

function databaseUrl() {
  return process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || '';
}

export function hasPostgres() {
  return Boolean(databaseUrl());
}

function parseDbUrl(url) {
  if (!url) return null;
  const value = String(url).trim().replace(/^"|"$/g, '');
  if (!value) return null;
  const noProto = value.replace(/^postgres(?:ql)?:\/\//i, '');
  const at = noProto.lastIndexOf('@');
  if (at < 0) return null;
  const creds = noProto.slice(0, at);
  const hostPart = noProto.slice(at + 1);
  const colon = creds.indexOf(':');
  const user = colon >= 0 ? creds.slice(0, colon) : creds;
  const password = colon >= 0 ? creds.slice(colon + 1) : '';
  const slash = hostPart.indexOf('/');
  const hostPort = slash >= 0 ? hostPart.slice(0, slash) : hostPart;
  const database = ((slash >= 0 ? hostPart.slice(slash + 1) : 'postgres').split('?')[0] || 'postgres').trim();
  const [host, portStr] = hostPort.split(':');
  return {
    host,
    port: portStr ? Number.parseInt(portStr, 10) : 5432,
    user: decodeURIComponent(user),
    password,
    database,
  };
}

export function getPool() {
  if (pool) return pool;
  const parsed = parseDbUrl(databaseUrl());
  if (!parsed?.host) {
    throw new Error('postgres_not_configured');
  }
  pool = new pg.Pool({
    ...parsed,
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  return pool;
}

export async function query(sql, params = []) {
  if (!hasPostgres()) {
    // Return empty result set instead of crashing
    return { rows: [], rowCount: 0 };
  }
  return getPool().query(sql, params);
}
