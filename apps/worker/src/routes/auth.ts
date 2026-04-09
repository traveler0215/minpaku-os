import { generateJwt, storeMagicCode, verifyJwt, verifyMagicCode } from '../lib/auth'
import type { AdminUser, ApiResponse, Env } from '../types'

interface LoginInput {
  email?: string
}

interface VerifyInput {
  email?: string
  code?: string
}

type PublicAdminUser = Pick<AdminUser, 'id' | 'email' | 'name' | 'role' | 'is_active' | 'last_login' | 'created_at'>

export async function authRoutes(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (pathname === '/api/auth/login') {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    return handleLogin(request, env)
  }

  if (pathname === '/api/auth/verify') {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    return handleVerify(request, env)
  }

  if (pathname === '/api/auth/me') {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    return handleMe(request, env)
  }

  if (pathname.startsWith('/api/auth/invite/')) {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    const token = pathname.slice('/api/auth/invite/'.length)
    return handleInvite(env, token)
  }

  return jsonError('Not Found', 404)
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<LoginInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const email = payload.email?.trim().toLowerCase()
  if (!email || !isEmail(email)) {
    return jsonError('有効なメールアドレスを指定してください', 400)
  }

  const adminUser = await env.DB
    .prepare(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      WHERE email = ?
      LIMIT 1
    `)
    .bind(email)
    .first<PublicAdminUser>()

  if (!adminUser || adminUser.is_active !== 1) {
    return jsonError('有効な管理ユーザーが見つかりません', 404)
  }

  const code = generateMagicCode()
  await storeMagicCode(email, code, env.KV)

  return jsonOk({
    email,
    code,
    expires_in_sec: 600,
  })
}

async function handleVerify(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<VerifyInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const email = payload.email?.trim().toLowerCase()
  const code = payload.code?.trim()

  if (!email || !isEmail(email)) {
    return jsonError('有効なメールアドレスを指定してください', 400)
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return jsonError('code は6桁で指定してください', 400)
  }

  const isValid = await verifyMagicCode(email, code, env.KV)
  if (!isValid) {
    return jsonError('コードが正しくないか、有効期限が切れています', 401)
  }

  const adminUser = await env.DB
    .prepare(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      WHERE email = ?
      LIMIT 1
    `)
    .bind(email)
    .first<PublicAdminUser>()

  if (!adminUser || adminUser.is_active !== 1) {
    return jsonError('有効な管理ユーザーが見つかりません', 404)
  }

  await env.DB
    .prepare(`
      UPDATE admin_users
      SET last_login = datetime('now')
      WHERE id = ?
    `)
    .bind(adminUser.id)
    .run()

  const token = await generateJwt(
    { email: adminUser.email, role: adminUser.role, name: adminUser.name },
    env.ADMIN_JWT_SECRET
  )

  const refreshedUser = await env.DB
    .prepare(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      WHERE id = ?
      LIMIT 1
    `)
    .bind(adminUser.id)
    .first<PublicAdminUser>()

  return jsonOk({
    token,
    user: refreshedUser,
  })
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return jsonError('Unauthorized', 401)
  }

  const token = auth.slice(7)
  const payload = await verifyJwt(token, env.ADMIN_JWT_SECRET)
  if (!payload) {
    return jsonError('Unauthorized', 401)
  }

  const adminUser = await env.DB
    .prepare(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      WHERE email = ?
      LIMIT 1
    `)
    .bind(payload.email)
    .first<PublicAdminUser>()

  if (!adminUser || adminUser.is_active !== 1) {
    return jsonError('Unauthorized', 401)
  }

  return jsonOk(adminUser)
}

async function handleInvite(env: Env, inviteToken: string): Promise<Response> {
  if (!inviteToken) return jsonError('トークンが不正です', 400)

  const raw = await env.KV.get(`invite:${inviteToken}`)
  if (!raw) return jsonError('この招待リンクは無効または期限切れです', 404)

  const { user_id, email } = JSON.parse(raw) as { user_id: string; email: string }

  const adminUser = await env.DB
    .prepare('SELECT id, email, name, role, is_active, last_login, created_at FROM admin_users WHERE id = ? AND is_active = 1')
    .bind(user_id)
    .first<PublicAdminUser>()

  if (!adminUser) return jsonError('ユーザーが見つかりません', 404)

  await env.KV.delete(`invite:${inviteToken}`)

  await env.DB.prepare('UPDATE admin_users SET last_login = datetime(\'now\') WHERE id = ?').bind(user_id).run()

  const jwt = await generateJwt(
    { email: adminUser.email, role: adminUser.role, name: adminUser.name },
    env.ADMIN_JWT_SECRET,
  )

  const refreshedUser = await env.DB
    .prepare('SELECT id, email, name, role, is_active, last_login, created_at FROM admin_users WHERE id = ?')
    .bind(user_id)
    .first<PublicAdminUser>()

  return jsonOk({ token: jwt, user: refreshedUser })
}

async function safeJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

function generateMagicCode(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000
  return random.toString().padStart(6, '0')
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function jsonOk<T>(data: T): Response {
  const body: ApiResponse<T> = { success: true, data }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jsonError(error: string, status: number): Response {
  const body: ApiResponse<never> = { success: false, error }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
