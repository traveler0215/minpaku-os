CREATE TABLE IF NOT EXISTS labor_costs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  shift_id    TEXT NOT NULL,
  staff_id    TEXT NOT NULL,
  staff_name  TEXT NOT NULL,
  property_id TEXT,
  date        TEXT NOT NULL,
  hours       REAL,
  wage_type   TEXT NOT NULL DEFAULT 'hourly',
  wage_rate   INTEGER,
  amount      INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shift_id)
);
