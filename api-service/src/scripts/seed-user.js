const bcrypt = require('bcryptjs');
const { pool, query } = require('../db');
const config = require('../config');

async function seed() {
  try {
    const existing = await query(
      'SELECT id FROM presentator.users WHERE email = $1',
      [config.seedUserEmail],
    );

    if (existing.rows.length > 0) {
      console.log(`Seed user "${config.seedUserEmail}" already exists — skipping.`);
      return;
    }

    const hash = await bcrypt.hash(config.seedUserPassword, 10);
    await query(
      `INSERT INTO presentator.users (id, email, name, password_hash, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, now())`,
      [config.seedUserEmail, 'Test User', hash],
    );

    console.log(`Seed user "${config.seedUserEmail}" created successfully.`);
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
