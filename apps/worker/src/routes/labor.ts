import type { ApiResponse, Env, LaborCost } from '../types'

interface LaborCostPatchInput {
  hours?: number | null
  amount?: number | null
  note?: string | null
}

export async function laborRoutes(request: Request, env: Env): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url)

  if (pathname === '/api/labor-costs') {
    if (request.method === 'GET') return handleListLaborCosts(env, searchParams)
    return jsonError('Method Not Allowed', 405)
  }

  if (pathname.startsWith('/api/labor-costs/')) {
    const id = pathname.slice('/api/labor-costs/'.length)
    if (!id || id.includes('/')) return jsonError('Not Found', 404)
    if (request.method === 'PATCH') return handlePatchLaborCost(request, env, id)
    return jsonError('Method Not Allowed', 405)
  }

  if (pathname === '/api/labor-costs/summary') {
    if (request.method === 'GET') return handleLaborSummary(env, searchParams)
    return jsonError('Method Not Allowed', 405)
  }

  return jsonError('Not Found', 404)
}

async function handleListLaborCosts(env: Env, params: URLSearchParams): Promise<Response> {
  const month = params.get('month')?.trim()
  const staffId = params.get('staff_id')?.trim()

  const conditions = ['1 = 1']
  const bindings: string[] = []

  if (month) { conditions.push("substr(lc.date, 1, 7) = ?"); bindings.push(month) }
  if (staffId) { conditions.push("lc.staff_id = ?"); bindings.push(staffId) }

  const rows = await env.DB
    .prepare(`
      SELECT lc.*, p.name AS property_name
      FROM labor_costs lc
      LEFT JOIN properties p ON p.id = lc.property_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY lc.date DESC, lc.staff_name ASC
    `)
    .bind(...bindings)
    .all<LaborCost & { property_name: string | null }>()

  const totalAmount = rows.results.reduce((sum, r) => sum + (r.amount ?? 0), 0)

  return jsonOk({ total_amount: totalAmount, rows: rows.results })
}

async function handlePatchLaborCost(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT * FROM labor_costs WHERE id = ?')
    .bind(id)
    .first<LaborCost>()

  if (!existing) return jsonError('人件費レコードが見つかりません', 404)

  const payload = await safeJson<LaborCostPatchInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const hours = payload.hours !== undefined ? payload.hours : existing.hours
  const amount = payload.amount !== undefined ? (payload.amount ?? 0) : existing.amount
  const note = payload.note !== undefined ? payload.note : existing.note

  await env.DB
    .prepare('UPDATE labor_costs SET hours = ?, amount = ?, note = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(hours, amount, note, id)
    .run()

  const updated = await env.DB.prepare('SELECT * FROM labor_costs WHERE id = ?').bind(id).first<LaborCost>()
  return jsonOk(updated)
}

async function handleLaborSummary(env: Env, params: URLSearchParams): Promise<Response> {
  const month = params.get('month')?.trim()
  const conditions = ['1 = 1']
  const bindings: string[] = []
  if (month) { conditions.push("substr(lc.date, 1, 7) = ?"); bindings.push(month) }

  const rows = await env.DB
    .prepare(`
      SELECT lc.staff_id, lc.staff_name, lc.wage_type,
             SUM(lc.hours) AS total_hours,
             SUM(lc.amount) AS total_amount,
             COUNT(*) AS shift_count
      FROM labor_costs lc
      WHERE ${conditions.join(' AND ')}
      GROUP BY lc.staff_id, lc.staff_name
      ORDER BY total_amount DESC
    `)
    .bind(...bindings)
    .all<{ staff_id: string; staff_name: string; wage_type: string; total_hours: number; total_amount: number; shift_count: number }>()

  return jsonOk(rows.results)
}

/**
 * シフト完了時に人件費を自動計算して登録する
 */
export async function createLaborCostFromShift(env: Env, shiftId: string): Promise<void> {
  const shift = await env.DB
    .prepare(`
      SELECT s.id, s.staff_id, s.property_id, s.date, s.start_time, s.end_time,
             st.name AS staff_name, st.hourly_wage, st.wage_type
      FROM shifts s
      JOIN staff st ON st.id = s.staff_id
      WHERE s.id = ?
    `)
    .bind(shiftId)
    .first<{
      id: string; staff_id: string; property_id: string | null; date: string;
      start_time: string | null; end_time: string | null;
      staff_name: string; hourly_wage: number | null; wage_type: string | null
    }>()

  if (!shift || !shift.hourly_wage) return

  const wageType = shift.wage_type ?? 'hourly'
  let hours: number | null = null
  let amount = 0

  if (wageType === 'daily') {
    hours = null
    amount = shift.hourly_wage
  } else {
    hours = calculateHours(shift.start_time, shift.end_time)
    amount = hours ? Math.round(hours * shift.hourly_wage) : 0
  }

  await env.DB
    .prepare(`
      INSERT INTO labor_costs (shift_id, staff_id, staff_name, property_id, date, hours, wage_type, wage_rate, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shift_id) DO UPDATE SET hours = ?, amount = ?, updated_at = datetime('now')
    `)
    .bind(
      shift.id, shift.staff_id, shift.staff_name, shift.property_id, shift.date,
      hours, wageType, shift.hourly_wage, amount,
      hours, amount
    )
    .run()
}

function calculateHours(startTime: string | null, endTime: string | null): number | null {
  if (!startTime || !endTime) return null
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const diff = (eh * 60 + em) - (sh * 60 + sm)
  return diff > 0 ? Math.round(diff / 6) / 10 : null  // 0.1h単位
}

async function safeJson<T>(request: Request): Promise<T | null> {
  try { return (await request.json()) as T } catch { return null }
}

function jsonOk<T>(data: T): Response {
  const body: ApiResponse<T> = { success: true, data }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function jsonError(error: string, status: number): Response {
  const body: ApiResponse<never> = { success: false, error }
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
