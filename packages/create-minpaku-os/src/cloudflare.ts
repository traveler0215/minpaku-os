import { run, runInteractive, extractD1Id, extractKvId, info, success } from './utils.js'

/**
 * wrangler がインストールされているか確認。無ければ一時 npx で代用できるか検証。
 */
export async function ensureWrangler(cwd: string): Promise<void> {
  try {
    await run('npx', ['wrangler', '--version'], { cwd })
  } catch {
    throw new Error('wrangler が見つかりません。npm install が完了しているか確認してください。')
  }
}

/**
 * Cloudflare にログインしているか確認。未ログインなら wrangler login を走らせる。
 */
export async function ensureLoggedIn(cwd: string): Promise<void> {
  try {
    const { stdout } = await run('npx', ['wrangler', 'whoami'], { cwd })
    if (stdout.toLowerCase().includes('not logged in') || stdout.includes('You are not authenticated')) {
      throw new Error('not logged in')
    }
    success('Cloudflare にログイン済み')
  } catch {
    info('Cloudflare にログインします。ブラウザが開きます…')
    await runInteractive('npx', ['wrangler', 'login'], { cwd })
    success('Cloudflare ログイン完了')
  }
}

/**
 * D1 データベースを作成して ID を返す。既に同名があれば既存 ID を取得する。
 */
export async function createD1Database(cwd: string, name: string): Promise<string> {
  try {
    const { stdout } = await run('npx', ['wrangler', 'd1', 'create', name], { cwd })
    const id = extractD1Id(stdout)
    if (!id) throw new Error(`D1 ID を抽出できませんでした。\n${stdout}`)
    return id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('already exists')) {
      // フォールバック: 一覧から ID を取得
      const { stdout } = await run('npx', ['wrangler', 'd1', 'list', '--json'], { cwd })
      try {
        const databases = JSON.parse(stdout) as Array<{ name: string; uuid: string }>
        const existing = databases.find((db) => db.name === name)
        if (existing) return existing.uuid
      } catch {
        /* ignore */
      }
    }
    throw err
  }
}

/**
 * KV 名前空間を作成して ID を返す。既に同名があれば既存 ID を取得する。
 */
export async function createKvNamespace(cwd: string, name: string = 'KV'): Promise<string> {
  try {
    const { stdout } = await run('npx', ['wrangler', 'kv', 'namespace', 'create', name], { cwd })
    const id = extractKvId(stdout)
    if (!id) throw new Error(`KV ID を抽出できませんでした。\n${stdout}`)
    return id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('already exists') || message.includes('duplicate')) {
      // フォールバック: 一覧から取得
      const { stdout } = await run('npx', ['wrangler', 'kv', 'namespace', 'list'], { cwd })
      try {
        const namespaces = JSON.parse(stdout) as Array<{ id: string; title: string }>
        const existing = namespaces.find((ns) => ns.title.endsWith(name) || ns.title === name)
        if (existing) return existing.id
      } catch {
        /* ignore */
      }
    }
    throw err
  }
}

/**
 * マイグレーション SQL ファイルを全件適用（ファイル名順）
 */
export async function runMigrations(cwd: string, databaseName: string, files: string[]): Promise<void> {
  for (const file of files) {
    info(`適用中: ${file}`)
    await run('npx', ['wrangler', 'd1', 'execute', databaseName, '--remote', '--file', file], { cwd })
  }
}

/**
 * wrangler secret put を stdin 入力で実行
 */
export async function putSecret(cwd: string, key: string, value: string): Promise<void> {
  await run('npx', ['wrangler', 'secret', 'put', key], {
    cwd,
    input: value,
  })
}
