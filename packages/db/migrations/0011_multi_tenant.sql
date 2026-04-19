-- Multi-tenant foundation
-- All existing data is attached to the 'default' tenant.
-- SaaS signups will create new tenants.

-- ─── テナント（組織） ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name                TEXT NOT NULL,
  subdomain           TEXT UNIQUE,           -- e.g. 'tanaka' for tanaka.lyado.app
  plan                TEXT NOT NULL DEFAULT 'trial',
                      -- 'trial' | 'free' | 'pro' | 'business' | 'enterprise' | 'cancelled'
  trial_ends_at       TEXT,                   -- datetime, null if not in trial
  stripe_customer_id  TEXT UNIQUE,           -- Stripe Customer ID
  stripe_subscription_id TEXT,                -- Stripe Subscription ID
  property_limit      INTEGER NOT NULL DEFAULT 5,   -- included property count before overage
  ai_monthly_limit    INTEGER NOT NULL DEFAULT 100, -- AI message generation limit
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 既存データ用のデフォルトテナント
INSERT OR IGNORE INTO tenants (id, name, subdomain, plan, property_limit, ai_monthly_limit)
VALUES ('default', '既存オーナー', 'default', 'pro', 999, 10000);

-- ─── 全テーブルに tenant_id を追加 ───────────────────────
-- SQLiteは NOT NULL + DEFAULT で追加可能
ALTER TABLE properties           ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE reservations         ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE guest_registry       ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE staff_properties     ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE shift_requests       ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE shifts               ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE admin_users          ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE revenue_imports      ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE costs                ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE message_drafts       ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE ical_sync_logs       ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE cleaning_checklist_items   ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE cleaning_checklist_results ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE message_templates    ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE labor_costs          ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE staff_auto_messages  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

-- ─── staff テーブルは UNIQUE 制約を変更するため再構築 ───
-- 旧: line_user_id UNIQUE (グローバル)
-- 新: UNIQUE(tenant_id, line_user_id) (テナント別)
CREATE TABLE staff_new (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id        TEXT NOT NULL DEFAULT 'default',
  line_user_id     TEXT NOT NULL,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'cleaner',
  employment_type  TEXT NOT NULL DEFAULT 'part_time',
  hourly_wage      INTEGER,
  wage_type        TEXT NOT NULL DEFAULT 'hourly',
  is_active        INTEGER NOT NULL DEFAULT 1,
  invited_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, line_user_id)
);

INSERT INTO staff_new (id, tenant_id, line_user_id, name, role, employment_type, hourly_wage, wage_type, is_active, invited_at, created_at, updated_at)
SELECT id, 'default', line_user_id, name, role, employment_type, hourly_wage,
       COALESCE(wage_type, 'hourly'), is_active, invited_at, created_at, updated_at
FROM staff;

DROP TABLE staff;
ALTER TABLE staff_new RENAME TO staff;

-- ─── 既存ビュー annual_days_used を tenant_id 対応で再構築 ─
DROP VIEW IF EXISTS annual_days_used;
CREATE VIEW annual_days_used AS
SELECT
  r.tenant_id,
  r.property_id,
  CAST(strftime('%Y', r.checkin_date) AS INTEGER) AS year,
  SUM(
    CAST(julianday(MIN(r.checkout_date, date(strftime('%Y', r.checkin_date) || '-12-31')))
    - julianday(MAX(r.checkin_date, date(strftime('%Y', r.checkin_date) || '-01-01')))
    AS INTEGER)
  ) AS days_used
FROM reservations r
WHERE r.status NOT IN ('cancelled', 'blocked')
GROUP BY r.tenant_id, r.property_id, year;

-- ─── テナント絞り込み用インデックス ──────────────────────
CREATE INDEX IF NOT EXISTS idx_properties_tenant         ON properties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant       ON reservations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guest_registry_tenant     ON guest_registry(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_tenant              ON staff(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_properties_tenant   ON staff_properties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shift_requests_tenant     ON shift_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant             ON shifts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_tenant        ON admin_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_revenue_imports_tenant    ON revenue_imports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_costs_tenant              ON costs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_drafts_tenant     ON message_drafts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ical_sync_logs_tenant     ON ical_sync_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_items_tenant     ON cleaning_checklist_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_results_tenant   ON cleaning_checklist_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_tenant  ON message_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_labor_costs_tenant        ON labor_costs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_auto_messages_tenant ON staff_auto_messages(tenant_id);
