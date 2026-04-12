import { run, extractHttpsUrl, info } from './utils.js'

/**
 * Worker をデプロイしてその URL を返す
 */
export async function deployWorker(cwd: string): Promise<string> {
  const { stdout, stderr } = await run('npx', ['wrangler', 'deploy'], { cwd })
  const combined = stdout + '\n' + stderr
  const url = extractHttpsUrl(combined, 'workers.dev')
  if (!url) throw new Error(`Worker デプロイ後の URL を抽出できませんでした。\n${combined}`)
  return url
}

/**
 * 管理画面をビルド（apps/admin/.env.production を事前に書き込んでから呼ぶ）
 */
export async function buildAdmin(cwd: string): Promise<void> {
  info('npm install (workspace) 実行中...')
  await run('npm', ['install'], { cwd, timeout: 300_000 })
  info('vite build 実行中...')
  const adminCwd = `${cwd}/apps/admin`
  await run('npm', ['run', 'build'], { cwd: adminCwd, timeout: 300_000 })
}

/**
 * Cloudflare Pages にデプロイしてその URL を返す
 */
export async function deployAdminPages(cwd: string, projectName: string): Promise<string> {
  // Pages プロジェクト名は lowercase で英数字+ハイフンのみ
  const sanitized = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 58)
  const pagesProjectName = `${sanitized}-admin`

  // プロジェクトがまだ無ければ作成
  try {
    await run('npx', ['wrangler', 'pages', 'project', 'create', pagesProjectName, '--production-branch', 'main'], { cwd })
  } catch {
    // 既存の場合はそのまま続行
  }

  const { stdout, stderr } = await run(
    'npx',
    [
      'wrangler',
      'pages',
      'deploy',
      'apps/admin/dist',
      '--project-name',
      pagesProjectName,
      '--commit-dirty=true',
    ],
    { cwd },
  )
  const combined = stdout + '\n' + stderr
  const url = extractHttpsUrl(combined, 'pages.dev')
  if (!url) throw new Error(`Pages デプロイ後の URL を抽出できませんでした。\n${combined}`)
  return url
}

/**
 * 管理ユーザーを D1 に登録
 */
export async function createAdminUser(
  cwd: string,
  databaseName: string,
  email: string,
  name: string,
): Promise<void> {
  // SQL インジェクション対策: シングルクォートをエスケープ
  const safeEmail = email.replace(/'/g, "''")
  const safeName = name.replace(/'/g, "''")
  const sql = `INSERT INTO admin_users (email, name, role) VALUES ('${safeEmail}', '${safeName}', 'owner') ON CONFLICT(email) DO UPDATE SET name=excluded.name, role='owner', is_active=1`
  await run('npx', ['wrangler', 'd1', 'execute', databaseName, '--remote', '--command', sql], { cwd })
}
