import path from 'node:path'
import { existsSync } from 'node:fs'
import chalk from 'chalk'
import tiged from 'tiged'

import { collectAnswers } from './prompts.js'
import {
  ensureWrangler,
  ensureLoggedIn,
  createD1Database,
  createKvNamespace,
  runMigrations,
  putSecret,
} from './cloudflare.js'
import {
  updateWranglerToml,
  writeAdminEnvProduction,
  listMigrations,
} from './templates.js'
import {
  deployWorker,
  buildAdmin,
  deployAdminPages,
  createAdminUser,
} from './deploy.js'
import {
  header,
  info,
  success,
  warn,
  fail,
  startSpinner,
  randomHex,
  run,
} from './utils.js'

const TEMPLATE_REPO = 'traveler0215/minpaku-os'

export async function main(): Promise<void> {
  printBanner()

  const answers = await collectAnswers()

  const targetDir = path.resolve(process.cwd(), answers.projectName)
  if (existsSync(targetDir)) {
    fail(`ディレクトリ "${answers.projectName}" は既に存在します。別の名前を選んでください。`)
    process.exit(1)
  }

  // ───────────────────────────────────────────────
  header('[1/8] リポジトリをクローン')
  const cloneSpinner = startSpinner(`${TEMPLATE_REPO} をクローン中...`)
  try {
    const emitter = tiged(TEMPLATE_REPO, { cache: false, force: true, verbose: false })
    await emitter.clone(targetDir)
    cloneSpinner.succeed('リポジトリをクローンしました')
  } catch (error) {
    cloneSpinner.fail('クローンに失敗しました')
    throw error
  }

  // ───────────────────────────────────────────────
  header('[2/8] 依存関係をインストール')
  const installSpinner = startSpinner('npm install 実行中 (数分かかる場合があります)...')
  try {
    await run('npm', ['install'], { cwd: targetDir, timeout: 600_000 })
    installSpinner.succeed('npm install 完了')
  } catch (error) {
    installSpinner.fail('npm install に失敗しました')
    throw error
  }

  // ───────────────────────────────────────────────
  header('[3/8] Cloudflare にログイン')
  await ensureWrangler(targetDir)
  await ensureLoggedIn(targetDir)

  // ───────────────────────────────────────────────
  header('[4/8] Cloudflare リソースを作成')
  const databaseName = answers.projectName
  const workerName = `${answers.projectName}-worker`

  const d1Spinner = startSpinner('D1 データベースを作成中...')
  const d1Id = await createD1Database(targetDir, databaseName)
  d1Spinner.succeed(`D1 データベース作成: ${chalk.dim(d1Id)}`)

  const kvSpinner = startSpinner('KV 名前空間を作成中...')
  const kvId = await createKvNamespace(targetDir, 'KV')
  kvSpinner.succeed(`KV 名前空間作成: ${chalk.dim(kvId)}`)

  info('wrangler.toml を自動更新...')
  await updateWranglerToml(targetDir, {
    workerName,
    databaseName,
    d1Id,
    kvId,
    liffId: answers.liffId,
  })
  success('wrangler.toml を更新しました')

  // ───────────────────────────────────────────────
  header('[5/8] DB マイグレーションを適用')
  const migrations = await listMigrations(targetDir)
  info(`${migrations.length} 件のマイグレーションを実行します`)
  await runMigrations(targetDir, databaseName, migrations)
  success('マイグレーション完了')

  // ───────────────────────────────────────────────
  header('[6/8] シークレットを登録')
  const jwtSecret = randomHex(32)
  const secretMap: Record<string, string> = {
    ADMIN_JWT_SECRET: jwtSecret,
    LINE_CHANNEL_SECRET: answers.lineChannelSecret,
    LINE_CHANNEL_ACCESS_TOKEN: answers.lineChannelAccessToken,
    LINE_STAFF_CHANNEL_SECRET: answers.lineChannelSecret,
    LINE_STAFF_ACCESS_TOKEN: answers.lineChannelAccessToken,
  }

  for (const [key, value] of Object.entries(secretMap)) {
    const spinner = startSpinner(`${key} を登録中...`)
    try {
      await putSecret(targetDir, key, value)
      spinner.succeed(`${key} を登録しました`)
    } catch (error) {
      spinner.fail(`${key} の登録に失敗しました`)
      throw error
    }
  }

  // ───────────────────────────────────────────────
  header('[7/8] デプロイ')
  const deploySpinner = startSpinner('Worker をデプロイ中...')
  const workerUrl = await deployWorker(targetDir)
  deploySpinner.succeed(`Worker デプロイ完了: ${chalk.underline(workerUrl)}`)

  info('apps/admin/.env.production を生成...')
  await writeAdminEnvProduction(targetDir, { workerUrl, liffId: answers.liffId })
  success('.env.production 生成完了')

  const buildSpinner = startSpinner('管理画面をビルド中...')
  try {
    await buildAdmin(targetDir)
    buildSpinner.succeed('管理画面ビルド完了')
  } catch (error) {
    buildSpinner.fail('管理画面のビルドに失敗しました')
    throw error
  }

  const pagesSpinner = startSpinner('Cloudflare Pages にデプロイ中...')
  const pagesUrl = await deployAdminPages(targetDir, answers.projectName)
  pagesSpinner.succeed(`管理画面デプロイ完了: ${chalk.underline(pagesUrl)}`)

  // ───────────────────────────────────────────────
  header('[8/8] 最初の管理ユーザーを登録')
  await createAdminUser(targetDir, databaseName, answers.ownerEmail, answers.ownerName)
  success(`管理ユーザー登録: ${answers.ownerEmail}`)

  // ───────────────────────────────────────────────
  printSuccess({
    projectName: answers.projectName,
    workerUrl,
    pagesUrl,
    ownerEmail: answers.ownerEmail,
    liffId: answers.liffId,
  })
}

function printBanner(): void {
  console.log()
  console.log(chalk.hex('#06C755').bold('  ╔═══════════════════════════════════════╗'))
  console.log(chalk.hex('#06C755').bold('  ║   Minpaku-OS セットアップウィザード    ║'))
  console.log(chalk.hex('#06C755').bold('  ╚═══════════════════════════════════════╝'))
  console.log()
  console.log(chalk.dim('  LINE × Cloudflare で動く無料 PMS のセットアップを自動化します'))
  console.log()
  console.log(chalk.dim('  このウィザードは以下を自動で実行します:'))
  console.log(chalk.dim('    • リポジトリクローン + npm install'))
  console.log(chalk.dim('    • Cloudflare D1 / KV の作成'))
  console.log(chalk.dim('    • マイグレーション 9件の適用'))
  console.log(chalk.dim('    • シークレット登録'))
  console.log(chalk.dim('    • Worker + 管理画面のデプロイ'))
  console.log(chalk.dim('    • 初回管理ユーザーの登録'))
  console.log()
  console.log(chalk.dim('  所要時間: 5〜10分（npm install / デプロイ時間による）'))
  console.log()
}

interface SuccessParams {
  projectName: string
  workerUrl: string
  pagesUrl: string
  ownerEmail: string
  liffId: string
}

function printSuccess(params: SuccessParams): void {
  console.log()
  console.log(chalk.green.bold('  ╔═══════════════════════════════════════╗'))
  console.log(chalk.green.bold('  ║         🎉 セットアップ完了！           ║'))
  console.log(chalk.green.bold('  ╚═══════════════════════════════════════╝'))
  console.log()
  console.log(chalk.bold('  📍 デプロイ URL:'))
  console.log(`     管理画面: ${chalk.underline(params.pagesUrl)}`)
  console.log(`     Worker:  ${chalk.underline(params.workerUrl)}`)
  console.log()
  console.log(chalk.bold('  🔐 ログイン:'))
  console.log(`     ${params.pagesUrl}/login で以下のメールを入力:`)
  console.log(`     ${chalk.green(params.ownerEmail)}`)
  console.log()
  console.log(chalk.bold('  ⚠️  最後の手動ステップ（LINE Developers Console）:'))
  console.log()
  console.log(`     1. Messaging API チャネル → Webhook URL を以下に設定:`)
  console.log(`        ${chalk.cyan(params.workerUrl + '/webhook/line')}`)
  console.log(`        「Webhook の利用」を ON / 「応答メッセージ」を OFF`)
  console.log()
  console.log(`     2. LIFF アプリ (ID: ${chalk.cyan(params.liffId)}) の`)
  console.log(`        エンドポイント URL を以下に設定:`)
  console.log(`        ${chalk.cyan(params.pagesUrl + '/shift-picker')}`)
  console.log()
  console.log(chalk.bold('  📖 次のステップ:'))
  console.log(`     • 物件を登録: ${params.pagesUrl}/properties`)
  console.log(`     • スタッフを招待: ${params.pagesUrl}/staff`)
  console.log(`     • iCal URL 設定で Airbnb / Booking.com と同期`)
  console.log()
  console.log(chalk.dim(`  問題があれば: https://github.com/${TEMPLATE_REPO}/issues`))
  console.log()
  warn(`プロジェクトディレクトリ: ${chalk.bold('./' + params.projectName)}`)
  console.log()
}
