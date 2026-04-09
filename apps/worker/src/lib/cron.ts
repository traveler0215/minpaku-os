/**
 * Cron トリガーで実行される定期タスク
 */

import type { Env } from '../types'
import { syncPropertyIcal } from './ical'
import { multicastText, pushText, pushConfirm, pushButtonLink, formatDateJa } from './line'

/**
 * 全物件の iCal を同期する（毎時実行）
 */
export async function handleICalSync(env: Env): Promise<void> {
  const properties = await env.DB
    .prepare('SELECT id, name, airbnb_ical_url, booking_ical_url FROM properties')
    .all<{ id: string; name: string; airbnb_ical_url: string | null; booking_ical_url: string | null }>()

  for (const property of properties.results) {
    const syncs: Array<{ platform: 'airbnb' | 'booking'; url: string }> = []
    if (property.airbnb_ical_url) syncs.push({ platform: 'airbnb', url: property.airbnb_ical_url })
    if (property.booking_ical_url) syncs.push({ platform: 'booking', url: property.booking_ical_url })

    for (const { platform, url } of syncs) {
      try {
        const result = await syncPropertyIcal(env.DB, property.id, url, platform)

        // ダブルブッキング検知
        const doubles = await detectDoubleBooking(env.DB, property.id)
        if (doubles.length > 0) {
          await notifyDoubleBooking(env, property.name, doubles)
        }

        // 同期ログ保存
        await env.DB.prepare(`
          INSERT INTO ical_sync_logs (property_id, platform, status, added_count, updated_count, cancelled_count)
          VALUES (?, ?, 'success', ?, ?, ?)
        `).bind(property.id, platform, result.added, result.updated, result.cancelled).run()

      } catch (err) {
        await env.DB.prepare(`
          INSERT INTO ical_sync_logs (property_id, platform, status, error_message)
          VALUES (?, ?, 'error', ?)
        `).bind(property.id, platform, String(err)).run()
      }
    }
  }
}

/**
 * 毎日のタスク処理
 * cron: '0 8 * * *' → 清掃タスク発行
 * cron: '0 23 * * *' → 翌日チェックイン確認
 */
export async function handleDailyTasks(env: Env, cron: string): Promise<void> {
  const today = todayJST()

  if (cron === '0 8 * * *') {
    // 当日チェックアウト → 清掃タスク自動発行
    const checkouts = await env.DB
      .prepare(`
        SELECT r.id, r.property_id, r.checkout_date, r.checkout_time,
               p.name AS property_name, p.checkout_time AS default_checkout_time
        FROM reservations r
        JOIN properties p ON p.id = r.property_id
        WHERE r.checkout_date = ? AND r.status = 'confirmed'
      `)
      .bind(today)
      .all<{ id: string; property_id: string; property_name: string; checkout_time: string | null; default_checkout_time: string }>()

    for (const checkout of checkouts.results) {
      await dispatchCleaningTask(env, checkout)
    }

    // チェックインステータス更新（昨日チェックインした予約）
    await env.DB
      .prepare(`UPDATE reservations SET status = 'checked_in', updated_at = datetime('now') WHERE checkin_date = ? AND status = 'confirmed'`)
      .bind(yesterday())
      .run()
  }

  if (cron === '0 23 * * *') {
    // 翌日チェックイン → オーナーへ確認通知
    const tomorrow = addDays(today, 1)
    const checkins = await env.DB
      .prepare(`
        SELECT r.*, p.name AS property_name
        FROM reservations r
        JOIN properties p ON p.id = r.property_id
        WHERE r.checkin_date = ? AND r.status IN ('confirmed', 'checked_in')
      `)
      .bind(tomorrow)
      .all<{ guest_name: string | null; guest_count: number; property_name: string; checkin_time: string | null }>()

    if (checkins.results.length > 0) {
      const lines = checkins.results.map(r =>
        `・${r.property_name}｜${r.guest_name ?? 'ゲスト'}様 ${r.guest_count}名 ${r.checkin_time ?? ''}`
      )
      const text = `【明日のチェックイン】\n${formatDateJa(tomorrow)}\n\n${lines.join('\n')}`
      // オーナーLINEへ通知（LINE_STAFF_ACCESS_TOKEN の owner グループへ）
      const ownerLineId = await env.KV.get('owner_line_user_id')
      if (ownerLineId) {
        await pushText(ownerLineId, text, env.LINE_STAFF_ACCESS_TOKEN)
      }
    }
  }
}

/**
 * 毎週月曜: スタッフへシフト希望収集メッセージを送信
 */
export async function handleWeeklyShift(env: Env): Promise<void> {
  const nextMonday = getNextMonday()
  const nextSunday = addDays(nextMonday, 6)

  const staff = await env.DB
    .prepare('SELECT id, line_user_id, name FROM staff WHERE is_active = 1')
    .all<{ id: string; line_user_id: string; name: string }>()

  const text = `【シフト希望収集】\n来週（${formatDateJa(nextMonday)}〜${formatDateJa(nextSunday)}）の希望を入力してください。\n\nカレンダーを開いて、対応可能な日付と時間帯を選択してください。`
  const liffUrl = `https://liff.line.me/${env.LIFF_ID}?week=${nextMonday}`

  await env.KV.put('shift_collection_active', 'true', { expirationTtl: 60 * 60 * 24 * 7 })
  await env.KV.put('shift_collection_week_start', nextMonday, { expirationTtl: 60 * 60 * 24 * 7 })

  for (const s of staff.results) {
    await pushText(s.line_user_id, text, env.LINE_STAFF_ACCESS_TOKEN)
    await pushButtonLink(
      s.line_user_id,
      `来週（${formatDateJa(nextMonday)}〜${formatDateJa(nextSunday)}）のシフト希望を入力してください。`,
      'カレンダーを開く',
      liffUrl,
      env.LINE_STAFF_ACCESS_TOKEN
    )
  }
}

export async function handleDailyReport(env: Env): Promise<void> {
  const recipients = await getManagerLineUserIds(env)
  if (recipients.length === 0) return

  const today = todayJST()
  const tomorrow = addDays(today, 1)

  const [todayCheckins, todayCheckouts, tomorrowCheckins, incompleteShifts] = await Promise.all([
    countByDate(env, 'checkin_date', today),
    countByDate(env, 'checkout_date', today),
    countByDate(env, 'checkin_date', tomorrow),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM shifts WHERE status NOT IN ('completed', 'cancelled')`).first<{ count: number }>(),
  ])

  const warnings = await getAnnualDayWarnings(env)
  const warningText = warnings.length > 0
    ? `\n\n【180日カウント警告】\n${warnings.map((row) => `⚠️ ${row.property_name}: ${row.days_used}/${row.annual_day_limit}日（残り${row.annual_day_limit - row.days_used}日）`).join('\n')}`
    : ''

  const text = [
    '【日次レポート】',
    formatDateJa(today),
    '',
    `本日のチェックイン: ${todayCheckins}件`,
    `本日のチェックアウト: ${todayCheckouts}件`,
    `明日のチェックイン予定: ${tomorrowCheckins}件`,
    `未完了シフト: ${incompleteShifts?.count ?? 0}件`,
  ].join('\n') + warningText

  await multicastText(recipients, text, env.LINE_STAFF_ACCESS_TOKEN)
}

export async function handleWeeklyReport(env: Env): Promise<void> {
  const recipients = await getManagerLineUserIds(env)
  if (recipients.length === 0) return

  const thisMonday = mondayOfWeek(todayJST())
  const lastMonday = addDays(thisMonday, -7)
  const lastSunday = addDays(thisMonday, -1)
  const thisSunday = addDays(thisMonday, 6)

  const [lastWeekReservations, currentWeekReservations, revenueRow, annualRows] = await Promise.all([
    env.DB.prepare(`
      SELECT checkin_date, checkout_date
      FROM reservations
      WHERE status NOT IN ('cancelled', 'blocked')
        AND checkin_date <= ?
        AND checkout_date > ?
    `).bind(lastSunday, lastMonday).all<{ checkin_date: string; checkout_date: string }>(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM reservations
      WHERE status NOT IN ('cancelled', 'blocked')
        AND checkin_date <= ?
        AND checkout_date > ?
    `).bind(thisSunday, thisMonday).first<{ count: number }>(),
    env.DB.prepare(`
      SELECT
        COUNT(*) AS reservation_count,
        COALESCE(SUM(gross_amount), 0) AS gross_amount
      FROM reservations
      WHERE status NOT IN ('cancelled', 'blocked')
        AND checkin_date <= ?
        AND checkout_date > ?
    `).bind(lastSunday, lastMonday).first<{ reservation_count: number; gross_amount: number }>(),
    env.DB.prepare(`
      SELECT p.id AS property_id, p.name AS property_name, p.annual_day_limit,
             COALESCE(a.days_used, 0) AS days_used
      FROM properties p
      LEFT JOIN annual_days_used a
        ON a.property_id = p.id AND a.year = ?
      ORDER BY p.name ASC
    `).bind(Number.parseInt(thisMonday.slice(0, 4), 10)).all<{ property_id: string; property_name: string; annual_day_limit: number; days_used: number }>(),
  ])

  const occupiedDays = buildOccupiedDateSet(lastWeekReservations.results, lastMonday, lastSunday).size
  const occupancyRate = Math.round((occupiedDays / 7) * 1000) / 10
  const annualText = annualRows.results
    .map((row) => `・${row.property_name}: ${Math.round((row.days_used / row.annual_day_limit) * 1000) / 10}%`)
    .join('\n')

  const text = [
    '【週次レポート】',
    `${formatDateJa(lastMonday)}〜${formatDateJa(lastSunday)}`,
    '',
    `先週の予約数: ${revenueRow?.reservation_count ?? 0}件`,
    `先週の売上合計: ¥${Number(revenueRow?.gross_amount ?? 0).toLocaleString('ja-JP')}`,
    `今週の予約数: ${currentWeekReservations?.count ?? 0}件`,
    `先週の稼働率: ${occupancyRate}%`,
    '',
    '【物件ごとの180日消化率】',
    annualText || '該当データなし',
  ].join('\n')

  await multicastText(recipients, text, env.LINE_STAFF_ACCESS_TOKEN)
}

// ─── 内部ユーティリティ ──────────────────────────────────

interface CheckoutInfo {
  id: string
  property_id: string
  property_name: string
  checkout_time: string | null
  default_checkout_time: string
}

async function dispatchCleaningTask(env: Env, checkout: CheckoutInfo): Promise<void> {
  // 担当物件のスタッフを取得
  const staff = await env.DB
    .prepare(`
      SELECT s.id, s.line_user_id, s.name
      FROM staff s
      JOIN staff_properties sp ON sp.staff_id = s.id
      WHERE sp.property_id = ? AND s.role IN ('cleaner', 'manager') AND s.is_active = 1
    `)
    .bind(checkout.property_id)
    .all<{ id: string; line_user_id: string; name: string }>()

  if (staff.results.length === 0) return

  const checkoutTime = checkout.checkout_time ?? checkout.default_checkout_time
  const text = `【清掃依頼】\n📍 ${checkout.property_name}\n📅 本日 ${checkoutTime}以降\n⏱ 完了したら「完了」と写真を送ってください\n\n承諾→「OK」 辞退→「NG」`

  // 最初のスタッフに打診（NG なら次のスタッフへ）
  const first = staff.results[0]
  await env.DB.prepare(`
    INSERT INTO shifts (staff_id, property_id, reservation_id, task_type, date, status, proposed_by)
    VALUES (?, ?, ?, 'cleaning', ?, 'notified', 'system')
  `).bind(first.id, checkout.property_id, checkout.id, todayJST()).run()

  await pushConfirm(
    first.line_user_id,
    text,
    'OK',
    'NG',
    `action=confirm_shift&property_id=${checkout.property_id}&reservation_id=${checkout.id}&staff_id=${first.id}`,
    `action=decline_shift&property_id=${checkout.property_id}&reservation_id=${checkout.id}&staff_id=${first.id}`,
    env.LINE_STAFF_ACCESS_TOKEN
  )
}

async function detectDoubleBooking(
  db: D1Database,
  propertyId: string
): Promise<Array<{ a: string; b: string; date: string }>> {
  const rows = await db.prepare(`
    SELECT a.id AS a, b.id AS b, a.checkin_date AS date
    FROM reservations a
    JOIN reservations b ON
      a.property_id = b.property_id AND
      a.id < b.id AND
      a.checkin_date < b.checkout_date AND
      b.checkin_date < a.checkout_date
    WHERE a.property_id = ?
      AND a.status NOT IN ('cancelled', 'blocked')
      AND b.status NOT IN ('cancelled', 'blocked')
  `).bind(propertyId).all<{ a: string; b: string; date: string }>()
  return rows.results
}

async function notifyDoubleBooking(
  env: Env,
  propertyName: string,
  doubles: Array<{ a: string; b: string; date: string }>
): Promise<void> {
  const ownerLineId = await env.KV.get('owner_line_user_id')
  if (!ownerLineId) return
  const text = `⚠️ ダブルブッキング検知\n${propertyName}\n\n${doubles.map(d => `・${formatDateJa(d.date)} 付近`).join('\n')}\n\n管理画面で確認してください。`
  await pushText(ownerLineId, text, env.LINE_STAFF_ACCESS_TOKEN)
}

async function getManagerLineUserIds(env: Env): Promise<string[]> {
  const rows = await env.DB
    .prepare(`
      SELECT DISTINCT line_user_id
      FROM staff
      WHERE is_active = 1
        AND role = 'manager'
        AND line_user_id IS NOT NULL
        AND line_user_id != ''
    `)
    .all<{ line_user_id: string }>()

  return rows.results.map((row) => row.line_user_id)
}

async function countByDate(env: Env, column: 'checkin_date' | 'checkout_date', date: string): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS count FROM reservations WHERE ${column} = ? AND status NOT IN ('cancelled', 'blocked')`)
    .bind(date)
    .first<{ count: number }>()
  return row?.count ?? 0
}

async function getAnnualDayWarnings(env: Env): Promise<Array<{ property_name: string; annual_day_limit: number; days_used: number; rate: number }>> {
  const year = Number.parseInt(todayJST().slice(0, 4), 10)
  const rows = await env.DB
    .prepare(`
      SELECT p.name AS property_name, p.annual_day_limit, COALESCE(a.days_used, 0) AS days_used
      FROM properties p
      LEFT JOIN annual_days_used a
        ON a.property_id = p.id AND a.year = ?
      WHERE COALESCE(p.license_type, 'minpaku') = 'minpaku'
      ORDER BY p.name ASC
    `)
    .bind(year)
    .all<{ property_name: string; annual_day_limit: number; days_used: number }>()

  return rows.results
    .map((row) => ({
      ...row,
      rate: Math.round((row.days_used / row.annual_day_limit) * 1000) / 10,
    }))
    .filter((row) => row.annual_day_limit - row.days_used <= 30)
}

function mondayOfWeek(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`)
  const day = date.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + diff)
  return date.toISOString().slice(0, 10)
}

function buildOccupiedDateSet(reservations: Array<{ checkin_date: string; checkout_date: string }>, from: string, to: string): Set<string> {
  const dates = new Set<string>()
  for (const reservation of reservations) {
    const start = reservation.checkin_date > from ? reservation.checkin_date : from
    const end = addDays(reservation.checkout_date, -1) < to ? addDays(reservation.checkout_date, -1) : to
    if (start > end) continue
    for (let date = start; date <= end; date = addDays(date, 1)) {
      dates.add(date)
    }
  }
  return dates
}

// ─── 日付ユーティリティ ───────────────────────────────────

function todayJST(): string {
  return new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')
}

function yesterday(): string {
  return addDays(todayJST(), -1)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function getNextMonday(): string {
  const today = new Date()
  const day = today.getUTCDay()
  const diff = day === 1 ? 7 : (8 - day) % 7
  return addDays(todayJST(), diff)
}
