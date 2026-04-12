# Minpaku-OS

LINE × Cloudflare で動く、民泊オーナー向けオープンソース PMS（Property Management System）。
**月額0円のインフラで、商用 PMS（月1〜3万円）と同じことを実現します。**

> 📘 **ビジュアル付きセットアップガイド**: デプロイ後、`https://<あなたの admin URL>/setup` でステップ別の手順を確認できます。

## 特徴

- 📅 **iCal 双方向同期** — Airbnb / Booking.com / 自社HP（Pinpoint Booking 等）の予約を毎時自動同期 + ダブルブッキング検知
- 💬 **LINE スタッフ管理** — シフト通知 / 承諾 / 完了報告 / 写真送信まで全部 LINE 内で完結
- 📲 **LIFF カレンダー** — スタッフが LINE 内でカレンダー UI からシフト希望を入力
- 📊 **180日カウント** — 民泊新法の年間稼働日数を自動追跡 + 上限警告
- 💰 **収益・人件費管理** — 売上 - 経費 - 人件費 = 営業利益を物件ごとに自動計算
- 🧹 **清掃チェックリスト** — 物件ごとの項目をスタッフへ LINE 配信、完了後に未チェック警告
- ✉️ **管理画面から LINE 送信** — 個別 / 役割別 / 全員に一斉配信（LINE Multicast）
- ⚡ **Cloudflare 無料運用** — Workers + D1 + Pages + KV の無料枠内で完結

## スクリーンショット

| ダッシュボード | カレンダー |
|:---:|:---:|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Calendar](docs/screenshots/calendar.png) |

| 予約管理 | 収益管理 |
|:---:|:---:|
| ![Reservations](docs/screenshots/reservations.png) | ![Revenue](docs/screenshots/revenue.png) |

| 物件管理 | スタッフ管理 |
|:---:|:---:|
| ![Properties](docs/screenshots/properties.png) | ![Staff](docs/screenshots/staff.png) |

## アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│  LINE Messaging API + LIFF（Tall）              │
│  スタッフ通知 / シフト管理 / カレンダー入力       │
└───────────┬─────────────────────────────────────┘
            │ Webhook / LIFF
┌───────────▼─────────────────────────────────────┐
│  Cloudflare Workers (apps/worker)                │
│  ├── 予約 CRUD + iCal 同期（毎時 cron）          │
│  ├── スタッフ・シフト管理                         │
│  ├── 収益・コスト・人件費管理                     │
│  ├── 宿泊者名簿（法定義務）                       │
│  ├── iCal フィード公開（在庫ブロック）            │
│  ├── LINE 個別/一斉メッセージ配信                 │
│  └── JWT 認証 + 招待リンク                       │
│  D1 (SQLite) / KV                                │
└───────────┬─────────────────────────────────────┘
            │ API
┌───────────▼──────────┐  ┌───────────────────────┐
│  Cloudflare Pages     │  │  VPS Agent（任意）     │
│  apps/admin           │  │  apps/agent            │
│  React + Tailwind     │  │  Hono + claude -p      │
│  ・管理画面            │  │  AI 機能用             │
│  ・LIFF カレンダー     │  │  - シフト提案          │
│  ・/setup ガイド       │  │  - メッセージ生成      │
└──────────────────────┘  │  - CSV/PDF 取込        │
                           └───────────────────────┘
```

## クイックスタート（要約）

詳細は **デプロイ後の `/setup` ページ**を参照してください。8ステップに整理されており、コマンドにコピーボタンが付いています。

```bash
# 1. クローン & インストール
git clone https://github.com/traveler0215/minpaku-os.git
cd minpaku-os && npm install

# 2. Cloudflare リソース作成（ID を wrangler.toml に貼り付け）
npx wrangler login
npx wrangler d1 create minpaku-os
npx wrangler kv namespace create KV

# 3. マイグレーション適用
for f in packages/db/migrations/*.sql; do
  npx wrangler d1 execute minpaku-os --remote --file=$f
done

# 4. LINE Messaging API + LINEログイン（LIFF）チャネル作成
#    → secret/token/LIFF ID を取得（手動）
#    → wrangler.toml の LIFF_ID を更新

# 5. シークレットを wrangler に投入
openssl rand -hex 32 | npx wrangler secret put ADMIN_JWT_SECRET
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_STAFF_CHANNEL_SECRET
npx wrangler secret put LINE_STAFF_ACCESS_TOKEN

# 6. デプロイ
npx wrangler deploy
cat > apps/admin/.env.production <<EOF
VITE_API_BASE_URL=https://<your-worker-url>
VITE_LIFF_ID=<your-liff-id>
EOF
cd apps/admin && npm run build && cd ../..
npx wrangler pages deploy apps/admin/dist --project-name minpaku-os-admin

# 7. 管理ユーザー登録
npx wrangler d1 execute minpaku-os --remote \
  --command="INSERT INTO admin_users (email, name, role) VALUES ('you@example.com', 'オーナー', 'owner')"

# 8. LINE Webhook URL に https://<your-worker-url>/webhook/line を設定
#    LINE Official Account Manager → 応答メッセージ OFF / Webhook ON
```

## VPS について

**VPS は必須ではありません。** 以下の AI 機能を使う場合のみ必要です：

- 🤖 シフト自動提案
- 🤖 ゲストメッセージ AI 下書き生成
- 🤖 売上 CSV/PDF の AI 取込

それ以外（予約・スタッフ・物件・収益・LINE シフト管理・iCal 同期・LIFF カレンダー）は **VPS なしで動作**します。

VPS を後から追加する場合は `apps/admin/.env.production` に `VITE_AGENT_ENABLED=true` を追加して再ビルドしてください。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Backend | Cloudflare Workers + D1 (SQLite) + KV |
| Frontend | React + Vite + Tailwind CSS |
| LINE | Messaging API + LIFF (Tall) |
| AI（任意） | claude -p（Claude Max サブスク内） |
| Hosting | Cloudflare Pages（Admin） + Workers（API） |

## 管理画面

| ページ | 機能 |
|--------|------|
| ダッシュボード | 今日の予約 / 180日カウント / 稼働率 |
| カレンダー | 月間予約カレンダー（FullCalendar） |
| 予約管理 | 一覧 / フィルタ / 手動登録 / 売上入力 / 宿泊者名簿 |
| 収益管理 | 売上サマリー / 経費登録 / 人件費 / 営業利益（PDF/CSV取込は任意の AI 機能） |
| シフト管理 | シフト追加・編集・削除（モーダル）/ LINE 通知付き / シフト希望マトリクス |
| スタッフ | 招待 / 役割 / 担当物件 / 時給 / LINE 連携 / 個別・一斉メッセージ送信 |
| 物件管理 | 基本情報 / iCal URL（Airbnb/Booking/自社HP）/ チェックリスト / マニュアル URL |
| メッセージ | AI 下書き生成（任意の AI 機能）/ テンプレート / 送信フロー |
| 設定 | 管理ユーザー招待 / システム設定 |

## LINE コマンド

| コマンド | 機能 |
|---------|------|
| `予約` | 今後の予約一覧 |
| `今日のシフト` | 本日のシフト確認 |
| `チェックリスト` | 清掃チェックリスト + マニュアル URL |
| `管理画面` | 管理画面 URL |
| `OK` / `NG` | シフト承諾 / 辞退 |
| `完了` | タスク完了報告 → 人件費自動計算 |
| `ヘルプ` | コマンド一覧 |

## ライセンス

MIT
