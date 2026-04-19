import type { ApiResponse, CleaningChecklistItem, CleaningChecklistResult, Env } from '../types'

interface ChecklistCreateInput {
  label?: string
  sort_order?: number
}

interface ChecklistResultInput {
  checked?: number
  photo_url?: string | null
}

interface ShiftChecklistRow extends CleaningChecklistItem {
  result_id: string | null
  shift_id: string | null
  checked: number | null
  photo_url: string | null
  checked_at: string | null
}

export async function checklistRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url

  if (pathname.startsWith('/api/properties/') && pathname.endsWith('/checklist')) {
    const propertyId = pathname.slice('/api/properties/'.length, -'/checklist'.length)
    if (request.method === 'GET') return handleListPropertyChecklist(env, propertyId)
    if (request.method === 'POST') return handleCreateChecklistItem(request, env, propertyId)
    return jsonError('Method Not Allowed', 405)
  }

  if (pathname.startsWith('/api/shifts/') && pathname.includes('/checklist')) {
    const match = pathname.match(/^\/api\/shifts\/([^/]+)\/checklist(?:\/([^/]+))?$/)
    const shiftId = match?.[1]
    const itemId = match?.[2]
    if (!shiftId) return jsonError('Not Found', 404)
    if (!itemId) {
      if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
      return handleListShiftChecklist(env, shiftId)
    }
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    return handleUpsertChecklistResult(request, env, shiftId, itemId)
  }

  if (pathname.startsWith('/api/checklist/')) {
    const itemId = pathname.slice('/api/checklist/'.length)
    if (!itemId || itemId.includes('/')) return jsonError('Not Found', 404)
    if (request.method !== 'DELETE') return jsonError('Method Not Allowed', 405)
    return handleDeleteChecklistItem(env, itemId)
  }

  return jsonError('Not Found', 404)
}

async function handleListPropertyChecklist(env: Env, propertyId: string): Promise<Response> {
  const property = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(propertyId).first<{ id: string }>()
  if (!property) return jsonError('物件が見つかりません', 404)

  const rows = await env.DB
    .prepare(`
      SELECT id, property_id, label, sort_order, created_at
      FROM cleaning_checklist_items
      WHERE property_id = ?
      ORDER BY sort_order ASC, created_at ASC
    `)
    .bind(propertyId)
    .all<CleaningChecklistItem>()

  return jsonOk(rows.results)
}

async function handleCreateChecklistItem(request: Request, env: Env, propertyId: string): Promise<Response> {
  const property = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(propertyId).first<{ id: string }>()
  if (!property) return jsonError('物件が見つかりません', 404)

  const payload = await safeJson<ChecklistCreateInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const label = payload.label?.trim()
  const sortOrder = Number.isInteger(payload.sort_order) ? payload.sort_order : 0
  if (!label) return jsonError('label は必須です', 400)
  if (sortOrder < 0) return jsonError('sort_order は0以上で指定してください', 400)

  const inserted = await env.DB
    .prepare(`
      INSERT INTO cleaning_checklist_items (property_id, label, sort_order, created_at)
      VALUES (?, ?, ?, datetime('now'))
      RETURNING id, property_id, label, sort_order, created_at
    `)
    .bind(propertyId, label, sortOrder)
    .first<CleaningChecklistItem>()

  return jsonOk(inserted)
}

async function handleDeleteChecklistItem(env: Env, itemId: string): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT id FROM cleaning_checklist_items WHERE id = ?')
    .bind(itemId)
    .first<{ id: string }>()
  if (!existing) return jsonError('チェック項目が見つかりません', 404)

  await env.DB.prepare('DELETE FROM cleaning_checklist_results WHERE item_id = ?').bind(itemId).run()
  await env.DB.prepare('DELETE FROM cleaning_checklist_items WHERE id = ?').bind(itemId).run()

  return jsonOk({ id: itemId, deleted: true })
}

async function handleListShiftChecklist(env: Env, shiftId: string): Promise<Response> {
  const shift = await env.DB
    .prepare('SELECT id, property_id FROM shifts WHERE id = ?')
    .bind(shiftId)
    .first<{ id: string; property_id: string }>()
  if (!shift) return jsonError('シフトが見つかりません', 404)

  const rows = await env.DB
    .prepare(`
      SELECT
        i.id,
        i.property_id,
        i.label,
        i.sort_order,
        i.created_at,
        r.id AS result_id,
        r.shift_id,
        r.checked,
        r.photo_url,
        r.checked_at
      FROM cleaning_checklist_items i
      LEFT JOIN cleaning_checklist_results r
        ON r.item_id = i.id AND r.shift_id = ?
      WHERE i.property_id = ?
      ORDER BY i.sort_order ASC, i.created_at ASC
    `)
    .bind(shiftId, shift.property_id)
    .all<ShiftChecklistRow>()

  return jsonOk(rows.results.map((row) => ({
    id: row.id,
    property_id: row.property_id,
    label: row.label,
    sort_order: row.sort_order,
    created_at: row.created_at,
    result: row.result_id ? {
      id: row.result_id,
      shift_id: row.shift_id!,
      item_id: row.id,
      checked: row.checked ?? 0,
      photo_url: row.photo_url,
      checked_at: row.checked_at,
    } satisfies CleaningChecklistResult : null,
  })))
}

async function handleUpsertChecklistResult(request: Request, env: Env, shiftId: string, itemId: string): Promise<Response> {
  const shift = await env.DB
    .prepare('SELECT id, property_id FROM shifts WHERE id = ?')
    .bind(shiftId)
    .first<{ id: string; property_id: string }>()
  if (!shift) return jsonError('シフトが見つかりません', 404)

  const item = await env.DB
    .prepare('SELECT id, property_id FROM cleaning_checklist_items WHERE id = ?')
    .bind(itemId)
    .first<{ id: string; property_id: string }>()
  if (!item) return jsonError('チェック項目が見つかりません', 404)
  if (item.property_id !== shift.property_id) return jsonError('シフトとチェック項目の物件が一致しません', 400)

  const payload = await safeJson<ChecklistResultInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const checked = payload.checked === 1 ? 1 : 0
  const photoUrl = payload.photo_url?.trim() || null

  await env.DB
    .prepare(`
      INSERT INTO cleaning_checklist_results (shift_id, item_id, checked, photo_url, checked_at)
      VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
      ON CONFLICT(shift_id, item_id)
      DO UPDATE SET
        checked = excluded.checked,
        photo_url = excluded.photo_url,
        checked_at = CASE WHEN excluded.checked = 1 THEN datetime('now') ELSE NULL END
    `)
    .bind(shiftId, itemId, checked, photoUrl, checked)
    .run()

  const row = await env.DB
    .prepare(`
      SELECT id, shift_id, item_id, checked, photo_url, checked_at
      FROM cleaning_checklist_results
      WHERE shift_id = ? AND item_id = ?
    `)
    .bind(shiftId, itemId)
    .first<CleaningChecklistResult>()

  return jsonOk(row)
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
