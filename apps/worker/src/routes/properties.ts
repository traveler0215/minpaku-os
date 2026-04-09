import { syncPropertyIcal } from '../lib/ical'
import type { ApiResponse, Env, Property } from '../types'

interface PropertyInput {
  name?: string
  address?: string
  checkin_time?: string
  checkout_time?: string
  airbnb_ical_url?: string | null
  booking_ical_url?: string | null
  lock_adapter?: Property['lock_adapter']
  lock_config_json?: string | null
  annual_day_limit?: number
}

export async function propertyRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url

  if (pathname === '/api/properties') {
    if (request.method === 'GET') return handleListProperties(env)
    if (request.method === 'POST') return handleCreateProperty(request, env)
    return jsonError('Method Not Allowed', 405)
  }

  if (pathname.endsWith('/sync-ical') && pathname.startsWith('/api/properties/')) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    const propertyId = pathname.slice('/api/properties/'.length, -'/sync-ical'.length)
    return handleSyncIcal(env, propertyId)
  }

  if (pathname.endsWith('/sync-logs') && pathname.startsWith('/api/properties/')) {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    const propertyId = pathname.slice('/api/properties/'.length, -'/sync-logs'.length)
    return handleGetSyncLogs(env, propertyId)
  }

  const propertyId = getIdFromPath(pathname, '/api/properties/')
  if (propertyId) {
    if (request.method === 'GET') return handleGetProperty(env, propertyId)
    if (request.method === 'PATCH') return handlePatchProperty(request, env, propertyId)
    if (request.method === 'DELETE') return handleDeleteProperty(env, propertyId)
    return jsonError('Method Not Allowed', 405)
  }

  return jsonError('Not Found', 404)
}

async function handleListProperties(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT * FROM properties ORDER BY name ASC').all<Property>()
  return jsonOk(rows.results)
}

async function handleGetProperty(env: Env, propertyId: string): Promise<Response> {
  const property = await env.DB
    .prepare('SELECT * FROM properties WHERE id = ?')
    .bind(propertyId)
    .first<Property>()

  if (!property) return jsonError('物件が見つかりません', 404)
  return jsonOk(property)
}

async function handleCreateProperty(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<PropertyInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const validated = validatePropertyInput(payload, false)
  if (!validated.ok) return jsonError(validated.error, 400)

  const propertyId = generateId()

  await env.DB
    .prepare(`
      INSERT INTO properties (
        id, name, address, checkin_time, checkout_time,
        airbnb_ical_url, booking_ical_url,
        lock_adapter, lock_config_json, annual_day_limit,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)
    .bind(
      propertyId,
      validated.value.name,
      validated.value.address,
      validated.value.checkin_time,
      validated.value.checkout_time,
      validated.value.airbnb_ical_url,
      validated.value.booking_ical_url,
      validated.value.lock_adapter,
      validated.value.lock_config_json,
      validated.value.annual_day_limit
    )
    .run()

  const property = await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(propertyId).first<Property>()

  return jsonOk({
    id: propertyId,
    property,
  })
}

async function handlePatchProperty(request: Request, env: Env, propertyId: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(propertyId).first<Property>()
  if (!existing) return jsonError('物件が見つかりません', 404)

  const payload = await safeJson<PropertyInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const validated = validatePropertyInput(payload, true, existing)
  if (!validated.ok) return jsonError(validated.error, 400)

  await env.DB
    .prepare(`
      UPDATE properties
      SET name = ?, address = ?, checkin_time = ?, checkout_time = ?,
          airbnb_ical_url = ?, booking_ical_url = ?,
          lock_adapter = ?, lock_config_json = ?, annual_day_limit = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(
      validated.value.name,
      validated.value.address,
      validated.value.checkin_time,
      validated.value.checkout_time,
      validated.value.airbnb_ical_url,
      validated.value.booking_ical_url,
      validated.value.lock_adapter,
      validated.value.lock_config_json,
      validated.value.annual_day_limit,
      propertyId
    )
    .run()

  const updated = await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(propertyId).first<Property>()
  return jsonOk(updated)
}

async function handleDeleteProperty(env: Env, propertyId: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(propertyId).first<{ id: string }>()
  if (!existing) return jsonError('物件が見つかりません', 404)

  const activeReservation = await env.DB
    .prepare(`SELECT id FROM reservations WHERE property_id = ? AND status NOT IN ('cancelled', 'blocked') LIMIT 1`)
    .bind(propertyId)
    .first<{ id: string }>()
  if (activeReservation) {
    return jsonError('有効な予約が存在するため削除できません。先に予約をキャンセルしてください。', 409)
  }

  await env.DB.prepare('DELETE FROM properties WHERE id = ?').bind(propertyId).run()
  return jsonOk({ id: propertyId, deleted: true })
}

async function handleSyncIcal(env: Env, propertyId: string): Promise<Response> {
  const property = await env.DB
    .prepare(`
      SELECT id, airbnb_ical_url, booking_ical_url
      FROM properties
      WHERE id = ?
    `)
    .bind(propertyId)
    .first<{ id: string; airbnb_ical_url: string | null; booking_ical_url: string | null }>()

  if (!property) return jsonError('物件が見つかりません', 404)

  const syncTargets: Array<{ platform: 'airbnb' | 'booking'; url: string }> = []
  if (property.airbnb_ical_url) syncTargets.push({ platform: 'airbnb', url: property.airbnb_ical_url })
  if (property.booking_ical_url) syncTargets.push({ platform: 'booking', url: property.booking_ical_url })
  if (syncTargets.length === 0) return jsonError('iCal URL が設定されていません', 400)

  const results: Array<Record<string, unknown>> = []

  for (const target of syncTargets) {
    try {
      const result = await syncPropertyIcal(env.DB, propertyId, target.url, target.platform)
      await env.DB
        .prepare(`
          INSERT INTO ical_sync_logs (property_id, platform, status, added_count, updated_count, cancelled_count)
          VALUES (?, ?, 'success', ?, ?, ?)
        `)
        .bind(propertyId, target.platform, result.added, result.updated, result.cancelled)
        .run()

      results.push({ platform: target.platform, status: 'success', ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await env.DB
        .prepare(`
          INSERT INTO ical_sync_logs (property_id, platform, status, error_message)
          VALUES (?, ?, 'error', ?)
        `)
        .bind(propertyId, target.platform, message)
        .run()

      results.push({ platform: target.platform, status: 'error', error: message })
    }
  }

  return jsonOk(results)
}

async function handleGetSyncLogs(env: Env, propertyId: string): Promise<Response> {
  const property = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(propertyId).first<{ id: string }>()
  if (!property) return jsonError('物件が見つかりません', 404)

  const logs = await env.DB
    .prepare(`
      SELECT *
      FROM ical_sync_logs
      WHERE property_id = ?
      ORDER BY synced_at DESC
      LIMIT 50
    `)
    .bind(propertyId)
    .all()

  return jsonOk(logs.results)
}

function validatePropertyInput(
  input: PropertyInput,
  partial: boolean,
  existing?: Property
): { ok: true; value: Required<PropertyInput> } | { ok: false; error: string } {
  const value: Required<PropertyInput> = {
    name: normalizeString(input.name) ?? existing?.name ?? '',
    address: normalizeString(input.address) ?? existing?.address ?? '',
    checkin_time: normalizeString(input.checkin_time) ?? existing?.checkin_time ?? '15:00',
    checkout_time: normalizeString(input.checkout_time) ?? existing?.checkout_time ?? '11:00',
    airbnb_ical_url: normalizeNullable(input.airbnb_ical_url, existing?.airbnb_ical_url ?? null),
    booking_ical_url: normalizeNullable(input.booking_ical_url, existing?.booking_ical_url ?? null),
    lock_adapter: input.lock_adapter ?? existing?.lock_adapter ?? 'manual',
    lock_config_json: normalizeNullable(input.lock_config_json, existing?.lock_config_json ?? null),
    annual_day_limit: typeof input.annual_day_limit === 'number' ? input.annual_day_limit : existing?.annual_day_limit ?? 180,
  }

  if ((!partial || input.name !== undefined) && !value.name) return { ok: false, error: 'name は必須です' }
  if ((!partial || input.address !== undefined) && !value.address) return { ok: false, error: 'address は必須です' }
  if (!isTime(value.checkin_time)) return { ok: false, error: 'checkin_time の形式が不正です' }
  if (!isTime(value.checkout_time)) return { ok: false, error: 'checkout_time の形式が不正です' }
  if (!Number.isInteger(value.annual_day_limit) || value.annual_day_limit <= 0) {
    return { ok: false, error: 'annual_day_limit は1以上の整数で指定してください' }
  }

  return { ok: true, value }
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

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeNullable(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback
  if (value === null) return null
  return normalizeString(value) ?? null
}

function isTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value)
}

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
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
