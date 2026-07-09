require('dotenv').config();
const { Pool } = require('pg');

const MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 10;

let poolConfig;

if (process.env.INSTANCE_CONNECTION_NAME) {
  poolConfig = {
    host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'starfleet',
    max: MAX_CONNECTIONS,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
} else {
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('/cloudsql')
      ? false
      : { rejectUnauthorized: false },
    max: MAX_CONNECTIONS,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    maxConnections: MAX_CONNECTIONS,
  };
}

module.exports = pool;
module.exports.getPoolStats = getPoolStats;
