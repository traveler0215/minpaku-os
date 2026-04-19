import type { Env, Reservation } from '../types'

interface IcalReservation extends Reservation {
  property_name: string
}

export async function handleIcalFeed(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/ical\/([^/]+)\.ics$/)
  const propertyId = match?.[1]
  if (!propertyId) return new Response('Not Found', { status: 404 })

  const property = await env.DB
    .prepare('SELECT id, name FROM properties WHERE id = ?')
    .bind(propertyId)
    .first<{ id: string; name: string }>()
  if (!property) return new Response('Not Found', { status: 404 })

  const rows = await env.DB
    .prepare(`
      SELECT r.*, p.name AS property_name
      FROM reservations r
      JOIN properties p ON p.id = r.property_id
      WHERE r.property_id = ?
        AND r.status IN ('confirmed', 'completed', 'blocked')
      ORDER BY r.checkin_date ASC
    `)
    .bind(propertyId)
    .all<IcalReservation>()

  const now = formatTimestamp(new Date())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//minpaku-os//Inventory Feed//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...rows.results.flatMap((reservation) => [
      'BEGIN:VEVENT',
      `UID:${escapeIcal(`${reservation.id}@minpaku-os`)}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${reservation.checkin_date.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${reservation.checkout_date.replace(/-/g, '')}`,
      'SUMMARY:Reserved',
      `STATUS:${reservation.status === 'blocked' ? 'CONFIRMED' : 'CONFIRMED'}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ]

  return new Response(lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}

function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  const second = String(date.getUTCSeconds()).padStart(2, '0')
  return `${year}${month}${day}T${hour}${minute}${second}Z`
}

function escapeIcal(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}
