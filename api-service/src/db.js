const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  user: config.postgres.user,
  password: config.postgres.password,
  database: config.postgres.database,
  host: config.postgres.host,
  port: config.postgres.port,
  options: '-c search_path=presentator',
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
