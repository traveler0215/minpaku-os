import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * wrangler.toml の D1 ID / KV ID / LIFF ID / name を書き換える。
 * TOML ライブラリを使わずシンプルな正規表現で処理（@iarna/toml のコメント保持問題回避）。
 */
export async function updateWranglerToml(
  cwd: string,
  values: {
    workerName: string
    databaseName: string
    d1Id: string
    kvId: string
    liffId: string
  },
): Promise<void> {
  const filePath = path.join(cwd, 'wrangler.toml')
  let content = await readFile(filePath, 'utf-8')

  content = content.replace(/^name\s*=\s*"[^"]*"/m, `name = "${values.workerName}"`)
  content = content.replace(/LIFF_ID\s*=\s*"[^"]*"/, `LIFF_ID = "${values.liffId}"`)
  content = content.replace(
    /database_name\s*=\s*"[^"]*"/,
    `database_name = "${values.databaseName}"`,
  )
  content = content.replace(
    /database_id\s*=\s*"[^"]*"/,
    `database_id = "${values.d1Id}"`,
  )
  // KV の id（他の id と衝突しないように [[kv_namespaces]] ブロック内だけを狙う）
  content = content.replace(
    /(\[\[kv_namespaces\]\][\s\S]*?)id\s*=\s*"[^"]*"/,
    `$1id = "${values.kvId}"`,
  )

  await writeFile(filePath, content, 'utf-8')
}

/**
 * apps/admin/.env.production を書き込む
 */
export async function writeAdminEnvProduction(
  cwd: string,
  values: { workerUrl: string; liffId: string },
): Promise<void> {
  const filePath = path.join(cwd, 'apps', 'admin', '.env.production')
  const content = [
    `VITE_API_BASE_URL=${values.workerUrl}`,
    `VITE_LIFF_ID=${values.liffId}`,
    '',
  ].join('\n')
  await writeFile(filePath, content, 'utf-8')
}

/**
 * マイグレーション SQL のパス一覧を取得
 */
export async function listMigrations(cwd: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const dir = path.join(cwd, 'packages', 'db', 'migrations')
  const files = await readdir(dir)
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join('packages', 'db', 'migrations', f))
}
