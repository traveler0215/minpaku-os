import { getTenantContext } from '../lib/auth'
import type { ApiResponse, Env, StaffAutoMessage } from '../types'

const VALID_ROLES = ['cleaner', 'checkin', 'manager'] as const
const VALID_EVENTS = ['shift_accept', 'shift_complete', 'shift_decline'] as const

type Role = (typeof VALID_ROLES)[number]
type EventType = (typeof VALID_EVENTS)[number]

interface PatchInput {
  role?: string
  event_type?: string
  body_text?: string
}

export async function staffAutoMessageRoutes(request: Request, env: Env): Promise<Response> {
  const ctx = await getTenantContext(request, env)
  if (!ctx) return jsonError('Unauthorized', 401)
  const tenantId = ctx.tenant_id

  const url = new URL(request.url)
  if (url.pathname !== '/api/staff-auto-messages') {
    return jsonError('Not Found', 404)
  }

  if (request.method === 'GET') return handleList(env, tenantId)
  if (request.method === 'PATCH') return handlePatch(request, env, tenantId)
  return jsonError('Method Not Allowed', 405)
}

async function handleList(env: Env, tenantId: string): Promise<Response> {
  const rows = await env.DB
    .prepare('SELECT role, event_type, body_text, updated_at FROM staff_auto_messages WHERE tenant_id = ? ORDER BY role, event_type')
    .bind(tenantId)
    .all<StaffAutoMessage>()
  return jsonOk(rows.results)
}

async function handlePatch(request: Request, env: Env, tenantId: string): Promise<Response> {
  const payload = await safeJson<PatchInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const role = payload.role?.trim()
  const eventType = payload.event_type?.trim()
  const body = payload.body_text?.trim()

  if (!role || !VALID_ROLES.includes(role as Role)) {
    return jsonError('roleは cleaner/checkin/manager のいずれかです', 400)
  }
  if (!eventType || !VALID_EVENTS.includes(eventType as EventType)) {
    return jsonError('event_typeは shift_accept/shift_complete/shift_decline のいずれかです', 400)
  }
  if (!body) return jsonError('body_textは必須です', 400)
  if (body.length > 2000) return jsonError('body_textは2000文字以内です', 400)

  await env.DB
    .prepare(`
      INSERT INTO staff_auto_messages (tenant_id, role, event_type, body_text, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(tenant_id, role, event_type) DO UPDATE SET
        body_text = excluded.body_text,
        updated_at = datetime('now')
    `)
    .bind(tenantId, role, eventType, body)
    .run()

  const updated = await env.DB
    .prepare('SELECT role, event_type, body_text, updated_at FROM staff_auto_messages WHERE tenant_id = ? AND role = ? AND event_type = ?')
    .bind(tenantId, role, eventType)
    .first<StaffAutoMessage>()

  return jsonOk(updated)
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
