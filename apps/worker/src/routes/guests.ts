import type { ApiResponse, Env, GuestRegistryEntry, Reservation } from '../types'

interface GuestCreateInput {
  guest_name?: string
  nationality?: string | null
  passport_number?: string | null
  address?: string | null
  occupation?: string | null
}

interface GuestRow {
  id: string
  reservation_id: string
  full_name: string
  nationality: string | null
  passport_number: string | null
  address: string | null
  created_at: string
}

export async function guestRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url

  if (pathname.endsWith('/guests') && pathname.startsWith('/api/reservations/')) {
    const reservationId = pathname.slice('/api/reservations/'.length, -'/guests'.length)
    if (!reservationId || reservationId.includes('/')) return jsonError('Not Found', 404)
    if (request.method === 'GET') return handleListGuests(env, reservationId)
    if (request.method === 'POST') return handleCreateGuest(request, env, reservationId)
    return jsonError('Method Not Allowed', 405)
  }

  if (pathname.startsWith('/api/guests/')) {
    const guestId = pathname.slice('/api/guests/'.length)
    if (!guestId || guestId.includes('/')) return jsonError('Not Found', 404)
    if (request.method === 'DELETE') return handleDeleteGuest(env, guestId)
    return jsonError('Method Not Allowed', 405)
  }

  return jsonError('Not Found', 404)
}

async function handleListGuests(env: Env, reservationId: string): Promise<Response> {
  const reservation = await env.DB
    .prepare('SELECT id FROM reservations WHERE id = ?')
    .bind(reservationId)
    .first<{ id: string }>()

  if (!reservation) return jsonError('予約が見つかりません', 404)

  const rows = await env.DB
    .prepare(`
      SELECT id, reservation_id, full_name, nationality, passport_number, address, created_at
      FROM guest_registry
      WHERE reservation_id = ?
      ORDER BY created_at ASC, id ASC
    `)
    .bind(reservationId)
    .all<GuestRow>()

  return jsonOk(rows.results.map(toGuestEntry))
}

async function handleCreateGuest(request: Request, env: Env, reservationId: string): Promise<Response> {
  const reservation = await env.DB
    .prepare('SELECT id, checkin_date, checkout_date FROM reservations WHERE id = ?')
    .bind(reservationId)
    .first<Pick<Reservation, 'id' | 'checkin_date' | 'checkout_date'>>()

  if (!reservation) return jsonError('予約が見つかりません', 404)

  const payload = await safeJson<GuestCreateInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const guestName = payload.guest_name?.trim()
  const nationality = normalizeNullable(payload.nationality)
  const passportNumber = normalizeNullable(payload.passport_number)
  const address = normalizeNullable(payload.address)
  const occupation = normalizeNullable(payload.occupation)

  if (!guestName) return jsonError('guest_name は必須です', 400)

  const created = await env.DB
    .prepare(`
      INSERT INTO guest_registry (
        reservation_id, full_name, nationality, passport_number, address, checkin_date, checkout_date
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id, reservation_id, full_name, nationality, passport_number, address, created_at
    `)
    .bind(
      reservationId,
      guestName,
      nationality,
      passportNumber,
      address,
      reservation.checkin_date,
      reservation.checkout_date
    )
    .first<GuestRow>()

  return jsonOk(toGuestEntry(created))
}

async function handleDeleteGuest(env: Env, guestId: string): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT id FROM guest_registry WHERE id = ?')
    .bind(guestId)
    .first<{ id: string }>()

  if (!existing) return jsonError('宿泊者が見つかりません', 404)

  await env.DB.prepare('DELETE FROM guest_registry WHERE id = ?').bind(guestId).run()
  return jsonOk({ id: guestId, deleted: true })
}

function toGuestEntry(row: GuestRow | null): GuestRegistryEntry | null {
  if (!row) return null

  return {
    id: row.id,
    reservation_id: row.reservation_id,
    guest_name: row.full_name,
    nationality: row.nationality ?? null,
    passport_number: row.passport_number ?? null,
    address: row.address ?? null,
    occupation: null,
    created_at: row.created_at,
  }
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
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
