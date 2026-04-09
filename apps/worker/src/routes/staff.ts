import type { ApiResponse, Env, Shift, Staff } from '../types'

interface StaffPatchInput {
  name?: string
  role?: Staff['role']
  employment_type?: Staff['employment_type']
  hourly_wage?: number | null
  property_ids?: string[]
  is_active?: number
}

interface InviteInput {
  name?: string
  role?: Staff['role']
  employment_type?: Staff['employment_type']
  hourly_wage?: number | null
  wage_type?: 'hourly' | 'daily'
  property_ids?: string[]
}

const INVITE_TTL = 60 * 60 * 24

export async function staffRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname, searchParams } = url

  if (pathname === '/api/staff') {
    if (request.method === 'GET') return handleListStaff(env, searchParams)
    return jsonError('Method Not Allowed', 405)
  }

  if (pathname === '/api/staff/invite') {
    if (request.method === 'POST') return handleInviteStaff(request, env)
    return jsonError('Method Not Allowed', 405)
  }

  if (pathname.endsWith('/shifts') && pathname.startsWith('/api/staff/')) {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    const staffId = pathname.slice('/api/staff/'.length, -'/shifts'.length)
    return handleGetStaffShifts(env, staffId, searchParams)
  }

  const staffId = getIdFromPath(pathname, '/api/staff/')
  if (staffId) {
    if (request.method === 'PATCH') return handlePatchStaff(request, env, staffId)
    if (request.method === 'DELETE') return handleDeleteStaff(env, staffId)
    return jsonError('Method Not Allowed', 405)
  }

  return jsonError('Not Found', 404)
}

async function handleListStaff(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const propertyId = searchParams.get('property_id')?.trim()
  const rows = propertyId
    ? await env.DB
        .prepare(`
          SELECT s.*
          FROM staff s
          JOIN staff_properties sp ON sp.staff_id = s.id
          WHERE sp.property_id = ?
          ORDER BY s.is_active DESC, s.name ASC
        `)
        .bind(propertyId)
        .all<Staff>()
    : await env.DB
        .prepare(`
          SELECT *
          FROM staff
          ORDER BY is_active DESC, name ASC
        `)
        .all<Staff>()

  const staffWithProperties = await Promise.all(
    rows.results.map(async (staff) => ({
      ...staff,
      property_ids: await getStaffPropertyIds(env, staff.id),
    }))
  )

  return jsonOk(staffWithProperties)
}

async function handleInviteStaff(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<InviteInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const name = payload.name?.trim()
  const role = payload.role ?? 'cleaner'
  const employmentType = payload.employment_type ?? 'part_time'
  const hourlyWage = payload.hourly_wage ?? null
  const propertyIds = Array.isArray(payload.property_ids) ? payload.property_ids.map((id) => id.trim()).filter(Boolean) : []

  if (!name) return jsonError('name は必須です', 400)
  if (hourlyWage !== null && (!Number.isFinite(hourlyWage) || hourlyWage < 0)) {
    return jsonError('hourly_wage は0以上で指定してください', 400)
  }

  const code = generateInviteCode()
  const staffId = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const invite = {
    staff_id: staffId,
    name,
    role,
    employment_type: employmentType,
    hourly_wage: hourlyWage,
    property_ids: propertyIds,
  }

  await env.KV.put(`staff_invite:${code}`, JSON.stringify(invite), { expirationTtl: INVITE_TTL })

  return jsonOk({
    invite_code: code,
    expires_in_sec: INVITE_TTL,
    expires_at: new Date(Date.now() + INVITE_TTL * 1000).toISOString(),
    invite,
  })
}

async function handlePatchStaff(request: Request, env: Env, staffId: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(staffId).first<Staff>()
  if (!existing) return jsonError('スタッフが見つかりません', 404)

  const payload = await safeJson<StaffPatchInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const name = payload.name !== undefined ? payload.name.trim() : existing.name
  const role = payload.role ?? existing.role
  const employmentType = payload.employment_type ?? existing.employment_type
  const hourlyWage = payload.hourly_wage !== undefined ? payload.hourly_wage : existing.hourly_wage
  const wageType = payload.wage_type ?? existing.wage_type ?? 'hourly'
  const isActive = payload.is_active !== undefined ? payload.is_active : existing.is_active

  if (!name) return jsonError('name は空にできません', 400)
  if (hourlyWage !== null && (!Number.isFinite(hourlyWage) || hourlyWage < 0)) {
    return jsonError('hourly_wage は0以上で指定してください', 400)
  }
  if (!['hourly', 'daily'].includes(wageType)) return jsonError('wage_type は hourly または daily です', 400)
  if (![0, 1].includes(isActive)) return jsonError('is_active は 0 または 1 です', 400)

  await env.DB
    .prepare(`
      UPDATE staff
      SET name = ?, role = ?, employment_type = ?, hourly_wage = ?, wage_type = ?, is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(name, role, employmentType, hourlyWage, wageType, isActive, staffId)
    .run()

  if (payload.property_ids) {
    const propertyIds = payload.property_ids.map((id) => id.trim()).filter(Boolean)
    await env.DB.prepare('DELETE FROM staff_properties WHERE staff_id = ?').bind(staffId).run()
    for (const propertyId of propertyIds) {
      await env.DB
        .prepare('INSERT INTO staff_properties (staff_id, property_id) VALUES (?, ?)')
        .bind(staffId, propertyId)
        .run()
    }
  }

  const updated = await env.DB.prepare('SELECT * FROM staff WHERE id = ?').bind(staffId).first<Staff>()
  return jsonOk({
    ...updated,
    property_ids: await getStaffPropertyIds(env, staffId),
  })
}

async function handleDeleteStaff(env: Env, staffId: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id FROM staff WHERE id = ?').bind(staffId).first<{ id: string }>()
  if (!existing) return jsonError('スタッフが見つかりません', 404)

  await env.DB
    .prepare(`
      UPDATE staff
      SET is_active = 0, updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(staffId)
    .run()

  return jsonOk({ id: staffId, is_active: 0 })
}

async function handleGetStaffShifts(env: Env, staffId: string, searchParams: URLSearchParams): Promise<Response> {
  const staff = await env.DB.prepare('SELECT id FROM staff WHERE id = ?').bind(staffId).first<{ id: string }>()
  if (!staff) return jsonError('スタッフが見つかりません', 404)

  const week = searchParams.get('week')?.trim()
  if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return jsonError('week は YYYY-MM-DD 形式で指定してください', 400)
  }

  const rows = week
    ? await env.DB
        .prepare(`
          SELECT *
          FROM shifts
          WHERE staff_id = ?
            AND date >= ?
            AND date < date(?, '+7 days')
          ORDER BY date ASC, start_time ASC
        `)
        .bind(staffId, week, week)
        .all<Shift>()
    : await env.DB
        .prepare(`
          SELECT *
          FROM shifts
          WHERE staff_id = ?
          ORDER BY date DESC, start_time DESC
        `)
        .bind(staffId)
        .all<Shift>()

  return jsonOk(rows.results)
}

async function getStaffPropertyIds(env: Env, staffId: string): Promise<string[]> {
  const rows = await env.DB
    .prepare('SELECT property_id FROM staff_properties WHERE staff_id = ? ORDER BY property_id ASC')
    .bind(staffId)
    .all<{ property_id: string }>()

  return rows.results.map((row) => row.property_id)
}

function generateInviteCode(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000
  return random.toString().padStart(6, '0')
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
