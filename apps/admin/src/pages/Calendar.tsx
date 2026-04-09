import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import type { DatesSetArg } from '@fullcalendar/core'
import jaLocale from '@fullcalendar/core/locales/ja'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { Property, Reservation } from '../lib/types'

const PLATFORM_COLORS: Record<Reservation['platform'], string> = {
  airbnb: '#dc5d43',
  booking: '#2563eb',
  direct: '#2f855a',
  other: '#7c6f64',
}

export function CalendarPage(): JSX.Element {
  const { token } = useAuth()
  const [properties, setProperties] = useState<Property[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [selected, setSelected] = useState<Reservation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().slice(0, 7))

  useEffect(() => {
    async function load(): Promise<void> {
      if (!token) return

      try {
        const [propertyList, reservationList] = await Promise.all([
          apiFetch<Property[]>('/api/properties', undefined, token),
          apiFetch<Reservation[]>(`/api/reservations?month=${currentMonth}`, undefined, token),
        ])
        setProperties(propertyList)
        setReservations(reservationList)
        setSelected((current) => current ? (reservationList.find((item) => item.id === current.id) ?? null) : null)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'カレンダーの取得に失敗しました。')
      }
    }

    void load()
  }, [token, currentMonth])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">カレンダー</h1>
        <p className="mt-1 text-sm text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#dc5d43]" />Airbnb</span>
          {' '}&nbsp;
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#2563eb]" />Booking.com</span>
          {' '}&nbsp;
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#2f855a]" />直接予約</span>
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <FullCalendar
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            initialDate={`${currentMonth}-01`}
            height="auto"
            locale={jaLocale}
            events={reservations.map((reservation) => ({
              id: reservation.id,
              title: `${propertyName(properties, reservation.property_id)} / ${reservation.guest_name ?? 'ゲスト未設定'}`,
              start: reservation.checkin_date,
              end: reservation.checkout_date,
              color: PLATFORM_COLORS[reservation.platform],
            }))}
            datesSet={(arg: DatesSetArg) => {
              // currentStartは表示開始日（前月末の場合あり）なので、中間日で月を判定
              const mid = new Date((arg.start.getTime() + arg.end.getTime()) / 2)
              const month = `${mid.getFullYear()}-${String(mid.getMonth() + 1).padStart(2, '0')}`
              if (month !== currentMonth) {
                setCurrentMonth(month)
              }
            }}
            eventClick={(info) => {
              const reservation = reservations.find((item) => item.id === info.event.id) ?? null
              setSelected(reservation)
            }}
          />
        </div>

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">予約詳細</h2>
          </div>
          {!selected ? (
            <p className="px-5 py-6 text-sm text-gray-400">カレンダー上の予約をクリックしてください</p>
          ) : (
            <div className="space-y-3 p-5 text-sm">
              <Row label="ゲスト" value={selected.guest_name ?? '未設定'} />
              <Row label="物件" value={propertyName(properties, selected.property_id)} />
              <Row label="日程" value={`${selected.checkin_date} → ${selected.checkout_date}`} />
              <Row label="OTA" value={platformLabel(selected.platform)} />
              <Row label="状態" value={selected.status} />
              {selected.notes && <Row label="メモ" value={selected.notes} />}
              <div className="flex gap-2 pt-3 border-t border-gray-100 mt-3">
                <Link
                  to="/reservations"
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  style={{ backgroundColor: '#06C755' }}
                >
                  予約管理で開く
                </Link>
                <Link
                  to={`/messages?reservation_id=${selected.id}`}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  メッセージ作成
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function propertyName(properties: Property[], propertyId: string): string {
  return properties.find((property) => property.id === propertyId)?.name ?? '不明な物件'
}

function platformLabel(platform: Reservation['platform']): string {
  if (platform === 'airbnb') return 'Airbnb'
  if (platform === 'booking') return 'Booking.com'
  if (platform === 'direct') return '直接予約'
  return 'その他'
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-gray-400">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  )
}
