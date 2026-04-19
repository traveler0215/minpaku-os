import { getTenantContext, verifyJwt } from '../lib/auth'
import type { AdminUser, ApiResponse, Env } from '../types'

interface AdminUserCreateInput {
  email?: string
  name?: string
  role?: AdminUser['role']
}

interface AdminUserPatchInput {
  name?: string
  role?: AdminUser['role']
  is_active?: number
}

const ADMIN_ROLES: AdminUser['role'][] = ['owner', 'manager', 'viewer']

export async function adminUserRoutes(request: Request, env: Env): Promise<Response> {
  const ctx = await getTenantContext(request, env)
  if (!ctx) return jsonError('Unauthorized', 401)
  const tenantId = ctx.tenant_id

  const url = new URL(request.url)
  const { pathname } = url

  if (pathname === '/api/admin-users') {
    if (request.method === 'GET') return handleListAdminUsers(env, tenantId)
    if (request.method === 'POST') return handleCreateAdminUser(request, env, tenantId)
    return jsonError('Method Not Allowed', 405)
  }

  const adminUserId = getIdFromPath(pathname, '/api/admin-users/')
  if (adminUserId) {
    if (request.method === 'PATCH') return handlePatchAdminUser(request, env, tenantId, adminUserId)
    if (request.method === 'DELETE') return handleDeleteAdminUser(request, env, tenantId, adminUserId)
    return jsonError('Method Not Allowed', 405)
  }

  return jsonError('Not Found', 404)
}

async function handleListAdminUsers(env: Env, tenantId: string): Promise<Response> {
  const rows = await env.DB
    .prepare(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      WHERE tenant_id = ?
      ORDER BY is_active DESC, created_at ASC, email ASC
    `)
    .bind(tenantId)
    .all<AdminUser>()

  return jsonOk(rows.results)
}

async function handleCreateAdminUser(request: Request, env: Env, tenantId: string): Promise<Response> {
  const payload = await safeJson<AdminUserCreateInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const email = payload.email?.trim().toLowerCase()
  const name = payload.name?.trim()
  const role = payload.role ?? 'viewer'

  if (!email || !isValidEmail(email)) return jsonError('有効なメールアドレスを指定してください', 400)
  if (!name) return jsonError('name は必須です', 400)
  if (!ADMIN_ROLES.includes(role)) return jsonError('role が不正です', 400)

  const existing = await env.DB
    .prepare('SELECT id FROM admin_users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()

  if (existing) return jsonError('このメールアドレスは既に登録されています', 409)

  await env.DB
    .prepare(`
      INSERT INTO admin_users (tenant_id, email, name, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `)
    .bind(tenantId, email, name, role)
    .run()

  const created = await env.DB
    .prepare(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      WHERE email = ? AND tenant_id = ?
    `)
    .bind(email, tenantId)
    .first<AdminUser>()

  // ワンタイム招待トークンを生成
  const inviteToken = crypto.randomUUID()
  await env.KV.put(
    `invite:${inviteToken}`,
    JSON.stringify({ user_id: created?.id, email, tenant_id: tenantId }),
    { expirationTtl: 86400 },
  )

  return jsonOk({ user: created, invite_token: inviteToken })
}

async function handlePatchAdminUser(request: Request, env: Env, tenantId: string, adminUserId: string): Promise<Response> {
  const existing = await env.DB
    .prepare(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(adminUserId, tenantId)
    .first<AdminUser>()

  if (!existing) return jsonError('管理ユーザーが見つかりません', 404)

  const payload = await safeJson<AdminUserPatchInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const name = payload.name !== undefined ? payload.name.trim() : existing.name
  const role = payload.role ?? existing.role
  const isActive = payload.is_active ?? existing.is_active

  if (!name) return jsonError('name は空にできません', 400)
  if (!ADMIN_ROLES.includes(role)) return jsonError('role が不正です', 400)
  if (isActive !== 0 && isActive !== 1) return jsonError('is_active は 0 または 1 です', 400)

  await env.DB
    .prepare(`
      UPDATE admin_users
      SET name = ?, role = ?, is_active = ?
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(name, role, isActive, adminUserId, tenantId)
    .run()

  const updated = await env.DB
    .prepare(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(adminUserId, tenantId)
    .first<AdminUser>()

  return jsonOk(updated)
}

async function handleDeleteAdminUser(request: Request, env: Env, tenantId: string, adminUserId: string): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT id, email FROM admin_users WHERE id = ? AND tenant_id = ?')
    .bind(adminUserId, tenantId)
    .first<{ id: string; email: string }>()

  if (!existing) return jsonError('管理ユーザーが見つかりません', 404)

  const currentUser = await getCurrentAdminUser(request, env, tenantId)
  if (!currentUser) return jsonError('Unauthorized', 401)
  if (currentUser.email === existing.email) return jsonError('自分自身は削除できません', 403)

  await env.DB.prepare('DELETE FROM admin_users WHERE id = ? AND tenant_id = ?').bind(adminUserId, tenantId).run()

  return jsonOk({ id: adminUserId, deleted: true })
}

async function getCurrentAdminUser(request: Request, env: Env, tenantId: string): Promise<AdminUser | null> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null

  const payload = await verifyJwt(auth.slice(7), env.ADMIN_JWT_SECRET)
  if (!payload?.email) return null

  return env.DB
    .prepare(`
      SELECT id, email, name, role, is_active, last_login, created_at
      FROM admin_users
      WHERE email = ? AND tenant_id = ?
    `)
    .bind(payload.email, tenantId)
    .first<AdminUser>()
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function getIdFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  return rest && !rest.includes('/') ? rest : null
}

async function safeJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
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
