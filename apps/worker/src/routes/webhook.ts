import {
  formatDateJa,
  linkRichMenuToUser,
  parsePostbackData,
  pushConfirm,
  pushText,
  replyText,
  verifyLineSignature,
} from '../lib/line'
import { createLaborCostFromShift } from './labor'
import type { Env, LineEvent, LineWebhookBody, Shift, Staff } from '../types'

interface InvitePayload {
  tenant_id?: string
  staff_id?: string
  name?: string
  role?: Staff['role']
  employment_type?: Staff['employment_type']
  hourly_wage?: number | null
  property_ids?: string[]
}

interface ShiftLookup {
  id: string
  tenant_id: string
  staff_id: string
  property_id: string
  reservation_id: string | null
  task_type: Shift['task_type']
  date: string
  status: Shift['status']
}

interface PropertyReservationInfo {
  property_name: string
  checkout_time: string | null
  default_checkout_time: string
}

const OWNER_LINE_ID_KEY = 'owner_line_user_id'
const SHIFT_COLLECTION_ACTIVE_KEY = 'shift_collection_active'
const SHIFT_COLLECTION_WEEK_KEY = 'shift_collection_week_start'

type AutoEvent = 'shift_accept' | 'shift_complete' | 'shift_decline'

const DEFAULT_AUTO_MESSAGES: Record<Staff['role'], Record<AutoEvent, string>> = {
  cleaner: {
    shift_accept: 'シフトを承諾しました。\n清掃が完了したら「完了」と清掃後の写真をこちらのLINEで送ってください。',
    shift_complete: '完了を記録しました。清掃後の写真があれば続けて送信してください。',
    shift_decline: '辞退を受け付けました。次のスタッフへ確認します。',
  },
  checkin: {
    shift_accept: 'シフトを承諾しました。\nチェックイン対応が完了したら「完了」と送ってください。',
    shift_complete: '完了を記録しました。お疲れさまでした。',
    shift_decline: '辞退を受け付けました。次のスタッフへ確認します。',
  },
  manager: {
    shift_accept: 'シフトを承諾しました。完了したら「完了」と送ってください。',
    shift_complete: '完了を記録しました。お疲れさまでした。',
    shift_decline: '辞退を受け付けました。',
  },
}

async function getAutoMessage(
  env: Env,
  tenantId: string,
  role: Staff['role'],
  event: AutoEvent
): Promise<string> {
  const row = await env.DB
    .prepare('SELECT body_text FROM staff_auto_messages WHERE role = ? AND event_type = ? AND tenant_id = ?')
    .bind(role, event, tenantId)
    .first<{ body_text: string }>()
  return row?.body_text?.trim() || DEFAULT_AUTO_MESSAGES[role][event]
}

export async function handleLineWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const signature = request.headers.get('x-line-signature')
  if (!signature) {
    return new Response('Missing signature', { status: 401 })
  }

  const bodyText = await request.text()
  const channelSecret = env.LINE_STAFF_CHANNEL_SECRET || env.LINE_CHANNEL_SECRET
  const valid = await verifyLineSignature(bodyText, signature, channelSecret)
  if (!valid) {
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: LineWebhookBody
  try {
    payload = JSON.parse(bodyText) as LineWebhookBody
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // LINE は webhook 応答が遅いと配信ステータスをエラー扱いする。
  // 重い処理は ctx.waitUntil に逃がして即 200 を返す。
  ctx.waitUntil(processEvents(payload.events, env))

  return jsonOk()
}

async function processEvents(events: LineEvent[], env: Env): Promise<void> {
  for (const event of events) {
    try {
      console.log('LINE event:', JSON.stringify({ type: event.type, userId: event.source?.userId }))
      await handleEvent(event, env)
    } catch (error) {
      console.error('LINE webhook event error', error, event)
      if (event.replyToken) {
        await safeReply(
          event.replyToken,
          '処理中にエラーが発生しました。時間をおいてもう一度お試しください。',
          env
        )
      }
    }
  }
}

async function handleEvent(event: LineEvent, env: Env): Promise<void> {
  switch (event.type) {
    case 'follow':
      await handleFollowEvent(event, env)
      return
    case 'message':
      if (!event.message || !event.replyToken) return
      if (event.message.type === 'text') {
        await handleTextMessage(event, env)
        return
      }
      if (event.message.type === 'image') {
        await handleImageMessage(event, env)
      }
      return
    case 'postback':
      await handlePostbackEvent(event, env)
      return
    default:
      return
  }
}

async function handleFollowEvent(event: LineEvent, env: Env): Promise<void> {
  const userId = event.source.userId
  await env.KV.put(invitePendingKey(userId), '1', { expirationTtl: 60 * 60 * 24 })

  if (!event.replyToken) return

  await replyText(
    event.replyToken,
    'スタッフ登録を開始します。招待コード6桁をこのトークに返信してください。',
    env.LINE_STAFF_ACCESS_TOKEN
  )
}

async function handleTextMessage(event: LineEvent, env: Env): Promise<void> {
  const userId = event.source.userId
  const text = (event.message?.text ?? '').trim()
  const normalized = normalizeText(text)
  const staff = await findStaffByLineUserId(env, userId)

  if (!staff) {
    console.log('Staff not found, trying invite:', { userId, text })
    const registered = await tryRegisterStaffFromInvite(env, userId, text)
    console.log('Invite result:', registered)
    if (registered) {
      await replyText(
        event.replyToken!,
        `登録が完了しました。${registered.name}さんとして利用できます。`,
        env.LINE_STAFF_ACCESS_TOKEN
      )
      return
    }

    await replyText(
      event.replyToken!,
      '未登録のアカウントです。招待コード6桁を送信してください。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  if (normalized === 'ok') {
    const confirmed = await confirmLatestShiftForStaff(env, staff)
    const acceptMsg = await getAutoMessage(env, staff.tenant_id, staff.role, 'shift_accept')
    await replyText(
      event.replyToken!,
      confirmed ? acceptMsg : '承諾待ちのシフトが見つかりませんでした。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  if (normalized === 'ng') {
    const declined = await declineLatestShiftForStaff(env, staff)
    const declineMsg = await getAutoMessage(env, staff.tenant_id, staff.role, 'shift_decline')
    await replyText(
      event.replyToken!,
      declined ? declineMsg : '辞退対象のシフトが見つかりませんでした。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  if (normalized === 'completed') {
    const completed = await completeLatestShiftForStaff(env, staff)
    if (completed) {
      // チェックリスト未完了チェック
      const unchecked = await getUncheckedItems(env, staff.tenant_id, staff.id)
      const completeMsg = await getAutoMessage(env, staff.tenant_id, staff.role, 'shift_complete')
      const msg = unchecked.length > 0
        ? `完了を記録しました。\n\n⚠️ 未チェック項目:\n${unchecked.map(i => `・${i.label}`).join('\n')}\n\n確認の上、写真を送信してください。`
        : completeMsg
      await replyText(event.replyToken!, msg, env.LINE_STAFF_ACCESS_TOKEN)
    } else {
      await replyText(event.replyToken!, '完了対象のシフトが見つかりませんでした。', env.LINE_STAFF_ACCESS_TOKEN)
    }
    return
  }

  if (text === 'チェックリスト' || text === 'checklist') {
    const checklist = await getStaffChecklist(env, staff)
    await replyText(
      event.replyToken!,
      checklist || '担当物件のチェックリストがありません。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  if (text === '今日のシフト' || text === 'shift') {
    const shifts = await getTodayShifts(env, staff)
    await replyText(
      event.replyToken!,
      shifts || '今日のシフトはありません。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  if (normalized === 'reservations' || normalized === 'yoyaku' || text === '予約') {
    const today = new Date().toISOString().slice(0, 10)
    const upcoming = await env.DB
      .prepare(`
        SELECT r.guest_name, r.checkin_date, r.checkout_date, r.platform, r.status, p.name as property_name
        FROM reservations r
        LEFT JOIN properties p ON r.property_id = p.id AND p.tenant_id = r.tenant_id
        WHERE r.tenant_id = ?
          AND r.checkout_date >= ?
          AND r.status IN ('confirmed', 'completed')
        ORDER BY r.checkin_date ASC
        LIMIT 30
      `)
      .bind(staff.tenant_id, today)
      .all<{ guest_name: string | null; checkin_date: string; checkout_date: string; platform: string; status: string; property_name: string | null }>()

    // 表示設定（管理画面のLINE設定で変更可能）
    const hideGuestName = await env.KV.get('config:hide_guest_name') === 'true'
    const showPlatform = await env.KV.get('config:show_platform') === 'true'

    // ゲスト名がある予約のみ表示、ゲスト未設定（iCal ブロック等）は件数だけ
    const named = upcoming.results.filter((r) => r.guest_name && r.guest_name !== 'ゲスト未設定')
    const unnamed = upcoming.results.filter((r) => !r.guest_name || r.guest_name === 'ゲスト未設定')

    if (named.length === 0 && unnamed.length === 0) {
      await replyText(event.replyToken!, '今後の予約はありません。', env.LINE_STAFF_ACCESS_TOKEN)
    } else {
      const lines = named.slice(0, 10).map((r, i) => {
        const guestPart = hideGuestName ? '' : ` / ${r.guest_name}`
        const platformPart = showPlatform ? ` (${r.platform})` : ''
        return `${i + 1}. ${r.checkin_date}→${r.checkout_date}\n   ${r.property_name ?? '不明'}${guestPart}${platformPart}`
      })
      const footer = unnamed.length > 0
        ? `\n\n※ 他にゲスト名未設定の予約が ${unnamed.length} 件あります`
        : ''
      const msg = named.length > 0
        ? `📋 今後の予約:\n\n${lines.join('\n\n')}${footer}`
        : `📋 今後の予約:\n\nゲスト名が確定している予約はありません。\n※ ゲスト名未設定の予約が ${unnamed.length} 件あります（管理画面で確認できます）`
      await replyText(event.replyToken!, msg, env.LINE_STAFF_ACCESS_TOKEN)
    }
    return
  }

  if (text === '管理画面' || text === 'admin') {
    if (staff.role === 'manager') {
      await replyText(
        event.replyToken!,
        `🔗 管理画面:\n${env.ADMIN_URL ?? 'https://your-admin.pages.dev'}`,
        env.LINE_STAFF_ACCESS_TOKEN
      )
    } else {
      await replyText(
        event.replyToken!,
        '管理画面へのアクセスはマネージャー権限が必要です。',
        env.LINE_STAFF_ACCESS_TOKEN
      )
    }
    return
  }

  if (text === 'ヘルプ' || text === 'help' || text === '？') {
    const managerCommands = staff.role === 'manager'
      ? '\n• 管理画面 → Web管理画面のURL\n• 予約 → 今後の予約一覧'
      : ''
    await replyText(
      event.replyToken!,
      `📖 コマンド一覧:\n\n• チェックリスト → 清掃チェックリスト表示\n• 今日のシフト → 本日のシフト確認${managerCommands}\n• OK → シフト承諾\n• NG → シフト辞退\n• 完了 → タスク完了報告\n• ヘルプ → このメッセージ`,
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  const collecting = await env.KV.get(SHIFT_COLLECTION_ACTIVE_KEY)
  if (collecting === 'true') {
    await saveShiftRequest(env, staff.tenant_id, staff.id, text)
    await replyText(
      event.replyToken!,
      'シフト希望を受け付けました。必要があれば追記も送ってください。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  await replyText(
    event.replyToken!,
    '受信しました。「ヘルプ」でコマンド一覧を確認できます。',
    env.LINE_STAFF_ACCESS_TOKEN
  )
}

async function handleImageMessage(event: LineEvent, env: Env): Promise<void> {
  const staff = await findStaffByLineUserId(env, event.source.userId)
  if (!staff || !event.message?.id || !event.replyToken) {
    return
  }

  const shift = await findLatestCompletableShift(env, staff.tenant_id, staff.id)
  if (!shift) {
    await replyText(
      event.replyToken,
      '写真を保存する対象のシフトが見つかりませんでした。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  const currentPhotos = await env.DB
    .prepare('SELECT completion_photo_urls FROM shifts WHERE id = ? AND tenant_id = ?')
    .bind(shift.id, staff.tenant_id)
    .first<{ completion_photo_urls: string | null }>()

  const photos = safeJsonArray(currentPhotos?.completion_photo_urls)
  photos.push(lineContentUrl(event.message.id))

  await env.DB
    .prepare(`
      UPDATE shifts
      SET completion_photo_urls = ?, updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(JSON.stringify(photos), shift.id, staff.tenant_id)
    .run()

  await replyText(
    event.replyToken,
    '作業写真を保存しました。',
    env.LINE_STAFF_ACCESS_TOKEN
  )
}

async function handlePostbackEvent(event: LineEvent, env: Env): Promise<void> {
  const data = event.postback?.data
  if (!data || !event.replyToken) return

  const staff = event.source.userId ? await findStaffByLineUserId(env, event.source.userId) : null
  if (!staff) {
    await replyText(
      event.replyToken,
      '未登録のアカウントです。招待コード6桁を送信してください。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  const params = parsePostbackData(data)
  const shift = await findShiftFromPostback(env, staff.tenant_id, params, event.source.userId)

  if (!shift) {
    await replyText(
      event.replyToken,
      '対象のシフトが見つかりませんでした。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
    return
  }

  const role: Staff['role'] = staff.role

  if (params.action === 'confirm_shift') {
    await confirmShift(env, shift)
    const msg = await getAutoMessage(env, staff.tenant_id, role, 'shift_accept')
    await replyText(event.replyToken, msg, env.LINE_STAFF_ACCESS_TOKEN)
    return
  }

  if (params.action === 'decline_shift') {
    await declineShift(env, shift)
    const msg = await getAutoMessage(env, staff.tenant_id, role, 'shift_decline')
    await replyText(event.replyToken, msg, env.LINE_STAFF_ACCESS_TOKEN)
  }
}

async function tryRegisterStaffFromInvite(
  env: Env,
  lineUserId: string,
  rawCode: string
): Promise<{ id: string; name: string } | null> {
  const code = rawCode.trim()
  if (!/^\d{6}$/.test(code)) return null

  const invite = await readInvitePayload(env, code)
  if (!invite) return null

  const name = invite.name?.trim() || 'スタッフ'
  const role = invite.role ?? 'cleaner'
  const employmentType = invite.employment_type ?? 'part_time'
  const hourlyWage = invite.hourly_wage ?? null

  // tenant_id は invite 側で必須。staff_id 経由の場合は DB から補完する。
  let tenantId = invite.tenant_id ?? ''

  let staffId = invite.staff_id ?? ''
  if (staffId) {
    if (!tenantId) {
      const existing = await env.DB
        .prepare('SELECT tenant_id FROM staff WHERE id = ?')
        .bind(staffId)
        .first<{ tenant_id: string }>()
      tenantId = existing?.tenant_id ?? ''
    }
    if (!tenantId) {
      throw new Error('invite missing tenant_id and staff record not found')
    }

    await env.DB
      .prepare(`
        UPDATE staff
        SET line_user_id = ?, name = ?, role = ?, employment_type = ?, hourly_wage = ?,
            invited_at = COALESCE(invited_at, datetime('now')), is_active = 1, updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?
      `)
      .bind(lineUserId, name, role, employmentType, hourlyWage, staffId, tenantId)
      .run()
  } else {
    if (!tenantId) {
      throw new Error('invite missing tenant_id')
    }

    // 同じ line_user_id & tenant_id で無効化済みのスタッフがいれば再有効化する
    const deactivated = await env.DB
      .prepare('SELECT id FROM staff WHERE line_user_id = ? AND tenant_id = ? AND is_active = 0')
      .bind(lineUserId, tenantId)
      .first<{ id: string }>()

    if (deactivated) {
      staffId = deactivated.id
      await env.DB
        .prepare(`
          UPDATE staff
          SET name = ?, role = ?, employment_type = ?, hourly_wage = ?,
              is_active = 1, invited_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND tenant_id = ?
        `)
        .bind(name, role, employmentType, hourlyWage, staffId, tenantId)
        .run()
    } else {
      const result = await env.DB
        .prepare(`
          INSERT INTO staff (tenant_id, line_user_id, name, role, employment_type, hourly_wage, invited_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          RETURNING id
        `)
        .bind(tenantId, lineUserId, name, role, employmentType, hourlyWage)
        .first<{ id: string }>()
      staffId = result?.id ?? ''
    }
  }

  if (!staffId) {
    throw new Error('failed to create or update staff')
  }

  if (invite.property_ids && invite.property_ids.length > 0) {
    for (const propertyId of invite.property_ids) {
      await env.DB
        .prepare('INSERT OR IGNORE INTO staff_properties (tenant_id, staff_id, property_id) VALUES (?, ?, ?)')
        .bind(tenantId, staffId, propertyId)
        .run()
    }
  }

  await deleteInvitePayload(env, code)
  await env.KV.delete(invitePendingKey(lineUserId))

  // リッチメニューをリンク
  const richMenuId = await env.KV.get(`richmenu:${role}`)
  if (richMenuId && lineUserId) {
    try {
      await linkRichMenuToUser(lineUserId, richMenuId, env.LINE_STAFF_ACCESS_TOKEN)
    } catch (err) {
      console.error('Failed to link rich menu', err)
    }
  }

  return { id: staffId, name }
}

async function saveShiftRequest(
  env: Env,
  tenantId: string,
  staffId: string,
  text: string
): Promise<void> {
  const weekStartDate = await env.KV.get(SHIFT_COLLECTION_WEEK_KEY) ?? nextMondayJst()

  await env.DB
    .prepare(`
      INSERT INTO shift_requests (tenant_id, staff_id, week_start_date, available_dates_json, available_time_json, notes, collected_at)
      VALUES (?, ?, ?, '[]', '{}', ?, datetime('now'))
      ON CONFLICT(staff_id, week_start_date)
      DO UPDATE SET
        notes = excluded.notes,
        collected_at = datetime('now')
    `)
    .bind(tenantId, staffId, weekStartDate, text)
    .run()
}

async function confirmLatestShiftForStaff(env: Env, staff: Staff): Promise<boolean> {
  const shift = await findLatestNotifiedShift(env, staff.tenant_id, staff.id)
  if (!shift) return false
  await confirmShift(env, shift)
  return true
}

async function declineLatestShiftForStaff(env: Env, staff: Staff): Promise<boolean> {
  const shift = await findLatestNotifiedShift(env, staff.tenant_id, staff.id)
  if (!shift) return false
  await declineShift(env, shift)
  return true
}

async function completeLatestShiftForStaff(env: Env, staff: Staff): Promise<boolean> {
  const shift = await findLatestCompletableShift(env, staff.tenant_id, staff.id)
  if (!shift) return false

  await env.DB
    .prepare(`
      UPDATE shifts
      SET status = 'completed', updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(shift.id, staff.tenant_id)
    .run()

  const detail = await getShiftDetail(env, shift)
  await notifyOwner(
    env,
    `【清掃完了】\n${detail.property_name}\n担当: ${detail.staff_name}\n${formatDateJa(shift.date)}`
  )

  const unchecked = await env.DB
    .prepare(`
      SELECT COUNT(*) AS count
      FROM cleaning_checklist_items i
      LEFT JOIN cleaning_checklist_results r
        ON r.item_id = i.id AND r.shift_id = ?
      WHERE i.property_id = ?
        AND i.tenant_id = ?
        AND IFNULL(r.checked, 0) = 0
    `)
    .bind(shift.id, shift.property_id, staff.tenant_id)
    .first<{ count: number }>()

  if ((unchecked?.count ?? 0) > 0) {
    await pushText(
      staff.line_user_id,
      'チェックリストに未完了項目があります。',
      env.LINE_STAFF_ACCESS_TOKEN
    )
  }

  // 人件費を自動計算
  try {
    await createLaborCostFromShift(env, staff.tenant_id, shift.id)
  } catch (err) {
    console.error('labor cost creation failed', err)
  }

  return true
}

async function confirmShift(env: Env, shift: ShiftLookup): Promise<void> {
  await env.DB
    .prepare(`
      UPDATE shifts
      SET status = 'confirmed', updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(shift.id, shift.tenant_id)
    .run()

  const detail = await getShiftDetail(env, shift)
  await notifyOwner(
    env,
    `【シフト承諾】\n${detail.property_name}\n担当: ${detail.staff_name}\n日付: ${formatDateJa(shift.date)}`
  )
}

async function declineShift(env: Env, shift: ShiftLookup): Promise<void> {
  await env.DB
    .prepare(`
      UPDATE shifts
      SET status = 'declined', updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `)
    .bind(shift.id, shift.tenant_id)
    .run()

  const nextStaff = await findNextAssignableStaff(env, shift)
  const detail = await getPropertyReservationInfo(env, shift)

  if (!nextStaff) {
    await notifyOwner(
      env,
      `【シフト未確定】\n${detail.property_name}\n${formatDateJa(shift.date)} の対応可能スタッフが見つかりません。`
    )
    return
  }

  const insert = await env.DB
    .prepare(`
      INSERT INTO shifts (tenant_id, staff_id, property_id, reservation_id, task_type, date, status, proposed_by)
      VALUES (?, ?, ?, ?, ?, ?, 'notified', 'system')
      RETURNING id
    `)
    .bind(shift.tenant_id, nextStaff.id, shift.property_id, shift.reservation_id, shift.task_type, shift.date)
    .first<{ id: string }>()

  const text = buildCleaningNotificationText(detail)
  const shiftId = insert?.id
  const confirmData = shiftId
    ? `action=confirm_shift&shift_id=${shiftId}`
    : `action=confirm_shift&property_id=${shift.property_id}&reservation_id=${shift.reservation_id ?? ''}&staff_id=${nextStaff.id}`
  const declineData = shiftId
    ? `action=decline_shift&shift_id=${shiftId}`
    : `action=decline_shift&property_id=${shift.property_id}&reservation_id=${shift.reservation_id ?? ''}&staff_id=${nextStaff.id}`

  await pushConfirm(
    nextStaff.line_user_id,
    text,
    'OK',
    'NG',
    confirmData,
    declineData,
    env.LINE_STAFF_ACCESS_TOKEN
  )
}

async function findStaffByLineUserId(env: Env, lineUserId: string): Promise<Staff | null> {
  const staff = await env.DB
    .prepare(`
      SELECT id, tenant_id, line_user_id, name, role, employment_type, hourly_wage, wage_type, is_active, invited_at, created_at, updated_at
      FROM staff
      WHERE line_user_id = ? AND is_active = 1
      LIMIT 1
    `)
    .bind(lineUserId)
    .first<Staff>()

  return staff ?? null
}

async function findLatestNotifiedShift(
  env: Env,
  tenantId: string,
  staffId: string
): Promise<ShiftLookup | null> {
  const shift = await env.DB
    .prepare(`
      SELECT id, tenant_id, staff_id, property_id, reservation_id, task_type, date, status
      FROM shifts
      WHERE staff_id = ? AND tenant_id = ? AND status = 'notified'
      ORDER BY date DESC, created_at DESC
      LIMIT 1
    `)
    .bind(staffId, tenantId)
    .first<ShiftLookup>()

  return shift ?? null
}

async function findLatestCompletableShift(
  env: Env,
  tenantId: string,
  staffId: string
): Promise<ShiftLookup | null> {
  const shift = await env.DB
    .prepare(`
      SELECT id, tenant_id, staff_id, property_id, reservation_id, task_type, date, status
      FROM shifts
      WHERE staff_id = ? AND tenant_id = ? AND status = 'confirmed'
      ORDER BY updated_at DESC, date DESC
      LIMIT 1
    `)
    .bind(staffId, tenantId)
    .first<ShiftLookup>()

  return shift ?? null
}

async function findShiftFromPostback(
  env: Env,
  tenantId: string,
  params: Record<string, string>,
  lineUserId: string
): Promise<ShiftLookup | null> {
  if (params.shift_id) {
    const shift = await env.DB
      .prepare(`
        SELECT sh.id, sh.tenant_id, sh.staff_id, sh.property_id, sh.reservation_id, sh.task_type, sh.date, sh.status
        FROM shifts sh
        JOIN staff s ON s.id = sh.staff_id
        WHERE sh.id = ?
          AND sh.tenant_id = ?
          AND s.line_user_id = ?
          AND s.tenant_id = ?
        LIMIT 1
      `)
      .bind(params.shift_id, tenantId, lineUserId, tenantId)
      .first<ShiftLookup>()

    return shift ?? null
  }

  if (!params.property_id || !params.staff_id) return null

  const shift = await env.DB
    .prepare(`
      SELECT sh.id, sh.tenant_id, sh.staff_id, sh.property_id, sh.reservation_id, sh.task_type, sh.date, sh.status
      FROM shifts sh
      JOIN staff s ON s.id = sh.staff_id
      WHERE sh.property_id = ?
        AND sh.staff_id = ?
        AND sh.tenant_id = ?
        AND (? = '' OR IFNULL(sh.reservation_id, '') = ?)
        AND sh.status = 'notified'
        AND s.line_user_id = ?
        AND s.tenant_id = ?
      ORDER BY sh.created_at DESC
      LIMIT 1
    `)
    .bind(
      params.property_id,
      params.staff_id,
      tenantId,
      params.reservation_id ?? '',
      params.reservation_id ?? '',
      lineUserId,
      tenantId
    )
    .first<ShiftLookup>()

  return shift ?? null
}

async function findNextAssignableStaff(
  env: Env,
  shift: ShiftLookup
): Promise<{ id: string; line_user_id: string } | null> {
  const staffRows = await env.DB
    .prepare(`
      SELECT s.id, s.line_user_id
      FROM staff s
      JOIN staff_properties sp ON sp.staff_id = s.id
      WHERE sp.property_id = ?
        AND s.tenant_id = ?
        AND s.is_active = 1
        AND s.role IN ('cleaner', 'manager')
      ORDER BY s.created_at ASC
    `)
    .bind(shift.property_id, shift.tenant_id)
    .all<{ id: string; line_user_id: string }>()

  const staffList = staffRows.results
  const currentIndex = staffList.findIndex((staff) => staff.id === shift.staff_id)
  if (currentIndex < 0 || currentIndex + 1 >= staffList.length) {
    return null
  }

  for (const candidate of staffList.slice(currentIndex + 1)) {
    const existing = await env.DB
      .prepare(`
        SELECT id
        FROM shifts
        WHERE staff_id = ?
          AND property_id = ?
          AND tenant_id = ?
          AND IFNULL(reservation_id, '') = ?
          AND task_type = ?
          AND date = ?
          AND status IN ('notified', 'confirmed', 'completed')
        LIMIT 1
      `)
      .bind(
        candidate.id,
        shift.property_id,
        shift.tenant_id,
        shift.reservation_id ?? '',
        shift.task_type,
        shift.date
      )
      .first<{ id: string }>()

    if (!existing) {
      return candidate
    }
  }

  return null
}

async function getShiftDetail(
  env: Env,
  shift: ShiftLookup
): Promise<{ property_name: string; staff_name: string }> {
  const row = await env.DB
    .prepare(`
      SELECT p.name AS property_name, s.name AS staff_name
      FROM shifts sh
      JOIN properties p ON p.id = sh.property_id AND p.tenant_id = sh.tenant_id
      JOIN staff s ON s.id = sh.staff_id AND s.tenant_id = sh.tenant_id
      WHERE sh.id = ? AND sh.tenant_id = ?
      LIMIT 1
    `)
    .bind(shift.id, shift.tenant_id)
    .first<{ property_name: string; staff_name: string }>()

  return {
    property_name: row?.property_name ?? '物件',
    staff_name: row?.staff_name ?? 'スタッフ',
  }
}

async function getPropertyReservationInfo(
  env: Env,
  shift: ShiftLookup
): Promise<PropertyReservationInfo> {
  const row = await env.DB
    .prepare(`
      SELECT p.name AS property_name,
             r.checkout_time AS checkout_time,
             p.checkout_time AS default_checkout_time
      FROM properties p
      LEFT JOIN reservations r ON r.id = ? AND r.tenant_id = p.tenant_id
      WHERE p.id = ? AND p.tenant_id = ?
      LIMIT 1
    `)
    .bind(shift.reservation_id, shift.property_id, shift.tenant_id)
    .first<PropertyReservationInfo>()

  return {
    property_name: row?.property_name ?? '物件',
    checkout_time: row?.checkout_time ?? null,
    default_checkout_time: row?.default_checkout_time ?? '11:00',
  }
}

function buildCleaningNotificationText(info: PropertyReservationInfo): string {
  const checkoutTime = info.checkout_time ?? info.default_checkout_time
  return `【清掃依頼】\n📍 ${info.property_name}\n📅 本日 ${checkoutTime}以降\n⏱ 完了したら「完了」と写真を送ってください\n\n承諾→「OK」 辞退→「NG」`
}

async function notifyOwner(env: Env, text: string): Promise<void> {
  const ownerLineId = await env.KV.get(OWNER_LINE_ID_KEY)
  if (!ownerLineId) return
  await pushText(ownerLineId, text, env.LINE_STAFF_ACCESS_TOKEN)
}

async function readInvitePayload(env: Env, code: string): Promise<InvitePayload | null> {
  const keys = inviteKeys(code)
  for (const key of keys) {
    const value = await env.KV.get(key)
    if (!value) continue

    try {
      return JSON.parse(value) as InvitePayload
    } catch {
      return { name: value }
    }
  }

  return null
}

async function deleteInvitePayload(env: Env, code: string): Promise<void> {
  for (const key of inviteKeys(code)) {
    await env.KV.delete(key)
  }
}

function inviteKeys(code: string): string[] {
  return [
    `staff_invite:${code}`,
    `invite:${code}`,
    `staff:invite:${code}`,
  ]
}

function invitePendingKey(lineUserId: string): string {
  return `staff_invite_pending:${lineUserId}`
}

function lineContentUrl(messageId: string): string {
  return `https://api-data.line.me/v2/bot/message/${messageId}/content`
}

function safeJsonArray(value: string | null | undefined): string[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function normalizeText(text: string): 'ok' | 'ng' | 'completed' | 'other' {
  const value = text.trim().toLowerCase()
  if (value === 'ok' || value === 'ｏｋ') return 'ok'
  if (value === 'ng' || value === 'ｎｇ') return 'ng'
  if (text.trim() === '完了') return 'completed'
  return 'other'
}

function nextMondayJst(): string {
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

function jsonOk(): Response {
  return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function safeReply(replyToken: string, text: string, env: Env): Promise<void> {
  try {
    await replyText(replyToken, text, env.LINE_STAFF_ACCESS_TOKEN)
  } catch (error) {
    console.error('LINE reply failed', error)
  }
}

async function getUncheckedItems(
  env: Env,
  tenantId: string,
  staffId: string
): Promise<Array<{ label: string }>> {
  const shift = await env.DB
    .prepare(`SELECT id, property_id FROM shifts WHERE staff_id = ? AND tenant_id = ? AND status = 'completed' ORDER BY updated_at DESC LIMIT 1`)
    .bind(staffId, tenantId)
    .first<{ id: string; property_id: string }>()
  if (!shift) return []

  const items = await env.DB
    .prepare(`
      SELECT ci.label
      FROM cleaning_checklist_items ci
      LEFT JOIN cleaning_checklist_results cr ON cr.item_id = ci.id AND cr.shift_id = ?
      WHERE ci.property_id = ?
        AND ci.tenant_id = ?
        AND (cr.checked IS NULL OR cr.checked = 0)
      ORDER BY ci.sort_order ASC
    `)
    .bind(shift.id, shift.property_id, tenantId)
    .all<{ label: string }>()
  return items.results
}

async function getStaffChecklist(env: Env, staff: Staff): Promise<string | null> {
  const properties = await env.DB
    .prepare(`
      SELECT p.id, p.name
      FROM properties p
      JOIN staff_properties sp ON sp.property_id = p.id
      WHERE sp.staff_id = ?
        AND p.tenant_id = ?
    `)
    .bind(staff.id, staff.tenant_id)
    .all<{ id: string; name: string }>()

  if (properties.results.length === 0) return null

  const sections: string[] = []
  for (const prop of properties.results) {
    const items = await env.DB
      .prepare('SELECT label FROM cleaning_checklist_items WHERE property_id = ? AND tenant_id = ? ORDER BY sort_order ASC')
      .bind(prop.id, staff.tenant_id)
      .all<{ label: string }>()

    const manualUrl = await env.DB
      .prepare('SELECT cleaning_manual_url FROM properties WHERE id = ? AND tenant_id = ?')
      .bind(prop.id, staff.tenant_id)
      .first<{ cleaning_manual_url: string | null }>()

    const lines: string[] = [`📍 ${prop.name}`]
    if (items.results.length > 0) {
      lines.push(items.results.map((i, idx) => `  ${idx + 1}. ${i.label}`).join('\n'))
    }
    if (manualUrl?.cleaning_manual_url) {
      lines.push(`\n📄 マニュアル: ${manualUrl.cleaning_manual_url}`)
    }
    if (items.results.length > 0 || manualUrl?.cleaning_manual_url) {
      sections.push(lines.join('\n'))
    }
  }
  return sections.length > 0 ? `📋 清掃チェックリスト\n\n${sections.join('\n\n')}` : null
}

async function getTodayShifts(env: Env, staff: Staff): Promise<string | null> {
  const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
  const shifts = await env.DB
    .prepare(`
      SELECT s.task_type, s.date, s.start_time, s.end_time, s.status, p.name as property_name
      FROM shifts s
      LEFT JOIN properties p ON p.id = s.property_id AND p.tenant_id = s.tenant_id
      WHERE s.staff_id = ? AND s.tenant_id = ? AND s.date = ?
      ORDER BY s.start_time ASC
    `)
    .bind(staff.id, staff.tenant_id, today)
    .all<{ task_type: string; date: string; start_time: string | null; end_time: string | null; status: string; property_name: string | null }>()

  if (shifts.results.length === 0) return null

  const lines = shifts.results.map(s =>
    `・${s.property_name ?? '不明'} / ${s.task_type} / ${s.start_time ?? ''}〜${s.end_time ?? ''} [${s.status}]`
  )
  return `📅 今日のシフト\n\n${lines.join('\n')}`
}
