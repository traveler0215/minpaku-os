-- minpaku-os initial schema
-- Cloudflare D1 (SQLite)

-- ─── 物件 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name                TEXT NOT NULL,
  address             TEXT NOT NULL,
  checkin_time        TEXT NOT NULL DEFAULT '15:00',
  checkout_time       TEXT NOT NULL DEFAULT '11:00',
  airbnb_ical_url     TEXT,
  booking_ical_url    TEXT,
  lock_adapter        TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'remotelock' | 'sesame' | 'alfa'
  lock_config_json    TEXT,                             -- JSON: adapter固有設定
  annual_day_limit    INTEGER NOT NULL DEFAULT 180,     -- 民泊新法 上限日数
  notification_days   INTEGER NOT NULL DEFAULT 180,     -- 営業日数カウント対象年
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 予約 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservations (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  property_id     TEXT NOT NULL REFERENCES properties(id),
  platform        TEXT NOT NULL,   -- 'airbnb' | 'booking' | 'direct' | 'other'
  external_id     TEXT,            -- OTA側の予約ID / iCal UID
  guest_name      TEXT,
  guest_email     TEXT,
  guest_count     INTEGER NOT NULL DEFAULT 1,
  checkin_date    TEXT NOT NULL,   -- YYYY-MM-DD
  checkout_date   TEXT NOT NULL,   -- YYYY-MM-DD
  checkin_time    TEXT,            -- HH:MM (物件デフォルトを上書きする場合)
  checkout_time   TEXT,            -- HH:MM
  gross_amount    INTEGER,         -- 円（税込、OTA込み）
  net_amount      INTEGER,         -- 円（手数料差引後の実収入）
  ota_fee_amount  INTEGER,         -- OTA手数料
  status          TEXT NOT NULL DEFAULT 'confirmed',
                                   -- 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'blocked'
  notes           TEXT,
  raw_ical_data   TEXT,            -- iCalの生データ（更新検知用）
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(property_id, external_id)
);

-- 重複チェック用インデックス
CREATE INDEX IF NOT EXISTS idx_reservations_dates
  ON reservations(property_id, checkin_date, checkout_date);
CREATE INDEX IF NOT EXISTS idx_reservations_status
  ON reservations(property_id, status);

-- ─── 宿泊者名簿（法定3年保存） ───────────────────────────
CREATE TABLE IF NOT EXISTS guest_registry (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  reservation_id  TEXT NOT NULL REFERENCES reservations(id),
  full_name       TEXT NOT NULL,
  nationality     TEXT,
  passport_number TEXT,
  address         TEXT,
  checkin_date    TEXT NOT NULL,
  checkout_date   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- 法定保存期間: 3年
  delete_after    TEXT NOT NULL DEFAULT (datetime('now', '+3 years'))
);

-- ─── スタッフ ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  line_user_id     TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'cleaner',
                   -- 'cleaner' | 'checkin' | 'manager'
  employment_type  TEXT NOT NULL DEFAULT 'part_time',
                   -- 'part_time' | 'full_time'
  hourly_wage      INTEGER,        -- 円/時（人件費計算用）
  is_active        INTEGER NOT NULL DEFAULT 1,  -- 0 or 1
  invited_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── スタッフ担当物件 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_properties (
  staff_id     TEXT NOT NULL REFERENCES staff(id),
  property_id  TEXT NOT NULL REFERENCES properties(id),
  PRIMARY KEY (staff_id, property_id)
);

-- ─── シフト希望 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_requests (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  staff_id             TEXT NOT NULL REFERENCES staff(id),
  week_start_date      TEXT NOT NULL,  -- YYYY-MM-DD（月曜日）
  available_dates_json TEXT NOT NULL DEFAULT '[]',
                                       -- JSON: ["2026-04-14", "2026-04-16"]
  available_time_json  TEXT NOT NULL DEFAULT '{}',
                                       -- JSON: {"2026-04-14": {"from": "09:00", "to": "18:00"}}
  notes                TEXT,
  collected_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(staff_id, week_start_date)
);

-- ─── 確定シフト ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  staff_id              TEXT NOT NULL REFERENCES staff(id),
  property_id           TEXT NOT NULL REFERENCES properties(id),
  reservation_id        TEXT REFERENCES reservations(id),
  task_type             TEXT NOT NULL,
                        -- 'cleaning' | 'checkin' | 'checkout' | 'inspection'
  date                  TEXT NOT NULL,    -- YYYY-MM-DD
  start_time            TEXT,             -- HH:MM
  end_time              TEXT,             -- HH:MM
  status                TEXT NOT NULL DEFAULT 'proposed',
                        -- 'proposed' | 'notified' | 'confirmed' | 'declined' | 'completed' | 'cancelled'
  completion_note       TEXT,
  completion_photo_urls TEXT,             -- JSON: ["url1", "url2"]
  proposed_by           TEXT NOT NULL DEFAULT 'system',  -- 'system' | 'manual'
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shifts_date
  ON shifts(date, status);
CREATE INDEX IF NOT EXISTS idx_shifts_staff
  ON shifts(staff_id, date);

-- ─── 管理画面ユーザー ────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'viewer',
              -- 'owner' | 'manager' | 'viewer'
  is_active   INTEGER NOT NULL DEFAULT 1,
  last_login  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 売上インポート履歴 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS revenue_imports (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  platform     TEXT NOT NULL,    -- 'airbnb' | 'booking'
  period_from  TEXT NOT NULL,    -- YYYY-MM-DD
  period_to    TEXT NOT NULL,    -- YYYY-MM-DD
  row_count    INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
  imported_by  TEXT NOT NULL     -- admin_user email
);

-- ─── コスト記録 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS costs (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  property_id  TEXT NOT NULL REFERENCES properties(id),
  category     TEXT NOT NULL,
               -- 'cleaning' | 'supplies' | 'maintenance' | 'utilities' | 'other'
  amount       INTEGER NOT NULL,  -- 円
  date         TEXT NOT NULL,     -- YYYY-MM-DD
  description  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── メッセージ下書き ────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_drafts (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  reservation_id  TEXT NOT NULL REFERENCES reservations(id),
  message_type    TEXT NOT NULL,
                  -- 'inquiry_reply' | 'checkin_guide' | 'review_reply' | 'custom'
  original_text   TEXT,           -- ゲストからの問い合わせ文
  draft_text      TEXT NOT NULL,  -- claude -p生成の下書き
  final_text      TEXT,           -- オーナーが編集した最終版
  language        TEXT DEFAULT 'ja',
  status          TEXT NOT NULL DEFAULT 'draft',
                  -- 'draft' | 'approved' | 'sent'
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── iCal同期ログ ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ical_sync_logs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  property_id     TEXT NOT NULL REFERENCES properties(id),
  platform        TEXT NOT NULL,  -- 'airbnb' | 'booking'
  status          TEXT NOT NULL,  -- 'success' | 'error'
  added_count     INTEGER NOT NULL DEFAULT 0,
  updated_count   INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  synced_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 180日カウント（民泊新法） ───────────────────────────
CREATE VIEW IF NOT EXISTS annual_days_used AS
SELECT
  r.property_id,
  CAST(strftime('%Y', r.checkin_date) AS INTEGER) AS year,
  SUM(
    CAST(julianday(MIN(r.checkout_date, date(strftime('%Y', r.checkin_date) || '-12-31')))
    - julianday(MAX(r.checkin_date, date(strftime('%Y', r.checkin_date) || '-01-01')))
    AS INTEGER)
  ) AS days_used
FROM reservations r
WHERE r.status NOT IN ('cancelled', 'blocked')
GROUP BY r.property_id, year;
