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
