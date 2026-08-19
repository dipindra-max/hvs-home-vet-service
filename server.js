const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

if (!ADMIN_KEY || ADMIN_KEY === "change-this-key") {
  console.error("ERROR: Set a strong ADMIN_KEY in Render Environment.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : undefined,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initDatabase() {
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
      status VARCHAR(20) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','confirmed','completed','cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_approved_created
      ON reviews (approved, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_bookings_created
      ON bookings (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_bookings_status
      ON bookings (status);
  `);

  // Add newer columns to an older PostgreSQL installation if necessary.
  await pool.query(`
    ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);
}

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validLatLng(lat, lng) {
  if (lat === null || lng === null) return true;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function admin(req, res, next) {
  if (!ADMIN_KEY || req.get("x-admin-key") !== ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"]
}));

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (err) {
    console.error("Health check:", err);
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

// Public approved reviews only.
app.get("/api/reviews", async (req, res) => {
  try {
    const [reviews, stats] = await Promise.all([
      pool.query(`
        SELECT id, name, rating, pet, review, approved, created_at
        FROM reviews
        WHERE approved = TRUE
        ORDER BY created_at DESC, id DESC
      `),
      pool.query(`
        SELECT COUNT(*)::int AS count,
               COALESCE(AVG(rating), 0)::float AS avg
        FROM reviews
        WHERE approved = TRUE
      `)
    ]);

    res.json({
      reviews: reviews.rows,
      stats: stats.rows[0]
    });
  } catch (err) {
    console.error("GET /api/reviews:", err);
    res.status(500).json({ error: "Unable to load reviews" });
  }
});

// Customer submits a review; it remains stored until admin deletes it.
app.post("/api/reviews", async (req, res) => {
  try {
    const name = clean(req.body.name || req.body.x, 80);
    const rating = Number(req.body.rating);
    const pet = clean(req.body.pet, 30);
    const review = clean(req.body.review, 1500);

    if (!name || !review || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        error: "Name, rating (1-5), and review are required"
      });
    }

    const result = await pool.query(`
      INSERT INTO reviews (name, rating, pet, review)
      VALUES ($1, $2, $3, $4)
      RETURNING id, created_at
    `, [name, rating, pet, review]);

    res.status(201).json({
      ok: true,
      id: result.rows[0].id,
      message: "Review submitted for approval"
    });
  } catch (err) {
    console.error("POST /api/reviews:", err);
    res.status(500).json({ error: "Unable to save review" });
  }
});

// Customer creates a booking; nothing automatically expires or deletes it.
app.post("/api/bookings", async (req, res) => {
  try {
    const b = req.body || {};
    const name = clean(b.name, 120);
    const phone = clean(b.phone, 40);
    const pet = clean(b.pet, 30);
    const service = clean(b.service, 100);
    const date = clean(b.date, 30);
    const time = clean(b.time, 30);
    const address = clean(b.address, 500);
    const notes = clean(b.notes, 2000);
    const lat = numberOrNull(b.lat);
    const lng = numberOrNull(b.lng);

    if (!name || !phone || !pet || !service || !date || !time) {
      return res.status(400).json({ error: "Complete required fields" });
    }

    if (!validLatLng(lat, lng)) {
      return res.status(400).json({ error: "Invalid GPS coordinates" });
    }

    const result = await pool.query(`
      INSERT INTO bookings
        (name, phone, pet, service, date, time, address, lat, lng, notes)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, created_at
    `, [name, phone, pet, service, date, time, address, lat, lng, notes]);

    res.status(201).json({
      ok: true,
      id: result.rows[0].id,
      message: "Booking received"
    });
  } catch (err) {
    console.error("POST /api/bookings:", err);
    res.status(500).json({ error: "Unable to save booking" });
  }
});

// Admin: all bookings, newest first.
app.get("/api/admin/bookings", admin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, phone, pet, service, date, time, address,
             lat, lng, notes, status, created_at, updated_at
      FROM bookings
      ORDER BY created_at DESC, id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/admin/bookings:", err);
    res.status(500).json({ error: "Unable to load bookings" });
  }
});

// Admin: update status. This never deletes the booking.
app.patch("/api/admin/bookings/:id", admin, async (req, res) => {
  try {
    const status = clean(req.body.status, 20);
    if (!["new", "confirmed", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Invalid booking status" });
    }

    const result = await pool.query(`
      UPDATE bookings
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, status, updated_at
    `, [status, req.params.id]);

    if (!result.rowCount) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.json({ ok: true, booking: result.rows[0] });
  } catch (err) {
    console.error("PATCH /api/admin/bookings:", err);
    res.status(500).json({ error: "Unable to update booking" });
  }
});

// Admin manual deletion only. No automatic cleanup exists.
app.delete("/api/admin/bookings/:id", admin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM bookings WHERE id = $1 RETURNING id",
      [req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/bookings:", err);
    res.status(500).json({ error: "Unable to delete booking" });
  }
});

// Admin: all reviews, including pending and approved.
app.get("/api/admin/reviews", admin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, rating, pet, review, approved, created_at, updated_at
      FROM reviews
      ORDER BY created_at DESC, id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/admin/reviews:", err);
    res.status(500).json({ error: "Unable to load reviews" });
  }
});

// Admin approval/hide. Hiding does NOT delete the review.
app.patch("/api/admin/reviews/:id", admin, async (req, res) => {
  try {
    const approved = Boolean(req.body.approved);

    const result = await pool.query(`
      UPDATE reviews
      SET approved = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, approved, updated_at
    `, [approved, req.params.id]);

    if (!result.rowCount) {
      return res.status(404).json({ error: "Review not found" });
    }

    res.json({ ok: true, review: result.rows[0] });
  } catch (err) {
    console.error("PATCH /api/admin/reviews:", err);
    res.status(500).json({ error: "Unable to update review" });
  }
});

// Admin manual deletion only.
app.delete("/api/admin/reviews/:id", admin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM reviews WHERE id = $1 RETURNING id",
      [req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Review not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/reviews:", err);
    res.status(500).json({ error: "Unable to delete review" });
  }
});

async function start() {
  try {
    await initDatabase();
    await pool.query("SELECT NOW()");
    app.listen(PORT, () => {
      console.log(`HVS running on port ${PORT}`);
      console.log("PostgreSQL persistence is enabled.");
    });
  } catch (err) {
    console.error("Database startup failed:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});

start();
