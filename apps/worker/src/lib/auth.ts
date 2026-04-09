/**
 * 管理画面 JWT 認証
 * Cloudflare Access と組み合わせてメール OTP ログインを実現する
 */

import type { Env, AdminUser } from '../types'

/**
 * Authorization ヘッダーのトークンを検証し、
 * 問題があれば 401 Response を返す
 */
export async function verifyAdminToken(
  request: Request,
  env: Env
): Promise<Response | null> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const token = auth.slice(7)
  try {
    const payload = await verifyJwt(token, env.ADMIN_JWT_SECRET)
    if (!payload) throw new Error('invalid')
    // リクエストに user 情報を付加（Workers では request は immutable なので KV を使う）
    await env.KV.put(`session:${token}`, JSON.stringify(payload), { expirationTtl: 3600 })
    return null
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/**
 * JWT 生成（ログイン時）
 */
export async function generateJwt(
  payload: { email: string; role: string; name: string },
  secret: string,
  expiresInSec = 86400  // 24時間
): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const exp = Math.floor(Date.now() / 1000) + expiresInSec
  const body = base64url(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now() / 1000) }))
  const sig = await hmacSign(`${header}.${body}`, secret)
  return `${header}.${body}.${sig}`
}

/**
 * JWT 検証
 */
export async function verifyJwt(
  token: string,
  secret: string
): Promise<{ email: string; role: string; name: string; exp: number } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, body, signature] = parts
  const expected = await hmacSign(`${header}.${body}`, secret)
  if (expected !== signature) return null

  const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

/**
 * マジックリンク用ワンタイムコードを KV に保存（10分有効）
 */
export async function storeMagicCode(
  email: string,
  code: string,
  kv: KVNamespace
): Promise<void> {
  await kv.put(`magic:${email}`, code, { expirationTtl: 600 })
}

/**
 * マジックコードを検証し消費する
 */
export async function verifyMagicCode(
  email: string,
  code: string,
  kv: KVNamespace
): Promise<boolean> {
  const stored = await kv.get(`magic:${email}`)
  if (!stored || stored !== code) return false
  await kv.delete(`magic:${email}`)
  return true
}

// ─── 内部ユーティリティ ──────────────────────────────────

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return base64url(new Uint8Array(sig))
}

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
