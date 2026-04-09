-- Minpaku-OS デモ用シードデータ
-- 使い方: npx wrangler d1 execute minpaku-os --local --file=packages/db/seed.sql

PRAGMA foreign_keys=OFF;

-- 管理ユーザー
INSERT OR IGNORE INTO admin_users (id, email, name, role, is_active) VALUES
  ('demo-owner', 'demo@example.com', 'デモオーナー', 'owner', 1),
  ('demo-manager', 'manager@example.com', 'デモマネージャー', 'manager', 1);

-- 物件
INSERT OR IGNORE INTO properties (id, name, address, checkin_time, checkout_time, annual_day_limit, license_type, max_guests, description, amenities, access_info, house_rules, wifi_ssid, wifi_password, emergency_contact) VALUES
  ('prop-001', '渋谷アパートメント', '東京都渋谷区神南1-1-1', '15:00', '11:00', 180, 'minpaku', 4,
   '渋谷駅徒歩5分の好立地。最上階角部屋で日当たり良好。',
   'キッチン、洗濯機、乾燥機、バスタブ、Wi-Fi、プロジェクター、Bluetoothスピーカー',
   'JR渋谷駅ハチ公口から徒歩5分。109を右手に見ながら直進、2つ目の信号を左折。白いマンションの5F。',
   '22時以降は静かにお過ごしください。ゴミは分別して玄関横のボックスへ。土足禁止。',
   'Shibuya-Guest-5F', 'welcome2026', '090-0000-0001'),
  ('prop-002', '箱根温泉コテージ', '神奈川県足柄下郡箱根町湯本123', '16:00', '10:00', 180, 'ryokan', 8,
   '箱根湯本駅から送迎あり。源泉かけ流し露天風呂付き一棟貸し。',
   '露天風呂、囲炉裏、BBQグリル、キッチン、薪ストーブ、駐車場2台、Wi-Fi',
   '箱根湯本駅東口ロータリーで送迎車がお迎えします。到着30分前にLINEでご連絡ください。',
   'BBQは21時まで。焚き火は指定エリアのみ。ペット不可。',
   'Hakone-Cottage', 'onsen2026', '090-0000-0002');

-- スタッフ
INSERT OR IGNORE INTO staff (id, line_user_id, name, role, employment_type, hourly_wage, wage_type, is_active) VALUES
  ('staff-001', 'Udemo_tanaka', '田中花子', 'cleaner', 'part_time', 1500, 'hourly', 1),
  ('staff-002', 'Udemo_suzuki', '鈴木太郎', 'cleaner', 'part_time', 12000, 'daily', 1),
  ('staff-003', 'Udemo_sato', '佐藤美咲', 'manager', 'full_time', 2000, 'hourly', 1);

-- スタッフ担当物件
INSERT OR IGNORE INTO staff_properties (staff_id, property_id) VALUES
  ('staff-001', 'prop-001'),
  ('staff-002', 'prop-002'),
  ('staff-003', 'prop-001'),
  ('staff-003', 'prop-002');

-- 予約（今月〜来月）
INSERT OR IGNORE INTO reservations (id, property_id, platform, external_id, guest_name, guest_email, guest_count, checkin_date, checkout_date, gross_amount, net_amount, ota_fee_amount, status) VALUES
  ('res-001', 'prop-001', 'airbnb', 'HM20260410', '山田太郎', 'yamada@example.com', 2, '2026-04-10', '2026-04-13', 45000, 40500, 4500, 'completed'),
  ('res-002', 'prop-001', 'booking', 'BK98765432', 'John Smith', 'john@example.com', 3, '2026-04-15', '2026-04-18', 60000, 51000, 9000, 'confirmed'),
  ('res-003', 'prop-002', 'airbnb', 'HM20260420', '李明', 'liming@example.com', 6, '2026-04-20', '2026-04-23', 120000, 108000, 12000, 'confirmed'),
  ('res-004', 'prop-001', 'direct', NULL, '佐々木次郎', 'sasaki@example.com', 2, '2026-04-25', '2026-04-27', 30000, 30000, 0, 'confirmed'),
  ('res-005', 'prop-002', 'booking', 'BK11223344', 'Emma Wilson', 'emma@example.com', 4, '2026-05-01', '2026-05-04', 96000, 81600, 14400, 'confirmed'),
  ('res-006', 'prop-001', 'airbnb', 'HM20260505', '高橋恵', 'takahashi@example.com', 1, '2026-05-05', '2026-05-07', 28000, 25200, 2800, 'confirmed');

-- コスト
INSERT OR IGNORE INTO costs (id, property_id, category, amount, date, description) VALUES
  ('cost-001', 'prop-001', 'cleaning', 5000, '2026-04-13', '山田様チェックアウト後清掃'),
  ('cost-002', 'prop-001', 'supplies', 3200, '2026-04-10', 'アメニティ補充（シャンプー・タオル）'),
  ('cost-003', 'prop-002', 'utilities', 15000, '2026-04-01', '4月分水道光熱費'),
  ('cost-004', 'prop-002', 'maintenance', 8000, '2026-04-05', '露天風呂フィルター交換'),
  ('cost-005', 'prop-001', 'other', 2000, '2026-04-15', 'Wi-Fiルーター月額');

-- 清掃チェックリスト
INSERT OR IGNORE INTO cleaning_checklist_items (id, property_id, label, sort_order) VALUES
  ('chk-001', 'prop-001', 'ベッドメイキング（シーツ交換）', 1),
  ('chk-002', 'prop-001', 'バスルーム清掃（カビチェック）', 2),
  ('chk-003', 'prop-001', 'キッチン清掃（コンロ・シンク）', 3),
  ('chk-004', 'prop-001', '掃除機がけ（全室）', 4),
  ('chk-005', 'prop-001', 'ゴミ回収・分別', 5),
  ('chk-006', 'prop-001', 'アメニティ補充チェック', 6),
  ('chk-007', 'prop-002', '露天風呂清掃・お湯張り', 1),
  ('chk-008', 'prop-002', '囲炉裏の灰処理', 2),
  ('chk-009', 'prop-002', 'BBQグリル清掃', 3),
  ('chk-010', 'prop-002', '全室掃除機・水拭き', 4),
  ('chk-011', 'prop-002', '薪ストーブ周り清掃', 5);

-- メッセージテンプレート
INSERT OR IGNORE INTO message_templates (id, name, category, language, body_text) VALUES
  ('tpl-001', 'チェックイン案内', 'checkin', 'ja',
   '{guest_name}様\n\nご予約ありがとうございます。チェックインのご案内です。\n\nチェックイン: {checkin_date} {checkin_time}\n住所: {address}\nアクセス: {access_info}\n\nWi-Fi: {wifi_ssid} / {wifi_password}\n\nご不明点がございましたらお気軽にお問い合わせください。\nお会いできることを楽しみにしております。'),
  ('tpl-002', 'チェックアウトお礼', 'checkout', 'ja',
   '{guest_name}様\n\nこの度はご宿泊いただきありがとうございました。\n快適にお過ごしいただけましたでしょうか。\n\nもしよろしければレビューを残していただけると大変嬉しいです。\nまたのご利用をお待ちしております。'),
  ('tpl-003', 'Check-in Guide', 'checkin', 'en',
   'Dear {guest_name},\n\nThank you for your reservation. Here are your check-in details:\n\nCheck-in: {checkin_date} {checkin_time}\nAddress: {address}\nAccess: {access_info}\n\nWi-Fi: {wifi_ssid} / {wifi_password}\n\nPlease don''t hesitate to contact us if you have any questions.\nWe look forward to welcoming you!');

-- 宿泊者名簿（法定義務サンプル）
INSERT OR IGNORE INTO guest_registry (id, reservation_id, full_name, nationality, passport_number, address, checkin_date, checkout_date) VALUES
  ('guest-001', 'res-001', '山田太郎', '日本', NULL, '東京都新宿区1-1-1', '2026-04-10', '2026-04-13'),
  ('guest-002', 'res-001', '山田花子', '日本', NULL, '東京都新宿区1-1-1', '2026-04-10', '2026-04-13');
