CREATE TABLE IF NOT EXISTS staff_auto_messages (
  role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  body_text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (role, event_type)
);

INSERT OR IGNORE INTO staff_auto_messages (role, event_type, body_text) VALUES
  ('cleaner', 'shift_accept',   'シフトを承諾しました。' || char(10) || '清掃が完了したら「完了」と清掃後の写真をこちらのLINEで送ってください。'),
  ('cleaner', 'shift_complete', '完了を記録しました。清掃後の写真があれば続けて送信してください。'),
  ('cleaner', 'shift_decline',  '辞退を受け付けました。次のスタッフへ確認します。'),
  ('checkin', 'shift_accept',   'シフトを承諾しました。' || char(10) || 'チェックイン対応が完了したら「完了」と送ってください。'),
  ('checkin', 'shift_complete', '完了を記録しました。お疲れさまでした。'),
  ('checkin', 'shift_decline',  '辞退を受け付けました。次のスタッフへ確認します。'),
  ('manager', 'shift_accept',   'シフトを承諾しました。完了したら「完了」と送ってください。'),
  ('manager', 'shift_complete', '完了を記録しました。お疲れさまでした。'),
  ('manager', 'shift_decline',  '辞退を受け付けました。');
