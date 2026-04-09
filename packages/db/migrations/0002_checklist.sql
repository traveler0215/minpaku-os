CREATE TABLE IF NOT EXISTS cleaning_checklist_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  property_id TEXT NOT NULL REFERENCES properties(id),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cleaning_checklist_results (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  shift_id TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES cleaning_checklist_items(id),
  checked INTEGER NOT NULL DEFAULT 0,
  photo_url TEXT,
  checked_at TEXT,
  UNIQUE(shift_id, item_id)
);

CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  language TEXT NOT NULL DEFAULT 'ja',
  body_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
