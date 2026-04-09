CREATE TABLE IF NOT EXISTS guest_registry (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  guest_name TEXT NOT NULL,
  nationality TEXT,
  passport_number TEXT,
  address TEXT,
  occupation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE guest_registry ADD COLUMN IF NOT EXISTS occupation TEXT;
