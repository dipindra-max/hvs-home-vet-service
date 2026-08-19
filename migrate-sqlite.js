/*
  OPTIONAL one-time migration from the old SQLite database.

  Put a copy of the old data.sqlite in the project root, set DATABASE_URL,
  install dependencies, then run:

    npm run migrate:sqlite

  This script is intentionally NOT run during normal Render deployment.
  It imports old bookings/reviews into PostgreSQL and keeps their IDs where
  possible. If data.sqlite is not present, it exits without changing data.
*/

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

const sqlitePath = path.join(__dirname, "..", "data.sqlite");

if (!fs.existsSync(sqlitePath)) {
  console.log("No data.sqlite found. Nothing to migrate.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      pet VARCHAR(30),
      review VARCHAR(1500) NOT NULL,
      approved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      pet VARCHAR(30) NOT NULL,
      service VARCHAR(100) NOT NULL,
      date VARCHAR(30) NOT NULL,
      time VARCHAR(30) NOT NULL,
      address VARCHAR(500),
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      notes VARCHAR(2000),
      status VARCHAR(20) NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function main() {
  await ensureTables();

  const reviews = sqlite.prepare("SELECT * FROM reviews ORDER BY id").all();
  const bookings = sqlite.prepare("SELECT * FROM bookings ORDER BY id").all();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const r of reviews) {
      await client.query(`
        INSERT INTO reviews
          (id, name, rating, pet, review, approved, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,
                COALESCE($7::timestamptz,NOW()),
                COALESCE($7::timestamptz,NOW()))
        ON CONFLICT (id) DO NOTHING
      `, [
        r.id,
        String(r.name || "").slice(0,80),
        Number(r.rating),
        String(r.pet || "").slice(0,30),
        String(r.review || "").slice(0,1500),
        !!r.approved,
        r.created_at || null
      ]);
    }

    for (const b of bookings) {
      await client.query(`
        INSERT INTO bookings
          (id,name,phone,pet,service,date,time,address,lat,lng,notes,status,created_at,updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
           COALESCE($13::timestamptz,NOW()),
           COALESCE($13::timestamptz,NOW()))
        ON CONFLICT (id) DO NOTHING
      `, [
        b.id,
        String(b.name || "").slice(0,120),
        String(b.phone || "").slice(0,40),
        String(b.pet || "").slice(0,30),
        String(b.service || "").slice(0,100),
        String(b.date || "").slice(0,30),
        String(b.time || "").slice(0,30),
        String(b.address || "").slice(0,500),
        b.lat == null ? null : Number(b.lat),
        b.lng == null ? null : Number(b.lng),
        String(b.notes || "").slice(0,2000),
        ["new","confirmed","completed","cancelled"].includes(b.status) ? b.status : "new",
        b.created_at || null
      ]);
    }

    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('reviews','id'),
        COALESCE((SELECT MAX(id) FROM reviews), 1),
        true
      );
      SELECT setval(
        pg_get_serial_sequence('bookings','id'),
        COALESCE((SELECT MAX(id) FROM bookings), 1),
        true
      );
    `);

    await client.query("COMMIT");
    console.log(`Migration complete: ${bookings.length} bookings, ${reviews.length} reviews.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
