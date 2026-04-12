# create-minpaku-os

Minpaku-OS を Cloudflare に **5〜10分**でセットアップする対話型ウィザード。

## 使い方

```bash
npx create-minpaku-os@latest
```

プロンプトに従って入力するだけで、以下が自動で実行されます：

1. **リポジトリクローン**（[traveler0215/minpaku-os](https://github.com/traveler0215/minpaku-os)）
2. **`npm install`** の実行
3. **Cloudflare ログイン**（wrangler login、未ログイン時のみブラウザが開きます）
4. **D1 データベース作成**
5. **KV 名前空間作成**
6. **`wrangler.toml`** の自動更新
7. **マイグレーション適用**
8. **シークレット登録**（Channel Secret / Access Token / JWT Secret 等）
9. **Worker デプロイ**
10. **管理画面ビルド + Pages デプロイ**
11. **初回管理ユーザー登録**

## 事前準備

実行前に以下を用意してください：

- **Cloudflare アカウント**（無料枠で OK）
- **LINE Developers アカウント** + 以下のチャネルを作成済み
  - Messaging API チャネル（スタッフ用ボット）
  - LINEログインチャネル + LIFF アプリ（カレンダー入力用、サイズは Tall）
- **Node.js 20以上**
- **Git**

LINE チャネル作成の詳細は [https://minpaku-os-admin.pages.dev/setup](https://minpaku-os-admin.pages.dev/setup) を参照。

## 入力する値

ウィザードから以下の値を聞かれます：

| 項目 | 例 |
|------|-----|
| プロジェクトのディレクトリ名 | `my-minpaku` |
| オーナー名（管理画面に表示） | `山田太郎` |
| 管理者メールアドレス | `owner@example.com` |
| Messaging API Channel Secret | `******` |
| Messaging API Channel Access Token | `******` |
| LIFF ID | `2009755679-D2HguPG1` |

## 自動化されないこと

- **LINE Developers Console での設定**：チャネル作成・LIFF 作成・Webhook URL 設定などは LINE の仕様上 API では自動化できないため、ウィザード完了後に手動で行う必要があります（案内が表示されます）。

## トラブルシューティング

### wrangler コマンドが見つからない
`npm install` が完了していない可能性があります。ターゲットディレクトリ内で再実行してください。

### D1 / KV の作成で「already exists」エラー
同じ名前のリソースが既に存在します。別のプロジェクト名を指定するか、Cloudflare Dashboard で古いリソースを削除してください。

### マイグレーションが途中で失敗
ネットワーク問題の可能性があります。ターゲットディレクトリで以下を手動実行して継続できます：

```bash
for f in packages/db/migrations/*.sql; do
  npx wrangler d1 execute <database_name> --remote --file=$f
done
```

## ライセンス

MIT
