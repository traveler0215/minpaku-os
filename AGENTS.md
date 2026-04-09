# minpaku-os — Codex エージェント仕様書

民泊（Airbnb / Booking.com 等）向けの OSS 管理システム。
Cloudflare Workers + D1 + LINE Messaging API + `claude -p` で動作する。

---

## プロジェクト概要

| 項目 | 内容 |
|------|------|
| ターゲット | 民泊オーナー・管理代行業者（日本） |
| 主な利用者 | ホスト（管理画面）・スタッフ（LINE）|
| ゲストのLINE登録 | 不要。OTA経由で完結 |
| AI処理 | `claude -p`（VPS上、Maxサブスク内） |
| インフラ | Cloudflare Workers / D1 / Pages（無料枠）|

---

## ディレクトリ構成

```
minpaku-os/
├── AGENTS.md                          ← この仕様書（Codex 用）
├── wrangler.toml                      ← Cloudflare Workers 設定
├── package.json
├── apps/
│   ├── worker/                        ← Cloudflare Workers API
│   │   └── src/
│   │       ├── index.ts               ← エントリポイント（ルーティング + Cron）
│   │       ├── types.ts               ← 型定義（Env, DB型, API型）
│   │       ├── routes/
│   │       │   ├── reservations.ts    ← 予約 CRUD + 180日カウント
│   │       │   ├── staff.ts           ← スタッフ管理 + LINE招待
│   │       │   ├── shifts.ts          ← シフト管理 + claude -p 提案
│   │       │   ├── properties.ts      ← 物件 CRUD + iCal URL 設定
│   │       │   ├── revenue.ts         ← 売上 CSV インポート + 集計
│   │       │   ├── message-drafts.ts  ← claude -p メッセージ下書き
│   │       │   ├── auth.ts            ← ログイン・マジックリンク
│   │       │   └── webhook.ts         ← LINE Webhook ハンドラー
│   │       └── lib/
│   │           ├── ical.ts            ← iCal 取得・パース・差分同期
│   │           ├── line.ts            ← LINE API ユーティリティ
│   │           ├── auth.ts            ← JWT 生成・検証
│   │           └── cron.ts            ← Cron タスク（同期・通知・シフト）
│   ├── admin/                         ← Cloudflare Pages（管理画面 + LIFF）
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Dashboard.tsx      ← 今日のチェックイン/アウト + タスク
│   │       │   ├── Calendar.tsx       ← 月次予約カレンダー（OTA別色分け）
│   │       │   ├── Reservations.tsx   ← 予約一覧・詳細・手動登録
│   │       │   ├── Staff.tsx          ← スタッフ一覧・招待・役割設定
│   │       │   ├── Shifts.tsx         ← シフト表 + claude -p提案ボタン
│   │       │   ├── Properties.tsx     ← 物件設定・iCal URL・スマートロック
│   │       │   ├── Revenue.tsx        ← 売上管理・CSV インポート
│   │       │   ├── Messages.tsx       ← 問い合わせ返信下書き
│   │       │   ├── Settings.tsx       ← 通知設定・ユーザー管理
│   │       │   └── ShiftPicker.tsx    ← LIFF用シフト希望入力カレンダー
│   │       └── components/
│   │           ├── ReservationCard.tsx
│   │           ├── ShiftCalendar.tsx
│   │           └── ...
│   └── agent/                         ← VPS で動く claude -p エージェント
│       └── src/
│           ├── ical-sync.ts           ← iCal 同期（VPS cron 代替）
│           ├── shift-proposal.ts      ← シフト自動提案（claude -p 呼び出し）
│           ├── message-generator.ts   ← 問い合わせ返信下書き生成
│           └── report-generator.ts   ← 週次・月次レポート生成
└── packages/
    ├── db/
    │   └── migrations/
    │       └── 0001_initial.sql       ← D1 スキーマ（作成済み）
    └── lock-adapters/
        └── src/
            ├── interface.ts           ← SmartLockAdapter インターフェース
            ├── manual.ts              ← 未導入物件用（何もしない）
            ├── remotelock.ts          ← RemoteLOCK API
            └── sesame.ts              ← SESAME API
```

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| API サーバー | Cloudflare Workers (TypeScript) |
| データベース | Cloudflare D1 (SQLite) |
| 管理画面 | Cloudflare Pages + React + Vite |
| LINE 連携 | LINE Messaging API |
| AI 処理 | `claude -p` CLI（VPS 上で実行） |
| 認証 | JWT（メールマジックリンク） |

---

## 環境変数（wrangler.toml の [vars] または Secrets）

```
LINE_CHANNEL_SECRET           スタッフ用 LINE チャネルシークレット
LINE_CHANNEL_ACCESS_TOKEN     スタッフ用 LINE アクセストークン
ADMIN_JWT_SECRET              管理画面 JWT シークレット（32文字以上のランダム文字列）
```

---

## DBスキーマの要点

- `packages/db/migrations/0001_initial.sql` を参照
- 主要テーブル: `properties` / `reservations` / `staff` / `staff_properties` / `shift_requests` / `shifts` / `costs` / `message_drafts` / `revenue_imports`
- View: `annual_days_used`（180日カウント）
- 日付はすべて `TEXT` 型で `YYYY-MM-DD` 形式
- ID はすべて `TEXT`（`lower(hex(randomblob(8)))`）

---

## 実装済みのファイル（変更不要）

以下は実装済み。**上書きせず、必要なら import して使うこと。**

- `apps/worker/src/types.ts` — 全型定義
- `apps/worker/src/lib/ical.ts` — iCal パース・同期ロジック
- `apps/worker/src/lib/line.ts` — LINE API ユーティリティ
- `apps/worker/src/lib/auth.ts` — JWT 認証
- `apps/worker/src/lib/cron.ts` — Cron タスク
- `apps/worker/src/index.ts` — ルーティング
- `packages/lock-adapters/src/interface.ts` — スマートロック IF
- `packages/lock-adapters/src/manual.ts` — Manual アダプター
- `packages/db/migrations/0001_initial.sql` — D1 スキーマ

---

## 実装すべきファイル（Codex のタスク）

### 優先度: 高（MVP）

#### 1. `apps/worker/src/routes/webhook.ts`
LINE Webhook ハンドラー。以下の処理を実装する。

- `verifyLineSignature` で署名検証
- スタッフ新規フォロー → 招待コード確認 → staff テーブルに登録
- スタッフのテキスト返信:
  - シフト希望収集中（`KV: shift_collection_active = true`）→ `shift_requests` テーブルに保存
  - 「OK」→ 対応する shift の status を `confirmed` に更新 → オーナーに通知
  - 「NG」→ 次のスタッフに打診（`cron.ts` の `dispatchCleaningTask` 参照）
  - 「完了」→ shift を `completed` に更新
- スタッフの画像送信 → `completion_photo_urls` に保存
- postback データ処理: `action=confirm_shift`, `action=decline_shift`

#### 2. `apps/worker/src/routes/reservations.ts`
予約 API。

```
GET  /api/reservations              一覧（クエリ: property_id, month, status）
GET  /api/reservations/:id          詳細
POST /api/reservations              手動登録
PATCH /api/reservations/:id         更新（status, notes 等）
DELETE /api/reservations/:id        削除（softではなくDB削除）

GET  /api/reservations/180days/:property_id  年間営業日数サマリー
                                             annual_days_used VIEW を使う
```

- ダブルブッキング検知: POST 時に日程重複チェック → 重複があれば 409 + エラー詳細を返す

#### 3. `apps/worker/src/routes/staff.ts`
スタッフ管理 API。

```
GET  /api/staff                     一覧（property_id フィルタ可）
POST /api/staff/invite              招待リンク生成（6桁コードを KV に保存・24h有効）
PATCH /api/staff/:id                役割・担当物件・時給の更新
DELETE /api/staff/:id               無効化（is_active = 0）
GET  /api/staff/:id/shifts          特定スタッフのシフト一覧
```

#### 4. `apps/worker/src/routes/shifts.ts`
シフト管理 API。

```
GET  /api/shifts                    一覧（week, property_id, staff_id フィルタ）
POST /api/shifts                    手動シフト作成
PATCH /api/shifts/:id               ステータス更新
DELETE /api/shifts/:id              削除

POST /api/shifts/propose            claude -p でシフト自動提案
                                    → 予約データ + shift_requests を claude -p に渡す
                                    → JSON 結果を shifts テーブルに status='proposed' で保存
                                    → オーナーに LINE で確認送信

POST /api/shifts/confirm-all        提案済みシフトを一括確定 + スタッフに LINE 通知
```

`POST /api/shifts/propose` の claude -p 呼び出し方法:
- Worker から直接 claude -p は呼べないので、VPS の agent エンドポイント（`AGENT_ENDPOINT` 環境変数）に POST する
- VPS 側 (`apps/agent/src/shift-proposal.ts`) が claude -p を実行して JSON を返す

#### 5. `apps/worker/src/routes/properties.ts`
物件管理 API。

```
GET  /api/properties                一覧
GET  /api/properties/:id            詳細
POST /api/properties                新規登録
PATCH /api/properties/:id           更新
DELETE /api/properties/:id          削除

POST /api/properties/:id/sync-ical  手動 iCal 同期トリガー
GET  /api/properties/:id/sync-logs  同期ログ一覧
```

#### 6. `apps/worker/src/routes/revenue.ts`
売上管理 API。

```
POST /api/revenue/import            Airbnb/Booking.com CSV をアップロード
                                    → claude -p でパース（AGENT_ENDPOINT 経由）
                                    → 予約と external_id で紐付け
                                    → reservations.gross_amount / net_amount / ota_fee_amount を更新

GET  /api/revenue/summary           月次・年次サマリー（物件別・OTA別）
GET  /api/revenue/export            確定申告用 CSV エクスポート

POST /api/costs                     コスト登録
GET  /api/costs                     コスト一覧（property_id, month フィルタ）
```

#### 7. `apps/worker/src/routes/message-drafts.ts`
問い合わせ返信下書き API。

```
POST /api/messages/generate         問い合わせ文 → claude -p で返信下書き生成
                                    （AGENT_ENDPOINT 経由）
GET  /api/messages                  下書き一覧（reservation_id フィルタ）
PATCH /api/messages/:id             下書き編集・承認（status: draft → approved）
POST /api/messages/:id/send         テキストを最終版として保存（コピー用）
```

#### 8. `apps/worker/src/routes/auth.ts`（ルートファイル）
マジックリンク認証フロー。

```
POST /api/auth/login                メールアドレス送信 → KV に6桁コード保存
                                    → コードをレスポンスに返す（メール送信は外部サービスか手動）
POST /api/auth/verify               コード検証 → JWT 発行
GET  /api/auth/me                   現在のユーザー情報
```

#### 9. `apps/agent/src/shift-proposal.ts`
VPS 上で動作する Hono/Express サーバー。

- `POST /propose-shifts` → 予約 + シフト希望 JSON を受け取り → `claude -p` を子プロセスで実行 → JSON を返す
- `POST /generate-message` → 問い合わせ文を受け取り → `claude -p` で返信下書き生成
- `POST /parse-csv` → CSV テキストを受け取り → `claude -p` でパース → JSON を返す

`claude -p` の呼び出し例（Node.js）:
```typescript
import { execSync } from 'child_process'
const result = execSync(
  `echo ${JSON.stringify(prompt)} | claude -p`,
  { maxBuffer: 10 * 1024 * 1024 }
).toString()
```

#### 10. 管理画面 (`apps/admin/`)
React + Vite + Tailwind CSS で実装。

- Shadcn/ui を使うこと
- カレンダーは `react-big-calendar` または `@fullcalendar/react` を使うこと
- OTA別の色分け: Airbnb=赤, Booking.com=青, 直接予約=緑
- 180日カウントは Dashboard に常時表示（物件ごと）
- シフト表は週次カレンダー形式で、スタッフ別に色分け

#### 11. `apps/admin/src/pages/ShiftPicker.tsx`（LIFF）
スタッフがLINEトーク内で開くシフト希望入力カレンダー。

**概要:**
- LIFF SDK（`@line/liff`）でLINEユーザーIDを取得し、スタッフ認証に使う
- 来週月曜〜日曜の7日間を表示
- 各日付に「希望あり」チェックと時間帯（開始・終了）入力欄
- 送信すると `POST /api/shift-requests` に送信し、トーク画面に戻る

**UI構成:**
```
┌─────────────────────────────┐
│  来週のシフト希望             │
│  4/14(月)〜4/20(日)          │
├─────────────────────────────┤
│ ☑ 月 4/14  [10:00]〜[18:00] │
│ □ 火 4/15                   │
│ ☑ 水 4/16  [終日    ▼    ]  │
│ □ 木 4/17                   │
│ ☑ 金 4/18  [09:00]〜[15:00] │
│ □ 土 4/19                   │
│ □ 日 4/20                   │
├─────────────────────────────┤
│         [送信する]           │
└─────────────────────────────┘
```

**時間帯は以下のプリセットから選択:**
- 終日（09:00〜18:00）
- 午前（09:00〜13:00）
- 午後（13:00〜18:00）
- カスタム（開始・終了を手入力）

**送信データ形式（`POST /api/shift-requests`）:**
```json
{
  "line_user_id": "Uxxxxxxxxxxxxxxxx",
  "week_start_date": "2026-04-14",
  "available_dates": [
    { "date": "2026-04-14", "from": "10:00", "to": "18:00" },
    { "date": "2026-04-16", "from": "09:00", "to": "18:00" },
    { "date": "2026-04-18", "from": "09:00", "to": "15:00" }
  ]
}
```

**Workerへの追加エンドポイント（`apps/worker/src/routes/shifts.ts` に追記）:**
```
POST /api/shift-requests     LIFFからの希望を受け取りDBに保存
                             認証: line_user_id で staff を検索（JWT不要）
                             → shift_requests.available_dates_json に保存
                             → available_time_json にも時間帯を保存
```

**`apps/worker/src/lib/cron.ts` の `handleWeeklyShift` を修正:**
シフト希望収集メッセージにLIFF URLボタンを追加する。
```typescript
// 現在: pushText でテキストのみ
// 修正後: pushText + ボタンテンプレートでLIFF URLを添付
const liffUrl = `https://liff.line.me/${env.LIFF_ID}?week=${nextMonday}`
// ボタンテンプレートで「カレンダーを開く」ボタンを送信
```

**環境変数の追加（wrangler.toml [vars] に追記）:**
```
LIFF_ID = "REPLACE_WITH_YOUR_LIFF_ID"   # LINE Developers Console で取得
```

**ルーティング（`apps/admin/` の Vite 設定）:**
- `/shift-picker` → `ShiftPicker.tsx`
- それ以外のパス → 管理画面（認証必要）
- `ShiftPicker.tsx` は認証不要（LIFF SDK がLINEログインを担う）

**LIFF SDK の使い方:**
```typescript
import liff from '@line/liff'

// 初期化
await liff.init({ liffId: import.meta.env.VITE_LIFF_ID })
if (!liff.isLoggedIn()) liff.login()

// LINEユーザーIDの取得
const profile = await liff.getProfile()
const lineUserId = profile.userId  // これをAPIに送る

// 送信後にLINEトークに戻る
liff.closeWindow()
```

---

## コーディング規約

- TypeScript strict mode（`noImplicitAny: true`）
- Cloudflare Workers 環境: `fetch` / `crypto` は global で使用可能、`node:*` は `nodejs_compat` で可
- エラーレスポンスは `{ success: false, error: string }` の形式
- 成功レスポンスは `{ success: true, data: T }` の形式
- SQL は D1 の Prepared Statements を必ず使う（SQLインジェクション防止）
- `console.log` は可。`console.error` でエラーを記録
- コメントは日本語可

---

## 注意事項

- ゲストは LINE を使わない。LINE はスタッフ専用チャネル
- OTA との通信は iCal のみ（API 連携なし）
- AI 処理は Worker 内では行わない。VPS の agent エンドポイント経由で `claude -p` を呼ぶ
- パスポート画像・顔写真は MVP スコープ外（タブレットチェックインは Phase 3）
- スマートロックは `lock-adapters/` のアダプター経由で呼ぶ。直接 API は叩かない
