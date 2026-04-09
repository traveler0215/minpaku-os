/**
 * iCal フィードのパース・同期ロジック
 * Airbnb / Booking.com の iCal フィードを取得し D1 に差分反映する
 */

import type { Env, Reservation } from '../types'

interface ICalEvent {
  uid: string
  summary: string   // "CLOSED" | "Airbnb (HXXXXXX)" | "Reserved"
  dtstart: string   // YYYYMMDD or YYYYMMDDTHHMMSSZ
  dtend: string
  status?: string   // "CONFIRMED" | "CANCELLED" | "TENTATIVE"
  description?: string
}

/**
 * iCal テキストをパースしてイベント配列を返す
 */
export function parseIcal(text: string): ICalEvent[] {
  const events: ICalEvent[] = []
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // 継続行（先頭スペース）を結合
  const unfolded: string[] = []
  for (const line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (unfolded.length > 0) unfolded[unfolded.length - 1] += line.slice(1)
    } else {
      unfolded.push(line)
    }
  }

  let current: Partial<ICalEvent> | null = null
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') {
      current = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (current?.uid && current.dtstart && current.dtend) {
        events.push(current as ICalEvent)
      }
      current = null
      continue
    }
    if (!current) continue

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).split(';')[0].toUpperCase()
    const value = line.slice(colonIdx + 1).trim()

    switch (key) {
      case 'UID':         current.uid = value; break
      case 'SUMMARY':     current.summary = value; break
      case 'DTSTART':     current.dtstart = normalizeDate(value); break
      case 'DTEND':       current.dtend = normalizeDate(value); break
      case 'STATUS':      current.status = value; break
      case 'DESCRIPTION': current.description = value; break
    }
  }
  return events
}

/**
 * 日付文字列を YYYY-MM-DD に正規化
 * 対応形式: YYYYMMDD, YYYYMMDDTHHMMSSZ
 */
function normalizeDate(value: string): string {
  const d = value.replace(/T.*/, '').replace(/-/g, '')
  if (d.length === 8) {
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  }
  return value
}

/**
 * iCal フィードを取得してパース
 */
export async function fetchIcal(url: string): Promise<ICalEvent[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'minpaku-os/1.0' },
  })
  if (!res.ok) throw new Error(`iCal fetch failed: ${res.status} ${url}`)
  const text = await res.text()
  return parseIcal(text)
}

/**
 * iCal イベントの summary から platform を推定
 */
export function inferPlatform(summary: string, url: string): Reservation['platform'] {
  const s = summary.toLowerCase()
  if (s.includes('airbnb') || url.includes('airbnb')) return 'airbnb'
  if (s.includes('booking') || url.includes('booking')) return 'booking'
  return 'other'
}

/**
 * iCal イベントをDBの予約レコードに変換
 */
export function icalEventToReservation(
  event: ICalEvent,
  propertyId: string,
  platform: Reservation['platform']
): Omit<Reservation, 'id' | 'created_at' | 'updated_at'> {
  const isCancelled =
    event.status === 'CANCELLED' ||
    event.summary.toUpperCase().includes('CANCELLED')
  const isBlocked =
    event.summary.toUpperCase() === 'CLOSED' ||
    event.summary.toUpperCase().includes('BLOCKED') ||
    event.summary.toUpperCase().includes('NOT AVAILABLE')

  return {
    property_id: propertyId,
    platform,
    external_id: event.uid,
    guest_name: isBlocked ? null : extractGuestName(event.summary),
    guest_email: null,
    guest_count: 1,
    checkin_date: event.dtstart,
    checkout_date: event.dtend,
    checkin_time: null,
    checkout_time: null,
    gross_amount: null,
    net_amount: null,
    ota_fee_amount: null,
    status: isCancelled ? 'cancelled' : isBlocked ? 'blocked' : 'confirmed',
    notes: event.description ?? null,
    raw_ical_data: JSON.stringify(event),
  }
}

function extractGuestName(summary: string): string | null {
  // Airbnb: "Reserved" or "Airbnb (HXXXXXX)"
  // Booking.com: "CLOSED - XXXXXXXXXXX"
  if (!summary || summary.toUpperCase() === 'RESERVED') return null
  const match = summary.match(/\(([^)]+)\)/)
  if (match) return match[1]
  return summary
}

/**
 * 1物件分の iCal 同期を実行する
 * 追加・更新・キャンセル件数を返す
 */
export async function syncPropertyIcal(
  db: D1Database,
  propertyId: string,
  icalUrl: string,
  platform: Reservation['platform']
): Promise<{ added: number; updated: number; cancelled: number }> {
  const events = await fetchIcal(icalUrl)
  let added = 0, updated = 0, cancelled = 0

  for (const event of events) {
    const reservation = icalEventToReservation(event, propertyId, platform)
    const existing = await db
      .prepare('SELECT id, status, raw_ical_data FROM reservations WHERE property_id = ? AND external_id = ?')
      .bind(propertyId, event.uid)
      .first<{ id: string; status: string; raw_ical_data: string | null }>()

    if (!existing) {
      await db
        .prepare(`
          INSERT INTO reservations
            (property_id, platform, external_id, guest_name, guest_email, guest_count,
             checkin_date, checkout_date, status, notes, raw_ical_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          reservation.property_id,
          reservation.platform,
          reservation.external_id,
          reservation.guest_name,
          reservation.guest_email,
          reservation.guest_count,
          reservation.checkin_date,
          reservation.checkout_date,
          reservation.status,
          reservation.notes,
          reservation.raw_ical_data
        )
        .run()
      added++
    } else if (existing.raw_ical_data !== reservation.raw_ical_data) {
      // 変更あり → 更新
      await db
        .prepare(`
          UPDATE reservations
          SET checkin_date = ?, checkout_date = ?, status = ?,
              guest_name = ?, notes = ?, raw_ical_data = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(
          reservation.checkin_date,
          reservation.checkout_date,
          reservation.status,
          reservation.guest_name,
          reservation.notes,
          reservation.raw_ical_data,
          existing.id
        )
        .run()
      if (reservation.status === 'cancelled') cancelled++
      else updated++
    }
  }

  return { added, updated, cancelled }
}
