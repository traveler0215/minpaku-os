import { getTenantContext } from '../lib/auth'
import type { ApiResponse, Env, Reservation } from '../types'

type ReservationListRow = Reservation

interface ReservationCreateInput {
  property_id?: string
  platform?: Reservation['platform']
  external_id?: string | null
  guest_name?: string | null
  guest_email?: string | null
  guest_count?: number
  checkin_date?: string
  checkout_date?: string
  checkin_time?: string | null
  checkout_time?: string | null
  gross_amount?: number | null
  net_amount?: number | null
  ota_fee_amount?: number | null
  status?: Reservation['status']
  notes?: string | null
  raw_ical_data?: string | null
}

type ReservationPatchInput = Partial<ReservationCreateInput>

interface DoubleBookingRow {
  id: string
  property_id: string
  guest_name: string | null
  checkin_date: string
  checkout_date: string
  status: string
}

export async function reservationRoutes(request: Request, env: Env): Promise<Response> {
  const ctx = await getTenantContext(request, env)
  if (!ctx) return jsonError('Unauthorized', 401)
  const tenantId = ctx.tenant_id

  const url = new URL(request.url)
  const { pathname, searchParams } = url
  const reservationId = getIdFromPath(pathname, '/api/reservations/')

  if (pathname.startsWith('/api/reservations/180days/')) {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    const propertyId = pathname.slice('/api/reservations/180days/'.length)
    return handleGetAnnualDays(env, tenantId, propertyId, searchParams.get('year'))
  }

  if (pathname === '/api/reservations') {
    if (request.method === 'GET') return handleListReservations(env, tenantId, searchParams)
    if (request.method === 'POST') return handleCreateReservation(request, env, tenantId)
    return jsonError('Method Not Allowed', 405)
  }

  if (reservationId) {
    if (request.method === 'GET') return handleGetReservation(env, tenantId, reservationId)
    if (request.method === 'PATCH') return handlePatchReservation(request, env, tenantId, reservationId)
    if (request.method === 'DELETE') return handleDeleteReservation(env, tenantId, reservationId)
    return jsonError('Method Not Allowed', 405)
  }

  return jsonError('Not Found', 404)
}

async function handleListReservations(env: Env, tenantId: string, searchParams: URLSearchParams): Promise<Response> {
  const propertyId = searchParams.get('property_id')?.trim()
  const month = searchParams.get('month')?.trim()
  const status = searchParams.get('status')?.trim()

  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return jsonError('month は YYYY-MM 形式で指定してください', 400)
  }

  const conditions: string[] = ['tenant_id = ?']
  const bindings: Array<string | number> = [tenantId]

  if (propertyId) {
    conditions.push('property_id = ?')
    bindings.push(propertyId)
  }
  if (month) {
    conditions.push("checkin_date < date(? || '-01', '+1 month')")
    conditions.push("checkout_date > date(? || '-01')")
    bindings.push(month, month)
  }
  if (status) {
    conditions.push('status = ?')
    bindings.push(status)
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const rows = await env.DB
    .prepare(`
      SELECT *
      FROM reservations
      ${where}
      ORDER BY checkin_date ASC, created_at DESC
    `)
    .bind(...bindings)
    .all<ReservationListRow>()

  return jsonOk(rows.results)
}

async function handleGetReservation(env: Env, tenantId: string, id: string): Promise<Response> {
  const reservation = await env.DB
    .prepare('SELECT * FROM reservations WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<Reservation>()

  if (!reservation) {
    return jsonError('予約が見つかりません', 404)
  }

  return jsonOk(reservation)
}

async function handleCreateReservation(request: Request, env: Env, tenantId: string): Promise<Response> {
  const payload = await safeJson<ReservationCreateInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const validated = validateReservationInput(payload, false)
  if (!validated.ok) return jsonError(validated.error, 400)

  const overlaps = await findOverlappingReservations(env, tenantId, validated.value.property_id, validated.value.checkin_date, validated.value.checkout_date)
  if (overlaps.length > 0) {
    return jsonErrorWithData('ダブルブッキングが検知されました', 409, {
      conflicts: overlaps,
    })
  }

  const reservationId = generateId()

  await env.DB
    .prepare(`
      INSERT INTO reservations (
        id, tenant_id, property_id, platform, external_id, guest_name, guest_email, guest_count,
        checkin_date, checkout_date, checkin_time, checkout_time,
        gross_amount, net_amount, ota_fee_amount, status, notes, raw_ical_data,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)
    .bind(
      reservationId,
      tenantId,
      validated.value.property_id,
      validated.value.platform,
      validated.value.external_id,
      validated.value.guest_name,
      validated.value.guest_email,
      validated.value.guest_count,
      validated.value.checkin_date,
      validated.value.checkout_date,
      validated.value.checkin_time,
      validated.value.checkout_time,
      validated.value.gross_amount,
      validated.value.net_amount,
      validated.value.ota_fee_amount,
      validated.value.status,
      validated.value.notes,
      validated.value.raw_ical_data
    )
    .run()

  const reservation = await env.DB
    .prepare('SELECT * FROM reservations WHERE id = ? AND tenant_id = ?')
    .bind(reservationId, tenantId)
    .first<Reservation>()

  return jsonOk({
    id: reservationId,
    reservation,
  })
}

async function handlePatchReservation(request: Request, env: Env, tenantId: string, id: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT * FROM reservations WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Reservation>()
  if (!existing) return jsonError('予約が見つかりません', 404)

  const payload = await safeJson<ReservationPatchInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const validated = validateReservationInput(payload, true, existing)
  if (!validated.ok) return jsonError(validated.error, 400)

  const next = validated.value
  const datesChanged =
    next.property_id !== existing.property_id ||
    next.checkin_date !== existing.checkin_date ||
    next.checkout_date !== existing.checkout_date

  if (datesChanged) {
    const overlaps = await findOverlappingReservations(env, tenantId, next.property_id, next.checkin_date, next.checkout_date, id)
    if (overlaps.length > 0) {
      return jsonErrorWithData('ダブルブッキングが検知されました', 409, {
        conflicts: overlaps,
      })
    }
  }

  await env.DB
    .prepare(`
      UPDATE reservations
      SET property_id = ?, platform = ?, external_id = ?, guest_name = ?, guest_email = ?, guest_count = ?,
          checkin_date = ?, checkout_date = ?, checkin_time = ?, checkout_time = ?,
          gross_amount = ?, net_amount = ?, ota_fee_amount = ?, status = ?, notes = ?, raw_ical_data = ?,
          updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(
      next.property_id,
      next.platform,
      next.external_id,
      next.guest_name,
      next.guest_email,
      next.guest_count,
      next.checkin_date,
      next.checkout_date,
      next.checkin_time,
      next.checkout_time,
      next.gross_amount,
      next.net_amount,
      next.ota_fee_amount,
      next.status,
      next.notes,
      next.raw_ical_data,
      id,
      tenantId
    )
    .run()

  const updated = await env.DB.prepare('SELECT * FROM reservations WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Reservation>()
  return jsonOk(updated)
}

async function handleDeleteReservation(env: Env, tenantId: string, id: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id FROM reservations WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<{ id: string }>()
  if (!existing) return jsonError('予約が見つかりません', 404)

  await env.DB.prepare('DELETE FROM reservations WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run()
  return jsonOk({ id, deleted: true })
}

async function handleGetAnnualDays(env: Env, tenantId: string, propertyId: string, yearParam: string | null): Promise<Response> {
  if (!propertyId) return jsonError('property_id は必須です', 400)

  const year = yearParam?.trim()
  if (year && !/^\d{4}$/.test(year)) {
    return jsonError('year は YYYY 形式で指定してください', 400)
  }

  const property = await env.DB
    .prepare('SELECT id, name, annual_day_limit FROM properties WHERE id = ? AND tenant_id = ?')
    .bind(propertyId, tenantId)
    .first<{ id: string; name: string; annual_day_limit: number }>()

  if (!property) return jsonError('物件が見つかりません', 404)

  const summary = year
    ? await env.DB
        .prepare(`
          SELECT property_id, year, days_used
          FROM annual_days_used
          WHERE property_id = ? AND tenant_id = ? AND year = ?
          LIMIT 1
        `)
        .bind(propertyId, tenantId, Number.parseInt(year, 10))
        .first<{ property_id: string; year: number; days_used: number | null }>()
    : await env.DB
        .prepare(`
          SELECT property_id, year, days_used
          FROM annual_days_used
          WHERE property_id = ? AND tenant_id = ?
          ORDER BY year DESC
          LIMIT 1
        `)
        .bind(propertyId, tenantId)
        .first<{ property_id: string; year: number; days_used: number | null }>()

  const targetYear = summary?.year ?? (year ? Number.parseInt(year, 10) : new Date().getUTCFullYear())
  const daysUsed = summary?.days_used ?? 0

  return jsonOk({
    property_id: property.id,
    property_name: property.name,
    year: targetYear,
    days_used: daysUsed,
    annual_day_limit: property.annual_day_limit,
    remaining_days: Math.max(property.annual_day_limit - daysUsed, 0),
  })
}

async function findOverlappingReservations(
  env: Env,
  tenantId: string,
  propertyId: string,
  checkinDate: string,
  checkoutDate: string,
  excludeId?: string
): Promise<DoubleBookingRow[]> {
  const sql = `
    SELECT id, property_id, guest_name, checkin_date, checkout_date, status
    FROM reservations
    WHERE property_id = ?
      AND tenant_id = ?
      AND status NOT IN ('cancelled', 'blocked')
      AND checkin_date < ?
      AND checkout_date > ?
      ${excludeId ? 'AND id <> ?' : ''}
    ORDER BY checkin_date ASC
  `

  const stmt = env.DB.prepare(sql)
  const result = excludeId
    ? await stmt.bind(propertyId, tenantId, checkoutDate, checkinDate, excludeId).all<DoubleBookingRow>()
    : await stmt.bind(propertyId, tenantId, checkoutDate, checkinDate).all<DoubleBookingRow>()

  return result.results
}

function validateReservationInput(
  input: ReservationCreateInput | ReservationPatchInput,
  partial: boolean,
  existing?: Reservation
): { ok: true; value: ReservationCreateInput } | { ok: false; error: string } {
  const value: ReservationCreateInput = {
    property_id: normalizeString(input.property_id) ?? existing?.property_id,
    platform: (normalizeString(input.platform) as Reservation['platform'] | null) ?? existing?.platform,
    external_id: normalizeNullable(input.external_id, existing?.external_id ?? null),
    guest_name: normalizeNullable(input.guest_name, existing?.guest_name ?? null),
    guest_email: normalizeNullable(input.guest_email, existing?.guest_email ?? null),
    guest_count: typeof input.guest_count === 'number' ? input.guest_count : (existing?.guest_count ?? null),
    checkin_date: normalizeString(input.checkin_date) ?? existing?.checkin_date,
    checkout_date: normalizeString(input.checkout_date) ?? existing?.checkout_date,
    checkin_time: normalizeNullable(input.checkin_time, existing?.checkin_time ?? null),
    checkout_time: normalizeNullable(input.checkout_time, existing?.checkout_time ?? null),
    gross_amount: normalizeNullableNumber(input.gross_amount, existing?.gross_amount ?? null),
    net_amount: normalizeNullableNumber(input.net_amount, existing?.net_amount ?? null),
    ota_fee_amount: normalizeNullableNumber(input.ota_fee_amount, existing?.ota_fee_amount ?? null),
    status: (normalizeString(input.status) as Reservation['status'] | null) ?? existing?.status ?? 'confirmed',
    notes: normalizeNullable(input.notes, existing?.notes ?? null),
    raw_ical_data: normalizeNullable(input.raw_ical_data, existing?.raw_ical_data ?? null),
  }

  if (!partial || input.property_id !== undefined) {
    if (!value.property_id) return { ok: false, error: 'property_id は必須です' }
  }
  if (!partial || input.platform !== undefined) {
    if (!value.platform) return { ok: false, error: 'platform は必須です' }
  }
  if (!partial || input.checkin_date !== undefined) {
    if (!value.checkin_date || !isDate(value.checkin_date)) return { ok: false, error: 'checkin_date の形式が不正です' }
  }
  if (!partial || input.checkout_date !== undefined) {
    if (!value.checkout_date || !isDate(value.checkout_date)) return { ok: false, error: 'checkout_date の形式が不正です' }
  }
  if (value.checkin_date && value.checkout_date && value.checkin_date >= value.checkout_date) {
    return { ok: false, error: 'checkout_date は checkin_date より後である必要があります' }
  }
  if (value.guest_count !== undefined && value.guest_count !== null && (!Number.isInteger(value.guest_count) || value.guest_count <= 0)) {
    return { ok: false, error: 'guest_count は1以上の整数で指定してください' }
  }
  if (value.checkin_time && !isTime(value.checkin_time)) return { ok: false, error: 'checkin_time の形式が不正です' }
  if (value.checkout_time && !isTime(value.checkout_time)) return { ok: false, error: 'checkout_time の形式が不正です' }

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

function normalizeNullableNumber(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
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

function jsonErrorWithData(error: string, status: number, extra: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: false, error, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
