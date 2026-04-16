import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import type { DatesSetArg } from '@fullcalendar/core'
import jaLocale from '@fullcalendar/core/locales/ja'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { Property, Reservation, Staff, Shift } from '../lib/types'

// 時間選択肢（30分刻み）
const TIME_OPTIONS = Array.from({ length: 33 }, (_, i) => {
  const h = Math.floor((i + 14) / 2)  // 07:00 start
  const m = (i + 14) % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
}).filter((t) => t >= '07:00' && t <= '23:00')

// 物件ごとに割り当てる色パレット（視認性の高い8色）
const PROPERTY_COLORS = [
  '#2563eb', // blue
  '#dc5d43', // red-orange
  '#2f855a', // green
  '#9333ea', // purple
  '#d97706', // amber
  '#0891b2', // cyan
  '#e11d48', // rose
  '#4f46e5', // indigo
]

function getPropertyColor(properties: Property[], propertyId: string): string {
  const index = properties.findIndex((p) => p.id === propertyId)
  if (index === -1) return '#7c6f64'
  return PROPERTY_COLORS[index % PROPERTY_COLORS.length]
}

function eventColor(reservation: Reservation, properties: Property[]): string {
  if (reservation.status === 'blocked') return '#9ca3af'     // グレー
  if (reservation.status === 'cancelled') return '#d1d5db'   // 薄いグレー
  return getPropertyColor(properties, reservation.property_id)
}

function eventTitle(reservation: Reservation, propName: string): string {
  if (reservation.status === 'blocked') return `🔒 ${propName} / ブロック`
  if (reservation.status === 'cancelled') return `✕ ${propName} / キャンセル`
  return `${propName} / ${platformLabel(reservation.platform)}`
}

export function CalendarPage(): JSX.Element {
  const { token } = useAuth()
  const [properties, setProperties] = useState<Property[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [selected, setSelected] = useState<Reservation | null>(null)
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().slice(0, 7))
  const [isDeletingReservation, setIsDeletingReservation] = useState(false)
  const [shiftStaffId, setShiftStaffId] = useState('')
  const [shiftTaskType, setShiftTaskType] = useState<Shift['task_type']>('cleaning')
  const [shiftStartTime, setShiftStartTime] = useState('')
  const [shiftEndTime, setShiftEndTime] = useState('')
  const [isSendingShift, setIsSendingShift] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      if (!token) return

      try {
        const [propertyList, reservationList, staffResult] = await Promise.all([
          apiFetch<Property[]>('/api/properties', undefined, token),
          apiFetch<Reservation[]>(`/api/reservations?month=${currentMonth}`, undefined, token),
          apiFetch<Staff[]>('/api/staff', undefined, token),
        ])
        setProperties(propertyList)
        setReservations(reservationList)
        setStaffList(staffResult.filter((s) => s.is_active === 1))
        setSelected((current) => current ? (reservationList.find((item) => item.id === current.id) ?? null) : null)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'カレンダーの取得に失敗しました。')
      }
    }

    void load()
  }, [token, currentMonth])

  async function handleDeleteReservation(reservation: Reservation): Promise<void> {
    if (!token || !window.confirm(`この予約を削除しますか？\n${propertyName(properties, reservation.property_id)} / ${reservation.guest_name ?? 'ゲスト未設定'}\n${reservation.checkin_date} → ${reservation.checkout_date}`)) return
    setIsDeletingReservation(true)
    setError(null)
    setMessage(null)
    try {
      await apiFetch(`/api/reservations/${reservation.id}`, { method: 'DELETE' }, token)
      setMessage('予約を削除しました')
      setSelected(null)
      setReservations((prev) => prev.filter((r) => r.id !== reservation.id))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '予約の削除に失敗しました')
    } finally {
      setIsDeletingReservation(false)
    }
  }

  async function handleSendShift(reservation: Reservation): Promise<void> {
    if (!token || !shiftStaffId) return
    setIsSendingShift(true)
    setError(null)
    setMessage(null)
    try {
      await apiFetch<Shift>('/api/shifts', {
        method: 'POST',
        body: JSON.stringify({
          staff_id: shiftStaffId,
          property_id: reservation.property_id,
          reservation_id: reservation.id,
          task_type: shiftTaskType,
          date: shiftTaskType === 'cleaning' ? reservation.checkout_date : reservation.checkin_date,
          start_time: shiftStartTime || null,
          end_time: shiftEndTime || null,
          status: 'notified',
          notify: true,
        }),
      }, token)
      setMessage('シフト確認をLINEで送信しました')
      setShiftStaffId('')
      setShiftStartTime('')
      setShiftEndTime('')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'シフト依頼の送信に失敗しました')
    } finally {
      setIsSendingShift(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">カレンダー</h1>
        <p className="mt-1 text-sm text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
          {properties.map((p, i) => (
            <span key={p.id} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: PROPERTY_COLORS[i % PROPERTY_COLORS.length] }} />
              {p.name}
            </span>
          ))}
        </p>
      </div>

      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <FullCalendar
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            initialDate={`${currentMonth}-01`}
            height="auto"
            locale={jaLocale}
            events={reservations
              .filter((r) => r.status !== 'cancelled')
              .map((reservation) => ({
                id: reservation.id,
                title: eventTitle(reservation, propertyName(properties, reservation.property_id)),
                start: reservation.checkin_date,
                end: reservation.checkout_date,
                color: eventColor(reservation, properties),
                ...(reservation.status === 'blocked' ? { display: 'background' } : {}),
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
              <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100 mt-3">
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
                <button
                  type="button"
                  disabled={isDeletingReservation}
                  onClick={() => void handleDeleteReservation(selected)}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {isDeletingReservation ? '削除中...' : '削除'}
                </button>
              </div>

              {selected.status !== 'blocked' && selected.status !== 'cancelled' && (
                <div className="pt-3 border-t border-gray-100 mt-3 space-y-2 overflow-hidden">
                  <p className="text-xs font-semibold text-gray-700">シフト依頼</p>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                    value={shiftStaffId}
                    onChange={(e) => setShiftStaffId(e.target.value)}
                  >
                    <option value="">スタッフを選択</option>
                    {staffList
                      .filter((s) => !s.property_ids || s.property_ids.length === 0 || s.property_ids.includes(selected.property_id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>{s.name}（{s.role === 'cleaner' ? '清掃' : s.role === 'checkin' ? 'チェックイン' : 'マネージャー'}）</option>
                      ))}
                  </select>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                    value={shiftTaskType}
                    onChange={(e) => setShiftTaskType(e.target.value as Shift['task_type'])}
                  >
                    <option value="cleaning">清掃</option>
                    <option value="checkin">チェックイン</option>
                    <option value="checkout">チェックアウト</option>
                    <option value="inspection">点検</option>
                  </select>
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-gray-700">開始</span>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                      value={shiftStartTime}
                      onChange={(e) => setShiftStartTime(e.target.value)}
                    >
                      <option value="">未設定</option>
                      {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-gray-700">終了</span>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                      value={shiftEndTime}
                      onChange={(e) => setShiftEndTime(e.target.value)}
                    >
                      <option value="">未設定</option>
                      {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={!shiftStaffId || isSendingShift}
                    onClick={() => void handleSendShift(selected)}
                    className="w-full rounded-lg px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    {isSendingShift ? '送信中...' : 'LINEで確認を送信'}
                  </button>
                </div>
              )}
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
  if (platform === 'direct') return '自社HP'
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
