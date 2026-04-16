import { formatDateJa, pushButtonLink, pushConfirm, pushText } from '../lib/line'
import type { ApiResponse, Env, Reservation, Shift, ShiftRequest } from '../types'

const TASK_TYPE_LABEL: Record<Shift['task_type'], string> = {
  cleaning: '清掃',
  checkin: 'チェックイン',
  checkout: 'チェックアウト',
  inspection: '点検',
}

interface ShiftRequestInput {
  line_user_id?: string
  week_start_date?: string
  available_dates?: Array<{
    date?: string
    from?: string
    to?: string
  }>
}

interface ShiftCreateInput {
  staff_id?: string
  property_id?: string
  reservation_id?: string | null
  task_type?: Shift['task_type']
  date?: string
  start_time?: string | null
  end_time?: string | null
  status?: Shift['status']
  notify?: boolean
}

interface ShiftPatchInput {
  staff_id?: string
  property_id?: string
  task_type?: Shift['task_type']
  date?: string
  status?: Shift['status']
  start_time?: string | null
  end_time?: string | null
  completion_note?: string | null
  completion_photo_urls?: string | null
  notify?: boolean
}

interface ShiftProposalInput {
  week_start_date?: string
  notes?: string
}

interface ShiftProposalRow {
  staff_id?: string
  property_id?: string
  reservation_id?: string | null
  task_type?: string
  date?: string
  start_time?: string | null
  end_time?: string | null
  reason?: string | null
}

interface ShiftListRow extends Shift {
  staff_name?: string
  property_name?: string
  guest_name?: string | null
}

interface PropertyReservationInfo {
  property_name: string
  checkout_time: string | null
  default_checkout_time: string
}

export async function shiftRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname, searchParams } = url
  const shiftId = getIdFromPath(pathname, '/api/shifts/')

  if (pathname === '/api/shift-requests') {
    if (request.method !== 'POST') {
      return jsonError('Method Not Allowed', 405)
    }
    return handleCreateShiftRequest(request, env)
  }

  if (pathname === '/api/shifts') {
    if (request.method === 'GET') return handleListShifts(env, searchParams)
    if (request.method === 'POST') return handleCreateShift(request, env)
    return jsonError('Method Not Allowed', 405)
  }

  if (pathname === '/api/shifts/propose') {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    return handleProposeShifts(request, env)
  }

  if (pathname === '/api/shifts/confirm-all') {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    return handleConfirmAllShifts(env, searchParams)
  }

  if (pathname === '/api/shifts/requests') {
    if (request.method === 'GET') return handleListShiftRequests(env, searchParams)
    if (request.method === 'POST') return handleUpsertShiftRequestAdmin(request, env)
    return jsonError('Method Not Allowed', 405)
  }

  if (pathname.startsWith('/api/shifts/requests/')) {
    const requestId = pathname.slice('/api/shifts/requests/'.length)
    if (!requestId || requestId.includes('/')) return jsonError('Not Found', 404)
    if (request.method !== 'DELETE') return jsonError('Method Not Allowed', 405)
    return handleDeleteShiftRequestAdmin(env, requestId)
  }

  if (shiftId) {
    if (request.method === 'PATCH') return handlePatchShift(request, env, shiftId)
    if (request.method === 'DELETE') return handleDeleteShift(env, shiftId)
    return jsonError('Method Not Allowed', 405)
  }

  return jsonError('Not Found', 404)
}

async function handleCreateShiftRequest(request: Request, env: Env): Promise<Response> {
  let payload: ShiftRequestInput

  try {
    payload = (await request.json()) as ShiftRequestInput
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const lineUserId = payload.line_user_id?.trim()
  const weekStartDate = payload.week_start_date?.trim()
  const availableDates = Array.isArray(payload.available_dates) ? payload.available_dates : null

  if (!lineUserId || !weekStartDate || !availableDates) {
    return jsonError('line_user_id, week_start_date, available_dates は必須です', 400)
  }

  if (!isDate(weekStartDate)) {
    return jsonError('week_start_date の形式が不正です', 400)
  }

  // タイムゾーン非依存で曜日チェック（noon UTC で判定）
  const mondayCheck = new Date(`${weekStartDate}T12:00:00Z`).getUTCDay()
  if (mondayCheck !== 1) {
    return jsonError('week_start_date は月曜日を指定してください', 400)
  }

  const staff = await env.DB
    .prepare(`
      SELECT id, is_active
      FROM staff
      WHERE line_user_id = ?
      LIMIT 1
    `)
    .bind(lineUserId)
    .first<{ id: string; is_active: number }>()

  if (!staff || staff.is_active !== 1) {
    return jsonError('スタッフが見つかりません', 404)
  }

  const normalizedDates: string[] = []
  const timeMap: Record<string, { from: string; to: string }> = {}

  for (const slot of availableDates) {
    const date = slot?.date?.trim()
    const from = slot?.from?.trim()
    const to = slot?.to?.trim()

    if (!date || !from || !to) {
      return jsonError('available_dates の各要素に date/from/to が必要です', 400)
    }

    if (!isDate(date) || !isTime(from) || !isTime(to)) {
      return jsonError('日付または時間帯の形式が不正です', 400)
    }

    if (from >= to) {
      return jsonError('開始時間は終了時間より前である必要があります', 400)
    }

    const offset = diffDays(weekStartDate, date)
    if (offset < 0 || offset > 6) {
      return jsonError('available_dates は対象週の7日間のみ指定できます', 400)
    }

    if (!normalizedDates.includes(date)) {
      normalizedDates.push(date)
    }
    timeMap[date] = { from, to }
  }

  await env.DB
    .prepare(`
      INSERT INTO shift_requests (staff_id, week_start_date, available_dates_json, available_time_json, collected_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(staff_id, week_start_date)
      DO UPDATE SET
        available_dates_json = excluded.available_dates_json,
        available_time_json = excluded.available_time_json,
        collected_at = datetime('now')
    `)
    .bind(staff.id, weekStartDate, JSON.stringify(normalizedDates), JSON.stringify(timeMap))
    .run()

  return jsonOk({
    staff_id: staff.id,
    week_start_date: weekStartDate,
    available_dates: normalizedDates.map((date) => ({ date, ...timeMap[date] })),
  })
}

interface ShiftRequestAdminInput {
  staff_id?: string
  week_start_date?: string
  available_dates?: Array<{
    date?: string
    from?: string
    to?: string
  }>
  notes?: string | null
  notify?: boolean
}

async function handleUpsertShiftRequestAdmin(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<ShiftRequestAdminInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const staffId = payload.staff_id?.trim()
  const weekStartDate = payload.week_start_date?.trim()
  const availableDates = Array.isArray(payload.available_dates) ? payload.available_dates : null
  const notes = payload.notes ?? null

  if (!staffId || !weekStartDate || !availableDates) {
    return jsonError('staff_id, week_start_date, available_dates は必須です', 400)
  }
  if (!isDate(weekStartDate)) {
    return jsonError('week_start_date の形式が不正です', 400)
  }
  // 月曜チェック（タイムゾーン非依存）
  if (new Date(`${weekStartDate}T12:00:00Z`).getUTCDay() !== 1) {
    return jsonError('week_start_date は月曜日を指定してください', 400)
  }

  const staff = await env.DB
    .prepare('SELECT id FROM staff WHERE id = ? AND is_active = 1')
    .bind(staffId)
    .first<{ id: string }>()
  if (!staff) return jsonError('スタッフが見つかりません', 404)

  const normalizedDates: string[] = []
  const timeMap: Record<string, { from: string; to: string }> = {}

  for (const slot of availableDates) {
    const date = slot?.date?.trim()
    const from = slot?.from?.trim()
    const to = slot?.to?.trim()
    if (!date || !from || !to) {
      return jsonError('available_dates の各要素に date/from/to が必要です', 400)
    }
    if (!isDate(date) || !isTime(from) || !isTime(to)) {
      return jsonError('日付または時間帯の形式が不正です', 400)
    }
    if (from >= to) {
      return jsonError('開始時間は終了時間より前である必要があります', 400)
    }
    const offset = diffDays(weekStartDate, date)
    if (offset < 0 || offset > 6) {
      return jsonError('available_dates は対象週の7日間のみ指定できます', 400)
    }
    if (!normalizedDates.includes(date)) {
      normalizedDates.push(date)
    }
    timeMap[date] = { from, to }
  }

  await env.DB
    .prepare(`
      INSERT INTO shift_requests (staff_id, week_start_date, available_dates_json, available_time_json, notes, collected_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(staff_id, week_start_date)
      DO UPDATE SET
        available_dates_json = excluded.available_dates_json,
        available_time_json = excluded.available_time_json,
        notes = excluded.notes,
        collected_at = datetime('now')
    `)
    .bind(staffId, weekStartDate, JSON.stringify(normalizedDates), JSON.stringify(timeMap), notes)
    .run()

  let notifySent = false
  if (payload.notify === true) {
    try {
      await notifyStaffAboutShiftRequest(env, staffId, weekStartDate, normalizedDates, timeMap)
      notifySent = true
    } catch (err) {
      console.error('notifyStaffAboutShiftRequest failed', err)
    }
  }

  return jsonOk({
    staff_id: staffId,
    week_start_date: weekStartDate,
    available_dates: normalizedDates.map((date) => ({ date, ...timeMap[date] })),
    notify_sent: notifySent,
  })
}

async function notifyStaffAboutShiftRequest(
  env: Env,
  staffId: string,
  weekStartDate: string,
  availableDates: string[],
  timeMap: Record<string, { from: string; to: string }>
): Promise<void> {
  const staff = await env.DB
    .prepare('SELECT id, name, line_user_id FROM staff WHERE id = ?')
    .bind(staffId)
    .first<{ id: string; name: string; line_user_id: string }>()
  if (!staff || !staff.line_user_id) return

  const weekEnd = new Date(`${weekStartDate}T12:00:00Z`)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const weekEndStr = weekEnd.toISOString().slice(0, 10)

  const sortedDates = [...availableDates].sort()
  const dateLines = sortedDates.length > 0
    ? sortedDates.map((date) => {
        const t = timeMap[date]
        return `・${formatDateJa(date)} ${t.from}〜${t.to}`
      }).join('\n')
    : '（対応可能日なし）'

  const text = [
    '【シフト希望を更新】',
    `マネージャーがあなたの来週（${formatDateJa(weekStartDate)}〜${formatDateJa(weekEndStr)}）のシフト希望を設定しました。`,
    '',
    '対応可能日:',
    dateLines,
    '',
    '変更がある場合はカレンダーから再送信してください。',
  ].join('\n')

  const liffUrl = env.LIFF_ID
    ? `https://liff.line.me/${env.LIFF_ID}?week=${weekStartDate}`
    : null

  await pushText(staff.line_user_id, text, env.LINE_STAFF_ACCESS_TOKEN)
  if (liffUrl) {
    await pushButtonLink(
      staff.line_user_id,
      '変更する場合はカレンダーを開いてください。',
      'カレンダーを開く',
      liffUrl,
      env.LINE_STAFF_ACCESS_TOKEN
    )
  }
}

async function handleDeleteShiftRequestAdmin(env: Env, requestId: string): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT id FROM shift_requests WHERE id = ?')
    .bind(requestId)
    .first<{ id: string }>()
  if (!existing) return jsonError('シフト希望が見つかりません', 404)

  await env.DB.prepare('DELETE FROM shift_requests WHERE id = ?').bind(requestId).run()
  return jsonOk({ id: requestId, deleted: true })
}

async function handleListShiftRequests(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const week = searchParams.get('week')?.trim() || getNextMonday()
  if (!isDate(week)) {
    return jsonError('week は YYYY-MM-DD 形式で指定してください', 400)
  }

  const rows = await env.DB
    .prepare(`
      SELECT
        sr.id,
        sr.staff_id,
        sr.week_start_date,
        sr.available_dates_json,
        sr.available_time_json,
        sr.notes,
        sr.collected_at,
        s.name AS staff_name,
        s.role AS staff_role
      FROM shift_requests sr
      JOIN staff s ON s.id = sr.staff_id
      WHERE sr.week_start_date = ?
        AND s.is_active = 1
      ORDER BY sr.collected_at DESC
    `)
    .bind(week)
    .all<{
      id: string
      staff_id: string
      week_start_date: string
      available_dates_json: string
      available_time_json: string
      notes: string | null
      collected_at: string
      staff_name: string
      staff_role: string
    }>()

  const requests = rows.results.map((row) => {
    let availableDates: string[] = []
    let availableTimes: Record<string, { from: string; to: string }> = {}
    try {
      availableDates = JSON.parse(row.available_dates_json) as string[]
    } catch { availableDates = [] }
    try {
      availableTimes = JSON.parse(row.available_time_json) as Record<string, { from: string; to: string }>
    } catch { availableTimes = {} }

    return {
      id: row.id,
      staff_id: row.staff_id,
      staff_name: row.staff_name,
      staff_role: row.staff_role,
      week_start_date: row.week_start_date,
      available_dates: availableDates,
      available_times: availableTimes,
      notes: row.notes,
      collected_at: row.collected_at,
    }
  })

  return jsonOk({ week_start_date: week, requests })
}

async function handleListShifts(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const week = searchParams.get('week')?.trim()
  const month = searchParams.get('month')?.trim()
  const propertyId = searchParams.get('property_id')?.trim()
  const staffId = searchParams.get('staff_id')?.trim()

  if (week && !isDate(week)) {
    return jsonError('week は YYYY-MM-DD 形式で指定してください', 400)
  }
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return jsonError('month は YYYY-MM 形式で指定してください', 400)
  }

  const conditions: string[] = []
  const bindings: string[] = []

  if (week) {
    conditions.push('sh.date >= ?')
    conditions.push("sh.date < date(?, '+7 days')")
    bindings.push(week, week)
  } else if (month) {
    conditions.push('sh.date >= ?')
    conditions.push("sh.date < date(?, '+1 month')")
    bindings.push(`${month}-01`, `${month}-01`)
  }
  if (propertyId) {
    conditions.push('sh.property_id = ?')
    bindings.push(propertyId)
  }
  if (staffId) {
    conditions.push('sh.staff_id = ?')
    bindings.push(staffId)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await env.DB
    .prepare(`
      SELECT
        sh.*,
        s.name AS staff_name,
        p.name AS property_name,
        r.guest_name AS guest_name
      FROM shifts sh
      JOIN staff s ON s.id = sh.staff_id
      JOIN properties p ON p.id = sh.property_id
      LEFT JOIN reservations r ON r.id = sh.reservation_id
      ${where}
      ORDER BY sh.date ASC, sh.start_time ASC, sh.created_at ASC
    `)
    .bind(...bindings)
    .all<ShiftListRow>()

  return jsonOk(rows.results)
}

async function handleCreateShift(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<ShiftCreateInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  // notify=true のときはデフォルトで status を 'notified' にする
  const shouldNotify = payload.notify === true
  if (shouldNotify && !payload.status) {
    payload.status = 'notified'
  }

  const validation = await validateShiftInput(env, payload)
  if (!validation.ok) return jsonError(validation.error, 400)

  const inserted = await env.DB
    .prepare(`
      INSERT INTO shifts (
        staff_id, property_id, reservation_id, task_type, date,
        start_time, end_time, status, proposed_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', datetime('now'), datetime('now'))
      RETURNING *
    `)
    .bind(
      validation.value.staff_id,
      validation.value.property_id,
      validation.value.reservation_id,
      validation.value.task_type,
      validation.value.date,
      validation.value.start_time,
      validation.value.end_time,
      validation.value.status
    )
    .first<Shift>()

  let notifySent = false
  if (shouldNotify && inserted) {
    try {
      await notifyStaffAboutShift(env, inserted, 'create')
      notifySent = true
    } catch (err) {
      console.error('notifyStaffAboutShift (create) failed', err)
    }
  }

  return jsonOk({ ...inserted, notify_sent: notifySent })
}

async function handlePatchShift(request: Request, env: Env, shiftId: string): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT * FROM shifts WHERE id = ?')
    .bind(shiftId)
    .first<Shift>()

  if (!existing) return jsonError('シフトが見つかりません', 404)

  const payload = await safeJson<ShiftPatchInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const staffId = payload.staff_id !== undefined ? payload.staff_id : existing.staff_id
  const propertyId = payload.property_id !== undefined ? payload.property_id : existing.property_id
  const taskType = payload.task_type !== undefined ? payload.task_type : existing.task_type
  const date = payload.date !== undefined ? payload.date : existing.date
  const status = payload.status ?? existing.status
  const startTime = payload.start_time !== undefined ? payload.start_time : existing.start_time
  const endTime = payload.end_time !== undefined ? payload.end_time : existing.end_time
  const completionNote = payload.completion_note !== undefined ? payload.completion_note : existing.completion_note
  const completionPhotoUrls = payload.completion_photo_urls !== undefined ? payload.completion_photo_urls : existing.completion_photo_urls

  if (!isValidShiftStatus(status)) {
    return jsonError('status が不正です', 400)
  }
  if (!isValidTaskType(taskType)) {
    return jsonError('task_type が不正です', 400)
  }
  if (!isDate(date)) {
    return jsonError('date は YYYY-MM-DD 形式で指定してください', 400)
  }
  if (startTime && !isTime(startTime)) {
    return jsonError('start_time の形式が不正です', 400)
  }
  if (endTime && !isTime(endTime)) {
    return jsonError('end_time の形式が不正です', 400)
  }
  if (startTime && endTime && startTime >= endTime) {
    return jsonError('start_time は end_time より前である必要があります', 400)
  }

  // staff_id / property_id の存在チェック（変更時のみ）
  if (payload.staff_id !== undefined && payload.staff_id !== existing.staff_id) {
    const staff = await env.DB.prepare('SELECT id FROM staff WHERE id = ? AND is_active = 1').bind(staffId).first<{ id: string }>()
    if (!staff) return jsonError('スタッフが見つかりません', 404)
  }
  if (payload.property_id !== undefined && payload.property_id !== existing.property_id) {
    const property = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(propertyId).first<{ id: string }>()
    if (!property) return jsonError('物件が見つかりません', 404)
  }

  // notify=true で時間/日付/スタッフ/物件/タスクが変わったら status を 'notified' に戻す
  const shouldNotify = payload.notify === true
  const hasContentChange =
    payload.staff_id !== undefined && payload.staff_id !== existing.staff_id ||
    payload.property_id !== undefined && payload.property_id !== existing.property_id ||
    payload.task_type !== undefined && payload.task_type !== existing.task_type ||
    payload.date !== undefined && payload.date !== existing.date ||
    payload.start_time !== undefined && payload.start_time !== existing.start_time ||
    payload.end_time !== undefined && payload.end_time !== existing.end_time
  const finalStatus = shouldNotify && hasContentChange && payload.status === undefined
    ? 'notified'
    : status

  await env.DB
    .prepare(`
      UPDATE shifts
      SET staff_id = ?, property_id = ?, task_type = ?, date = ?,
          status = ?, start_time = ?, end_time = ?,
          completion_note = ?, completion_photo_urls = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(staffId, propertyId, taskType, date, finalStatus, startTime, endTime, completionNote, completionPhotoUrls, shiftId)
    .run()

  let notifySent = false
  if (shouldNotify) {
    const refreshed = await env.DB
      .prepare('SELECT * FROM shifts WHERE id = ?')
      .bind(shiftId)
      .first<Shift>()
    if (refreshed) {
      try {
        await notifyStaffAboutShift(env, refreshed, 'update')
        notifySent = true
      } catch (err) {
        console.error('notifyStaffAboutShift (update) failed', err)
      }
    }
  }

  const updated = await env.DB
    .prepare('SELECT * FROM shifts WHERE id = ?')
    .bind(shiftId)
    .first<Shift>()

  return jsonOk({ ...updated, notify_sent: notifySent })
}

async function notifyStaffAboutShift(env: Env, shift: Shift, kind: 'create' | 'update'): Promise<void> {
  const staff = await env.DB
    .prepare('SELECT id, name, line_user_id FROM staff WHERE id = ?')
    .bind(shift.staff_id)
    .first<{ id: string; name: string; line_user_id: string }>()
  if (!staff || !staff.line_user_id) return

  const property = await env.DB
    .prepare('SELECT id, name FROM properties WHERE id = ?')
    .bind(shift.property_id)
    .first<{ id: string; name: string }>()

  const propertyName = property?.name ?? '物件'
  const taskLabel = TASK_TYPE_LABEL[shift.task_type] ?? shift.task_type
  const timeRange = shift.start_time && shift.end_time
    ? `${shift.start_time}〜${shift.end_time}`
    : '時間未定'

  const headline = kind === 'create' ? '【新しいシフト】' : '【シフト変更】'
  const text = [
    headline,
    `📍 ${propertyName}`,
    `📅 ${formatDateJa(shift.date)}`,
    `⏰ ${timeRange}`,
    `📋 ${taskLabel}`,
    '',
    '承諾→「OK」 辞退→「NG」',
  ].join('\n')

  const confirmData = `action=confirm_shift&shift_id=${shift.id}`
  const declineData = `action=decline_shift&shift_id=${shift.id}`

  await pushConfirm(
    staff.line_user_id,
    text,
    'OK',
    'NG',
    confirmData,
    declineData,
    env.LINE_STAFF_ACCESS_TOKEN
  )
}

async function handleDeleteShift(env: Env, shiftId: string): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT id FROM shifts WHERE id = ?')
    .bind(shiftId)
    .first<{ id: string }>()

  if (!existing) return jsonError('シフトが見つかりません', 404)

  await env.DB.prepare('DELETE FROM shifts WHERE id = ?').bind(shiftId).run()
  return jsonOk({ id: shiftId, deleted: true })
}

async function handleProposeShifts(request: Request, env: Env): Promise<Response> {
  if (!env.AGENT_ENDPOINT?.trim()) {
    return jsonError('AGENT_ENDPOINT が設定されていません', 500)
  }

  const payload = await safeJson<ShiftProposalInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const weekStartDate = payload.week_start_date?.trim() || getNextMonday()
  if (!isDate(weekStartDate)) {
    return jsonError('week_start_date は YYYY-MM-DD 形式で指定してください', 400)
  }

  const reservations = await env.DB
    .prepare(`
      SELECT *
      FROM reservations
      WHERE checkin_date < date(?, '+7 days')
        AND checkout_date >= ?
        AND status NOT IN ('cancelled', 'blocked')
      ORDER BY checkin_date ASC
    `)
    .bind(weekStartDate, weekStartDate)
    .all<Reservation>()

  const shiftRequests = await env.DB
    .prepare(`
      SELECT *
      FROM shift_requests
      WHERE week_start_date = ?
      ORDER BY collected_at DESC
    `)
    .bind(weekStartDate)
    .all<ShiftRequest>()

  const agentRes = await fetch(joinUrl(env.AGENT_ENDPOINT, '/propose-shifts'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      week_start_date: weekStartDate,
      notes: payload.notes ?? null,
      reservations: reservations.results,
      shift_requests: shiftRequests.results,
    }),
  })

  if (!agentRes.ok) {
    const message = await safeReadText(agentRes)
    console.error('propose-shifts failed', message)
    return jsonError('シフト提案の生成に失敗しました', 502)
  }

  const agentBody = await safeJsonFromResponse<{ success?: boolean; data?: { shifts?: unknown } }>(agentRes)
  const proposals = normalizeProposalRows(agentBody?.data?.shifts)
  if (!proposals) {
    return jsonError('シフト提案結果の形式が不正です', 502)
  }

  const created: Shift[] = []
  for (const proposal of proposals) {
    const normalized = await validateShiftInput(env, {
      staff_id: proposal.staff_id,
      property_id: proposal.property_id,
      reservation_id: proposal.reservation_id ?? null,
      task_type: proposal.task_type as Shift['task_type'],
      date: proposal.date,
      start_time: proposal.start_time ?? null,
      end_time: proposal.end_time ?? null,
      status: 'proposed',
    })
    if (!normalized.ok) {
      console.error('invalid shift proposal', normalized.error, proposal)
      continue
    }

    const inserted = await env.DB
      .prepare(`
        INSERT INTO shifts (
          staff_id, property_id, reservation_id, task_type, date,
          start_time, end_time, status, proposed_by, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', 'system', datetime('now'), datetime('now'))
        RETURNING *
      `)
      .bind(
        normalized.value.staff_id,
        normalized.value.property_id,
        normalized.value.reservation_id,
        normalized.value.task_type,
        normalized.value.date,
        normalized.value.start_time,
        normalized.value.end_time
      )
      .first<Shift>()

    if (inserted) created.push(inserted)
  }

  await notifyOwnerForProposals(env, weekStartDate, created.length)
  return jsonOk({
    week_start_date: weekStartDate,
    reservations_count: reservations.results.length,
    shift_requests_count: shiftRequests.results.length,
    created_count: created.length,
    shifts: created,
  })
}

async function handleConfirmAllShifts(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const week = searchParams.get('week')?.trim()
  if (week && !isDate(week)) {
    return jsonError('week は YYYY-MM-DD 形式で指定してください', 400)
  }

  const rows = week
    ? await env.DB
        .prepare(`
          SELECT sh.*, s.line_user_id, s.name AS staff_name, p.name AS property_name
          FROM shifts sh
          JOIN staff s ON s.id = sh.staff_id
          JOIN properties p ON p.id = sh.property_id
          WHERE sh.status = 'proposed'
            AND sh.date >= ?
            AND sh.date < date(?, '+7 days')
          ORDER BY sh.date ASC, sh.start_time ASC
        `)
        .bind(week, week)
        .all<Shift & { line_user_id: string; staff_name: string; property_name: string }>()
    : await env.DB
        .prepare(`
          SELECT sh.*, s.line_user_id, s.name AS staff_name, p.name AS property_name
          FROM shifts sh
          JOIN staff s ON s.id = sh.staff_id
          JOIN properties p ON p.id = sh.property_id
          WHERE sh.status = 'proposed'
          ORDER BY sh.date ASC, sh.start_time ASC
        `)
        .all<Shift & { line_user_id: string; staff_name: string; property_name: string }>()

  for (const row of rows.results) {
    await env.DB
      .prepare(`
        UPDATE shifts
        SET status = 'confirmed', updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(row.id)
      .run()

    const text = buildConfirmedShiftText({
      property_name: row.property_name,
      checkout_time: null,
      default_checkout_time: row.start_time ?? '09:00',
    }, row)

    await pushText(row.line_user_id, text, env.LINE_STAFF_ACCESS_TOKEN)
  }

  return jsonOk({
    confirmed_count: rows.results.length,
    week_start_date: week ?? null,
  })
}

async function validateShiftInput(
  env: Env,
  payload: ShiftCreateInput
): Promise<{ ok: true; value: Required<ShiftCreateInput> } | { ok: false; error: string }> {
  const staffId = payload.staff_id?.trim()
  const propertyId = payload.property_id?.trim()
  const reservationId = payload.reservation_id?.trim() || null
  const taskType = payload.task_type
  const date = payload.date?.trim()
  const startTime = payload.start_time?.trim() || null
  const endTime = payload.end_time?.trim() || null
  const status = payload.status ?? 'proposed'

  if (!staffId || !propertyId || !taskType || !date) {
    return { ok: false, error: 'staff_id, property_id, task_type, date は必須です' }
  }
  if (!isValidTaskType(taskType)) {
    return { ok: false, error: 'task_type が不正です' }
  }
  if (!isDate(date)) {
    return { ok: false, error: 'date は YYYY-MM-DD 形式で指定してください' }
  }
  if (!isValidShiftStatus(status)) {
    return { ok: false, error: 'status が不正です' }
  }
  if (startTime && !isTime(startTime)) {
    return { ok: false, error: 'start_time の形式が不正です' }
  }
  if (endTime && !isTime(endTime)) {
    return { ok: false, error: 'end_time の形式が不正です' }
  }
  if (startTime && endTime && startTime >= endTime) {
    return { ok: false, error: 'start_time は end_time より前である必要があります' }
  }

  const [staff, property] = await Promise.all([
    env.DB.prepare('SELECT id FROM staff WHERE id = ? AND is_active = 1').bind(staffId).first<{ id: string }>(),
    env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(propertyId).first<{ id: string }>(),
  ])
  if (!staff) return { ok: false, error: 'スタッフが見つかりません' }
  if (!property) return { ok: false, error: '物件が見つかりません' }

  if (reservationId) {
    const reservation = await env.DB
      .prepare('SELECT id FROM reservations WHERE id = ?')
      .bind(reservationId)
      .first<{ id: string }>()
    if (!reservation) return { ok: false, error: '予約が見つかりません' }
  }

  return {
    ok: true,
    value: {
      staff_id: staffId,
      property_id: propertyId,
      reservation_id: reservationId,
      task_type: taskType,
      date,
      start_time: startTime,
      end_time: endTime,
      status,
    },
  }
}

async function notifyOwnerForProposals(env: Env, weekStartDate: string, createdCount: number): Promise<void> {
  const ownerLineId = await env.KV.get('owner_line_user_id')
  if (!ownerLineId) return

  await pushText(
    ownerLineId,
    `【シフト提案】\n週開始: ${weekStartDate}\n提案件数: ${createdCount}\n管理画面で確認して確定してください。`,
    env.LINE_STAFF_ACCESS_TOKEN
  )
}

function buildConfirmedShiftText(info: PropertyReservationInfo, shift: Shift): string {
  const timeRange = shift.start_time && shift.end_time
    ? `${shift.start_time}〜${shift.end_time}`
    : shift.start_time ?? info.default_checkout_time

  return `【シフト確定】\n${info.property_name}\n日付: ${shift.date}\n時間: ${timeRange}\n種別: ${shift.task_type}`
}

function normalizeProposalRows(value: unknown): ShiftProposalRow[] | null {
  if (!Array.isArray(value)) return null

  return value.map((row) => {
    const input = (row && typeof row === 'object') ? row as Record<string, unknown> : {}
    return {
      staff_id: typeof input.staff_id === 'string' ? input.staff_id : undefined,
      property_id: typeof input.property_id === 'string' ? input.property_id : undefined,
      reservation_id: typeof input.reservation_id === 'string' ? input.reservation_id : null,
      task_type: typeof input.task_type === 'string' ? input.task_type : undefined,
      date: typeof input.date === 'string' ? input.date : undefined,
      start_time: typeof input.start_time === 'string' ? input.start_time : null,
      end_time: typeof input.end_time === 'string' ? input.end_time : null,
      reason: typeof input.reason === 'string' ? input.reason : null,
    }
  })
}

function isValidTaskType(value: string): value is Shift['task_type'] {
  return ['cleaning', 'checkin', 'checkout', 'inspection'].includes(value)
}

function isValidShiftStatus(value: string): value is Shift['status'] {
  return ['proposed', 'notified', 'confirmed', 'declined', 'completed', 'cancelled'].includes(value)
}

function getIdFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  return rest && !rest.includes('/') ? rest : null
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value)
}

function diffDays(start: string, end: string): number {
  const startAt = new Date(`${start}T00:00:00+09:00`).getTime()
  const endAt = new Date(`${end}T00:00:00+09:00`).getTime()
  return Math.round((endAt - startAt) / 86400000)
}

function getNextMonday(): string {
  const now = new Date()
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const day = jst.getDay()
  const diff = day === 1 ? 7 : (8 - day) % 7
  jst.setDate(jst.getDate() + diff)
  return formatDateForDb(jst)
}

function formatDateForDb(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

async function safeJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

async function safeJsonFromResponse<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
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
