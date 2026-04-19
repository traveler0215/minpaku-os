import type { ApiResponse, Env, Reservation } from '../types'

interface OccupancyMonthly {
  month: string
  occupied_days: number
  total_days: number
  rate: number
}

export async function analyticsRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname, searchParams } = url

  if (pathname === '/api/analytics/occupancy') {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    return handleOccupancy(env, searchParams)
  }

  return jsonError('Not Found', 404)
}

async function handleOccupancy(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const propertyId = searchParams.get('property_id')?.trim()
  const from = searchParams.get('from')?.trim()
  const to = searchParams.get('to')?.trim()

  if (!propertyId || !from || !to) {
    return jsonError('property_id, from, to は必須です', 400)
  }
  if (!isDate(from) || !isDate(to)) {
    return jsonError('from, to は YYYY-MM-DD 形式で指定してください', 400)
  }
  if (from > to) return jsonError('from は to 以下で指定してください', 400)

  const property = await env.DB
    .prepare('SELECT id, name FROM properties WHERE id = ?')
    .bind(propertyId)
    .first<{ id: string; name: string }>()
  if (!property) return jsonError('物件が見つかりません', 404)

  const rows = await env.DB
    .prepare(`
      SELECT id, property_id, platform, external_id, guest_name, guest_email, guest_count, checkin_date, checkout_date,
             checkin_time, checkout_time, gross_amount, net_amount, ota_fee_amount, status, notes, raw_ical_data,
             created_at, updated_at
      FROM reservations
      WHERE property_id = ?
        AND status IN ('confirmed', 'completed')
        AND checkin_date <= ?
        AND checkout_date > ?
      ORDER BY checkin_date ASC
    `)
    .bind(propertyId, to, from)
    .all<Reservation>()

  const monthly = buildMonthlyOccupancy(rows.results, from, to)
  const totalDays = diffDaysInclusive(from, to)
  const occupiedDays = monthly.reduce((sum, item) => sum + item.occupied_days, 0)

  return jsonOk({
    property_id: property.id,
    property_name: property.name,
    period: {
      from,
      to,
      total_days: totalDays,
    },
    occupied_days: occupiedDays,
    occupancy_rate: calcRate(occupiedDays, totalDays),
    monthly,
  })
}

function buildMonthlyOccupancy(reservations: Reservation[], from: string, to: string): OccupancyMonthly[] {
  const result: OccupancyMonthly[] = []
  const current = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)

  current.setUTCDate(1)
  while (current <= end) {
    const monthStart = current.toISOString().slice(0, 10)
    const monthKey = monthStart.slice(0, 7)
    const monthEndDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0))
    const monthEnd = monthEndDate.toISOString().slice(0, 10)
    const segmentStart = monthStart < from ? from : monthStart
    const segmentEnd = monthEnd > to ? to : monthEnd
    const occupiedDays = buildOccupiedDateSet(reservations, segmentStart, segmentEnd).size
    const totalDays = diffDaysInclusive(segmentStart, segmentEnd)

    result.push({
      month: monthKey,
      occupied_days: occupiedDays,
      total_days: totalDays,
      rate: calcRate(occupiedDays, totalDays),
    })

    current.setUTCMonth(current.getUTCMonth() + 1)
  }

  return result
}

function buildOccupiedDateSet(reservations: Reservation[], from: string, to: string): Set<string> {
  const occupied = new Set<string>()

  for (const reservation of reservations) {
    const start = reservation.checkin_date > from ? reservation.checkin_date : from
    const checkoutExclusive = reservation.checkout_date
    const lastNight = addDays(checkoutExclusive, -1)
    const end = lastNight < to ? lastNight : to
    if (start > end) continue

    for (let date = start; date <= end; date = addDays(date, 1)) {
      occupied.add(date)
    }
  }

  return occupied
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function diffDaysInclusive(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function calcRate(occupiedDays: number, totalDays: number): number {
  if (totalDays <= 0) return 0
  return Math.round((occupiedDays / totalDays) * 1000) / 10
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
