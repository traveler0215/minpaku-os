import { execa, type Options as ExecaOptions } from 'execa'
import chalk from 'chalk'
import ora, { type Ora } from 'ora'

export function header(text: string): void {
  console.log()
  console.log(chalk.bold.hex('#06C755')('━━━ ' + text + ' ━━━'))
}

export function info(text: string): void {
  console.log(chalk.dim('  ' + text))
}

export function success(text: string): void {
  console.log(chalk.green('  ✓ ') + text)
}

export function warn(text: string): void {
  console.log(chalk.yellow('  ⚠ ') + text)
}

export function fail(text: string): void {
  console.log(chalk.red('  ✗ ') + text)
}

export function startSpinner(text: string): Ora {
  return ora({ text, color: 'green' }).start()
}

/**
 * 子プロセスを実行。stdout/stderr は黙殺し、エラー時だけまとめて throw。
 */
export async function run(
  command: string,
  args: string[],
  options: ExecaOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const result = await execa(command, args, {
    stdio: 'pipe',
    ...options,
  })
  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? ''),
    stderr: typeof result.stderr === 'string' ? result.stderr : String(result.stderr ?? ''),
  }
}

/**
 * 対話モードで子プロセスを実行（ブラウザログイン等で必要）
 */
export async function runInteractive(
  command: string,
  args: string[],
  options: ExecaOptions = {},
): Promise<void> {
  await execa(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

/**
 * wrangler の出力から UUID 形式の ID を抽出
 */
export function extractUuid(output: string): string | null {
  const match = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return match ? match[0] : null
}

/**
 * wrangler d1 create の出力から database_id を抽出
 */
export function extractD1Id(output: string): string | null {
  // 例: database_id = "e30c1827-a8f5-4d45-8dd5-625abf3ec385"
  const match = output.match(/database_id\s*=\s*"([0-9a-f-]+)"/i)
  if (match) return match[1]
  return extractUuid(output)
}

/**
 * wrangler kv namespace create の出力から id を抽出（32桁の hex 文字列）
 */
export function extractKvId(output: string): string | null {
  // 例: id = "241afecb3a344700a2489c0ab0c8d541"
  const match = output.match(/id\s*=\s*"([0-9a-f]{32})"/i)
  if (match) return match[1]
  const hex = output.match(/[0-9a-f]{32}/i)
  return hex ? hex[0] : null
}

/**
 * wrangler deploy / pages deploy の出力から https URL を抽出
 */
export function extractHttpsUrl(output: string, hint?: 'workers.dev' | 'pages.dev'): string | null {
  const matches = output.match(/https:\/\/[a-zA-Z0-9.\-_/]+/g)
  if (!matches) return null
  if (hint) {
    const filtered = matches.find((u) => u.includes(hint))
    if (filtered) return filtered.replace(/[\s)].*$/, '')
  }
  return matches[0].replace(/[\s)].*$/, '')
}

export function randomHex(bytes: number = 32): string {
  const chars = '0123456789abcdef'
  let result = ''
  for (let i = 0; i < bytes * 2; i++) {
    result += chars[Math.floor(Math.random() * 16)]
  }
  return result
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
