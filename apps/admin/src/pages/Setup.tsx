import { useState } from 'react'

const ACCENT = '#06C755'
const REPO_URL = 'https://github.com/traveler0215/minpaku-os'

interface CommandBlockProps {
  command: string
  language?: string
}

function CommandBlock({ command, language = 'bash' }: CommandBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false)

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard 不可（http など） */
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-gray-900 px-4 py-3 text-xs leading-relaxed text-gray-100">
        <code className={`language-${language}`}>{command}</code>
      </pre>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="absolute right-2 top-2 rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-gray-200 hover:bg-white/20"
      >
        {copied ? '✓ コピー済' : 'コピー'}
      </button>
    </div>
  )
}

interface StepCardProps {
  number: number
  title: string
  description?: string
  children: React.ReactNode
}

function StepCard({ number, title, description, children }: StepCardProps): JSX.Element {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-base font-bold text-white"
          style={{ backgroundColor: ACCENT }}
        >
          {number}
        </span>
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
      </div>
      {description && <p className="mb-3 ml-12 text-sm text-gray-600">{description}</p>}
      <div className="ml-12 space-y-3">{children}</div>
    </div>
  )
}

const FEATURES = [
  { emoji: '📅', title: 'iCal 双方向同期', body: 'Airbnb / Booking.com / 自社HP（Pinpoint Booking等）の予約を毎時自動同期。ダブルブッキング検知付き。' },
  { emoji: '💬', title: 'LINE スタッフ管理', body: 'シフト通知 → 承諾 → 完了 → 写真送信まで全部 LINE 内で完結。LIFFでカレンダー入力も。' },
  { emoji: '📊', title: '180日カウント', body: '民泊新法の年間稼働日数を物件ごとに自動カウント。上限が近づくと LINE で警告。' },
  { emoji: '💰', title: '収益・人件費管理', body: '売上 - 経費 - 人件費 = 営業利益を物件ごとに自動計算。OTA手数料の差引きも。' },
  { emoji: '🧹', title: '清掃チェックリスト', body: '物件ごとのチェック項目をスタッフに LINE で配信。マニュアル URL も埋め込み可。' },
  { emoji: '⚡', title: 'Cloudflare で無料運用', body: 'Workers + D1 + Pages + KV すべて無料枠で動作。サーバー代 0 円。' },
]

const SCREENSHOTS = [
  { src: '/screenshots/dashboard.png', alt: 'ダッシュボード', label: 'ダッシュボード' },
  { src: '/screenshots/calendar.png', alt: 'カレンダー', label: 'カレンダー' },
  { src: '/screenshots/staff.png', alt: 'スタッフ管理', label: 'スタッフ管理' },
  { src: '/screenshots/properties.png', alt: '物件管理', label: '物件管理' },
  { src: '/screenshots/reservations.png', alt: '予約管理', label: '予約管理' },
  { src: '/screenshots/revenue.png', alt: '収益管理', label: '収益管理' },
]

export function SetupPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50/50 via-white to-white">
      {/* ヘッダー */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg text-base font-bold text-white" style={{ backgroundColor: ACCENT }}>
              M
            </span>
            <span className="text-base font-bold text-gray-900">Minpaku-OS</span>
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            GitHub
          </a>
        </div>
      </header>

      {/* ヒーロー */}
      <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-green-50 px-4 py-1.5 text-xs font-semibold text-green-700">
          <span>🆓</span>
          <span>Cloudflare 無料枠で動く OSS PMS</span>
        </p>
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-5xl">
          LINE × Cloudflare で動く<br />
          民泊オーナー向け <span style={{ color: ACCENT }}>無料 PMS</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-gray-600 sm:text-lg">
          予約管理・スタッフ管理・収益管理を全部 LINE と管理画面で。
          月額 0 円のインフラで、商用 PMS（月額1〜3万円）と同じことを実現します。
        </p>

        {/* ワンコマンド CTA */}
        <div className="mx-auto mt-8 max-w-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">ワンコマンドでセットアップ</p>
          <CommandBlock command="npx create-minpaku-os@latest" />
          <p className="mt-2 text-xs text-gray-500">
            対話型ウィザードが クローン → Cloudflare 設定 → デプロイ まで自動実行します（所要5〜10分）
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#setup"
            className="rounded-lg px-6 py-3 text-sm font-bold text-white shadow-sm hover:opacity-90"
            style={{ backgroundColor: ACCENT }}
          >
            手動セットアップの手順を見る ↓
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            GitHub で見る
          </a>
        </div>
        <p className="mt-4 text-xs text-gray-500">MIT ライセンス ・ Cloudflare Workers / D1 / Pages</p>
      </section>

      {/* 特徴 */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 sm:text-3xl">主な機能</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 text-3xl">{feature.emoji}</div>
              <h3 className="mb-1 text-base font-bold text-gray-900">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-gray-600">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* スクリーンショット */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 sm:text-3xl">画面イメージ</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCREENSHOTS.map((shot) => (
            <figure key={shot.src} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <img src={shot.src} alt={shot.alt} className="aspect-video w-full object-cover object-top" loading="lazy" />
              <figcaption className="border-t border-gray-100 px-4 py-2 text-xs font-medium text-gray-600">{shot.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* 事前準備 */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900 sm:text-3xl">事前準備</h2>
        <p className="mb-8 text-center text-sm text-gray-500">セットアップ前に以下を用意してください</p>

        <div className="mx-auto max-w-3xl space-y-3">
          {[
            { name: 'Cloudflare アカウント', body: 'Workers / D1 / Pages を使うため。クレカ登録不要の無料プラン OK', required: true, link: 'https://dash.cloudflare.com/sign-up' },
            { name: 'LINE Developers アカウント', body: 'Messaging API（ボット）+ LINEログイン（LIFF）チャネルを2つ作ります', required: true, link: 'https://developers.line.biz/console/' },
            { name: 'Node.js 20以上', body: 'wrangler CLI と npm を実行するため', required: true, link: 'https://nodejs.org/' },
            { name: 'Git', body: 'リポジトリのクローン用', required: true, link: 'https://git-scm.com/' },
            { name: 'VPS（任意）', body: 'AI機能（シフト提案 / メッセージ生成 / CSV取込）を使いたい場合のみ。無くても基本機能は全部動きます', required: false },
          ].map((item) => (
            <div key={item.name} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.required ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {item.required ? '必' : '任'}
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">
                  {item.name}
                  {item.link && (
                    <a href={item.link} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs font-normal text-green-600 hover:underline">
                      開く →
                    </a>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* セットアップ手順 */}
      <section id="setup" className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900 sm:text-3xl">セットアップ手順</h2>
        <p className="mb-10 text-center text-sm text-gray-500">所要時間: 約 30〜60 分</p>

        <div className="space-y-6">
          <StepCard number={1} title="リポジトリをクローン" description="ローカルに minpaku-os をダウンロードして依存関係をインストール">
            <CommandBlock command={`git clone ${REPO_URL}.git\ncd minpaku-os\nnpm install`} />
          </StepCard>

          <StepCard number={2} title="Cloudflare リソースを作成" description="D1 (DB) と KV (キャッシュ) を作成します。出力された ID を wrangler.toml に貼り付けてください">
            <CommandBlock command={`npx wrangler login\nnpx wrangler d1 create minpaku-os\nnpx wrangler kv namespace create KV`} />
            <p className="text-xs text-gray-500">↑ 実行後、各コマンドが返した <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700">database_id</code> と <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700">id</code> を <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700">wrangler.toml</code> に書き込みます。</p>
          </StepCard>

          <StepCard number={3} title="DB マイグレーションを適用">
            <CommandBlock command={`for f in packages/db/migrations/*.sql; do\n  npx wrangler d1 execute minpaku-os --remote --file=$f\ndone`} />
          </StepCard>

          <StepCard number={4} title="LINE チャネルを作成" description="Messaging API と LINEログインの2チャネルが必要です">
            <ol className="ml-4 list-decimal space-y-2 text-sm text-gray-700">
              <li>
                <strong>Messaging API チャネル</strong>: <a href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline">LINE Developers Console</a> → 新規プロバイダー → Messaging API チャネル作成
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs text-gray-500">
                  <li>「LINE Official Account features」→ <strong>応答メッセージ OFF</strong> / <strong>Webhook ON</strong></li>
                  <li>Channel secret と Channel access token をメモ</li>
                </ul>
              </li>
              <li>
                <strong>LINEログイン チャネル</strong>: 同じプロバイダー内に LINE ログインチャネルを追加 → LIFF アプリ作成
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs text-gray-500">
                  <li>サイズ: <strong>Tall</strong></li>
                  <li>エンドポイント URL: <code className="rounded bg-gray-100 px-1">https://&lt;あなたの admin URL&gt;/shift-picker</code></li>
                  <li>ボットリンク機能: <strong>On (Aggressive)</strong> + Messaging API チャネルを選択</li>
                  <li>発行された LIFF ID をメモ</li>
                </ul>
              </li>
            </ol>
          </StepCard>

          <StepCard number={5} title="シークレットと環境変数を設定" description="Cloudflare Workers のシークレットに LINE 関連の値を登録します">
            <CommandBlock command={`# ランダムな JWT シークレットを生成してセット\nopenssl rand -hex 32 | npx wrangler secret put ADMIN_JWT_SECRET\n\n# LINE のシークレット類\nnpx wrangler secret put LINE_CHANNEL_SECRET\nnpx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN\nnpx wrangler secret put LINE_STAFF_CHANNEL_SECRET\nnpx wrangler secret put LINE_STAFF_ACCESS_TOKEN`} />
            <p className="text-xs text-gray-500">
              <code className="rounded bg-gray-100 px-1">wrangler.toml</code> の <code className="rounded bg-gray-100 px-1">LIFF_ID</code> も Step 4 で取得した ID に書き換えてください。
            </p>
          </StepCard>

          <StepCard number={6} title="デプロイ" description="Worker（API）と Pages（管理画面）の両方をデプロイ">
            <CommandBlock command={`# Worker をデプロイ\nnpx wrangler deploy\n\n# 管理画面の .env.production を作成\ncat > apps/admin/.env.production <<EOF\nVITE_API_BASE_URL=https://<デプロイ後の Worker URL>\nVITE_LIFF_ID=<Step 4 で取得した LIFF ID>\nEOF\n\n# 管理画面をビルド & デプロイ\ncd apps/admin && npm run build\ncd ../..\nnpx wrangler pages deploy apps/admin/dist --project-name minpaku-os-admin`} />
            <p className="text-xs text-gray-500">
              デプロイ後、Pages の URL を Step 4 の LIFF エンドポイント URL に反映するのを忘れずに。
            </p>
          </StepCard>

          <StepCard number={7} title="最初の管理ユーザーを登録">
            <CommandBlock command={`npx wrangler d1 execute minpaku-os --remote \\\n  --command="INSERT INTO admin_users (email, name, role) VALUES ('you@example.com', 'オーナー', 'owner')"`} />
            <p className="text-xs text-gray-500">
              管理画面 <code className="rounded bg-gray-100 px-1">https://&lt;your-admin-url&gt;/login</code> からそのメールでログイン → 6桁コードが API レスポンスに表示されます（MVP仕様）。
            </p>
          </StepCard>

          <StepCard number={8} title="LINE Webhook URL を設定">
            <p className="text-sm text-gray-700">
              LINE Developers Console → Messaging API チャネル → Webhook URL に以下を設定し、「検証」ボタンで Success が返ることを確認してください。
            </p>
            <CommandBlock command={`https://<あなたの Worker URL>/webhook/line`} />
          </StepCard>
        </div>
      </section>

      {/* VPS について */}
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6">
          <h3 className="mb-2 flex items-center gap-2 text-base font-bold text-amber-900">
            <span>💡</span>
            VPS は必須ではありません
          </h3>
          <p className="text-sm leading-relaxed text-amber-800">
            VPS が必要なのは <strong>AI機能</strong>（シフト自動提案 / ゲストメッセージ AI 生成 / CSV・PDF AI 取り込み）を使う場合のみです。
            <br />
            それ以外の <strong>予約・スタッフ・物件・収益・LINE シフト管理・iCal 同期</strong> などはすべて <strong>VPS なしで動作します</strong>。
            <br />
            まずは VPS なしで試して、後から必要になったら VPS の Claude agent を追加すれば OK です（その場合は <code className="rounded bg-amber-100 px-1">apps/admin/.env.production</code> に <code className="rounded bg-amber-100 px-1">VITE_AGENT_ENABLED=true</code> を追加して再ビルド）。
          </p>
        </div>
      </section>

      {/* よくある質問 */}
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 sm:text-3xl">よくある質問</h2>
        <div className="space-y-3">
          {[
            {
              q: '完全に無料で運用できますか？',
              a: 'はい。Cloudflare Workers / D1 / Pages / KV の無料枠で動きます。物件数や予約数が増えても、ほぼ無料枠内に収まります（D1 は1日5億行クエリ、Workers は1日10万リクエスト無料）。',
            },
            {
              q: 'スタッフは何人まで登録できますか？',
              a: '実質無制限です。LINE Messaging API の Push メッセージ無料枠（月200通）を超えると課金されますが、Multicast は1配信で500人まで送れるので少人数チームなら問題ありません。',
            },
            {
              q: '自社 HP の予約システムとも同期できますか？',
              a: 'はい。Airbnb / Booking.com に加えて、自社HP iCal URL（WordPress の Pinpoint Booking 等が発行）を物件設定に登録すれば、毎時自動で取り込まれます。',
            },
            {
              q: 'スタッフは LINE だけで操作できますか？',
              a: 'はい。シフト確認・承諾（OK）・辞退（NG）・完了報告（完了 + 写真）・チェックリスト確認・予約一覧表示まで、すべて LINE トーク内で完結します。シフト希望入力だけは LIFF（LINE 内ブラウザ）でカレンダー UI を使います。',
            },
            {
              q: 'カスタマイズはどこまで可能ですか？',
              a: 'MIT ライセンスのフルオープンソースなので自由に改変可能です。React + TypeScript + Tailwind なので、フロントエンド経験があればスタッフ追加・物件項目追加・通知文面変更などは簡単にできます。',
            },
          ].map((item) => (
            <details key={item.q} className="group rounded-xl border border-gray-200 bg-white p-4">
              <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-gray-900">
                {item.q}
                <span className="text-gray-400 group-open:rotate-180">▼</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA フッター */}
      <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">準備はできましたか？</h2>
        <p className="mt-3 text-sm text-gray-600">
          GitHub からクローンして、上記の手順に従ってセットアップしてください。
          <br />
          詰まったら Issue でお気軽にどうぞ。
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-6 py-3 text-sm font-bold text-white shadow-sm hover:opacity-90"
            style={{ backgroundColor: ACCENT }}
          >
            ⭐ GitHub で見る
          </a>
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            Issue を立てる
          </a>
        </div>
      </section>

      <footer className="border-t border-gray-200 bg-gray-50 py-6 text-center text-xs text-gray-500">
        <p>Minpaku-OS ・ MIT License ・ Powered by Cloudflare Workers</p>
      </footer>
    </div>
  )
}
