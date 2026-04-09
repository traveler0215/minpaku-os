ALTER TABLE properties ADD COLUMN license_type TEXT NOT NULL DEFAULT 'minpaku';
-- 'minpaku' = 民泊新法（住宅宿泊事業法）→ 年間180日制限あり
-- 'ryokan' = 旅館業法 → 年間稼働日数制限なし
