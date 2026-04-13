import {
  multicastText,
  pushText,
  createRichMenu,
  uploadRichMenuImage,
  linkRichMenuToUser,
  unlinkRichMenuFromUser,
  setDefaultRichMenu,
} from '../lib/line'
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

interface MessageInput {
  text?: string
}

interface BroadcastInput {
  text?: string
  role?: Staff['role'] | 'all'
  staff_ids?: string[]
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

  if (pathname === '/api/staff/setup-richmenu') {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    return handleSetupRichMenu(env)
  }

  if (pathname === '/api/staff/broadcast') {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    return handleBroadcastMessage(request, env)
  }

  if (pathname.endsWith('/shifts') && pathname.startsWith('/api/staff/')) {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    const staffId = pathname.slice('/api/staff/'.length, -'/shifts'.length)
    return handleGetStaffShifts(env, staffId, searchParams)
  }

  if (pathname.endsWith('/message') && pathname.startsWith('/api/staff/')) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    const staffId = pathname.slice('/api/staff/'.length, -'/message'.length)
    return handleSendStaffMessage(request, env, staffId)
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
  const includeInactive = searchParams.get('include_inactive') === 'true'
  const rows = propertyId
    ? await env.DB
        .prepare(`
          SELECT s.*
          FROM staff s
          JOIN staff_properties sp ON sp.staff_id = s.id
          WHERE sp.property_id = ?
            ${includeInactive ? '' : 'AND s.is_active = 1'}
          ORDER BY s.is_active DESC, s.name ASC
        `)
        .bind(propertyId)
        .all<Staff>()
    : await env.DB
        .prepare(`
          SELECT *
          FROM staff
          ${includeInactive ? '' : 'WHERE is_active = 1'}
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
  const invite = {
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

  // リッチメニューの差し替え（roleが変更された場合）
  if (payload.role !== undefined && payload.role !== existing.role) {
    const staffRow = await env.DB.prepare('SELECT line_user_id FROM staff WHERE id = ?').bind(staffId).first<{ line_user_id: string | null }>()
    if (staffRow?.line_user_id) {
      const richMenuId = await env.KV.get(`richmenu:${payload.role}`)
      if (richMenuId) {
        try {
          await unlinkRichMenuFromUser(staffRow.line_user_id, env.LINE_STAFF_ACCESS_TOKEN)
        } catch (err) {
          console.error('Failed to unlink rich menu', err)
        }
        try {
          await linkRichMenuToUser(staffRow.line_user_id, richMenuId, env.LINE_STAFF_ACCESS_TOKEN)
        } catch (err) {
          console.error('Failed to link rich menu', err)
        }
      }
    }
  }

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
  const existing = await env.DB.prepare('SELECT id, line_user_id FROM staff WHERE id = ?').bind(staffId).first<{ id: string; line_user_id: string | null }>()
  if (!existing) return jsonError('スタッフが見つかりません', 404)

  // リッチメニュー解除
  if (existing.line_user_id) {
    try {
      await unlinkRichMenuFromUser(existing.line_user_id, env.LINE_STAFF_ACCESS_TOKEN)
    } catch (err) {
      console.error('Failed to unlink rich menu on delete', err)
    }
  }

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

async function handleSendStaffMessage(request: Request, env: Env, staffId: string): Promise<Response> {
  const payload = await safeJson<MessageInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const text = payload.text?.trim()
  if (!text) return jsonError('text は必須です', 400)
  if (text.length > 5000) return jsonError('text は5000文字以内にしてください', 400)

  const staff = await env.DB
    .prepare('SELECT id, name, line_user_id, is_active FROM staff WHERE id = ?')
    .bind(staffId)
    .first<{ id: string; name: string; line_user_id: string; is_active: number }>()

  if (!staff) return jsonError('スタッフが見つかりません', 404)
  if (!staff.line_user_id) return jsonError('LINE 連携未完了のスタッフには送信できません', 400)
  if (staff.is_active !== 1) return jsonError('無効化されたスタッフには送信できません', 400)

  try {
    await pushText(staff.line_user_id, text, env.LINE_STAFF_ACCESS_TOKEN)
  } catch (err) {
    console.error('pushText to staff failed', err)
    return jsonError('LINE 送信に失敗しました', 502)
  }

  return jsonOk({
    staff_id: staff.id,
    staff_name: staff.name,
    sent_to: 1,
  })
}

async function handleBroadcastMessage(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<BroadcastInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const text = payload.text?.trim()
  if (!text) return jsonError('text は必須です', 400)
  if (text.length > 5000) return jsonError('text は5000文字以内にしてください', 400)

  // 宛先の特定: staff_ids > role > all の優先順
  const staffIds = Array.isArray(payload.staff_ids)
    ? payload.staff_ids.map((id) => id.trim()).filter(Boolean)
    : []
  const role = payload.role

  let query: string
  let bindings: string[]
  if (staffIds.length > 0) {
    const placeholders = staffIds.map(() => '?').join(',')
    query = `SELECT id, name, line_user_id FROM staff WHERE id IN (${placeholders}) AND is_active = 1 AND line_user_id IS NOT NULL`
    bindings = staffIds
  } else if (role && role !== 'all') {
    query = 'SELECT id, name, line_user_id FROM staff WHERE role = ? AND is_active = 1 AND line_user_id IS NOT NULL'
    bindings = [role]
  } else {
    query = 'SELECT id, name, line_user_id FROM staff WHERE is_active = 1 AND line_user_id IS NOT NULL'
    bindings = []
  }

  const rows = await env.DB
    .prepare(query)
    .bind(...bindings)
    .all<{ id: string; name: string; line_user_id: string }>()

  const recipients = rows.results
  if (recipients.length === 0) {
    return jsonError('送信対象のスタッフが見つかりません', 404)
  }

  const lineUserIds = recipients.map((r) => r.line_user_id)

  try {
    // LINE multicast は1回につき最大500ユーザーまで
    const chunkSize = 500
    for (let i = 0; i < lineUserIds.length; i += chunkSize) {
      const chunk = lineUserIds.slice(i, i + chunkSize)
      await multicastText(chunk, text, env.LINE_STAFF_ACCESS_TOKEN)
    }
  } catch (err) {
    console.error('multicastText failed', err)
    return jsonError('LINE 送信に失敗しました', 502)
  }

  return jsonOk({
    sent_to: recipients.length,
    recipients: recipients.map((r) => ({ id: r.id, name: r.name })),
  })
}

// ─── Rich Menu セットアップ ─────────────────────────────

const RICHMENU_IMAGE_BASE = 'https://minpaku-os-admin.pages.dev/richmenu'

function buildManagerRichMenu(adminUrl: string) {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'minpaku-os-manager',
    chatBarText: 'メニュー',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: 'uri', uri: adminUrl },
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'message', text: '予約' },
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'message', text: '今日のシフト' },
      },
      {
        bounds: { x: 0, y: 843, width: 833, height: 843 },
        action: { type: 'message', text: 'チェックリスト' },
      },
      {
        bounds: { x: 833, y: 843, width: 834, height: 843 },
        action: { type: 'message', text: '完了' },
      },
      {
        bounds: { x: 1667, y: 843, width: 833, height: 843 },
        action: { type: 'message', text: 'ヘルプ' },
      },
    ],
  }
}

function buildCleanerRichMenu() {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'minpaku-os-cleaner',
    chatBarText: 'メニュー',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 1250, height: 843 },
        action: { type: 'message', text: '今日のシフト' },
      },
      {
        bounds: { x: 1250, y: 0, width: 1250, height: 843 },
        action: { type: 'message', text: 'チェックリスト' },
      },
      {
        bounds: { x: 0, y: 843, width: 1250, height: 843 },
        action: { type: 'message', text: '完了' },
      },
      {
        bounds: { x: 1250, y: 843, width: 1250, height: 843 },
        action: { type: 'message', text: 'ヘルプ' },
      },
    ],
  }
}

function buildCheckinRichMenu() {
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'minpaku-os-checkin',
    chatBarText: 'メニュー',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 1250, height: 843 },
        action: { type: 'message', text: '今日のシフト' },
      },
      {
        bounds: { x: 1250, y: 0, width: 1250, height: 843 },
        action: { type: 'message', text: '予約' },
      },
      {
        bounds: { x: 0, y: 843, width: 1250, height: 843 },
        action: { type: 'message', text: '完了' },
      },
      {
        bounds: { x: 1250, y: 843, width: 1250, height: 843 },
        action: { type: 'message', text: 'ヘルプ' },
      },
    ],
  }
}

async function handleSetupRichMenu(env: Env): Promise<Response> {
  const adminUrl = env.ADMIN_URL ?? 'https://minpaku-os-admin.pages.dev'
  const accessToken = env.LINE_STAFF_ACCESS_TOKEN

  const roles = ['manager', 'cleaner', 'checkin'] as const
  const results: Record<string, string> = {}
  const errors: string[] = []

  for (const role of roles) {
    // 冪等: 既に KV に保存済みならスキップ
    const existingId = await env.KV.get(`richmenu:${role}`)
    if (existingId) {
      results[role] = existingId
      continue
    }

    try {
      // 1. リッチメニュー定義を作成
      const menuDef =
        role === 'manager' ? buildManagerRichMenu(adminUrl)
        : role === 'cleaner' ? buildCleanerRichMenu()
        : buildCheckinRichMenu()

      const richMenuId = await createRichMenu(menuDef, accessToken)

      // 2. 画像をアップロード
      const imageUrl = `${RICHMENU_IMAGE_BASE}/richmenu_${role}.png`
      const imageRes = await fetch(imageUrl)
      if (!imageRes.ok) {
        throw new Error(`Failed to fetch image from ${imageUrl}: ${imageRes.status}`)
      }
      const imageBuffer = await imageRes.arrayBuffer()
      await uploadRichMenuImage(richMenuId, imageBuffer, accessToken)

      // 3. KV に保存
      await env.KV.put(`richmenu:${role}`, richMenuId)
      results[role] = richMenuId
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${role}: ${msg}`)
      console.error(`Failed to setup rich menu for ${role}`, err)
    }
  }

  // cleaner をデフォルトに設定
  if (results.cleaner) {
    try {
      await setDefaultRichMenu(results.cleaner, accessToken)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`default: ${msg}`)
      console.error('Failed to set default rich menu', err)
    }
  }

  // 既存スタッフにリッチメニューをリンク
  const allStaff = await env.DB
    .prepare('SELECT id, line_user_id, role FROM staff WHERE is_active = 1 AND line_user_id IS NOT NULL')
    .all<{ id: string; line_user_id: string; role: Staff['role'] }>()

  let linked = 0
  for (const s of allStaff.results) {
    const menuId = results[s.role]
    if (!menuId || !s.line_user_id) continue
    try {
      await linkRichMenuToUser(s.line_user_id, menuId, accessToken)
      linked++
    } catch (err) {
      console.error(`Failed to link rich menu to staff ${s.id}`, err)
    }
  }

  return jsonOk({
    richMenuIds: results,
    linked_staff: linked,
    errors: errors.length > 0 ? errors : undefined,
  })
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
