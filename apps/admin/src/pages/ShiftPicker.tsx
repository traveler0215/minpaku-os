import { useEffect, useMemo, useState } from 'react'
import liff from '@line/liff'
import { cn } from '../lib/utils'

type PresetKey = 'full' | 'morning' | 'afternoon' | 'custom'

interface DaySelection {
  date: string
  enabled: boolean
  preset: PresetKey
  from: string
  to: string
}

interface ShiftRequestPayload {
  line_user_id: string
  week_start_date: string
  available_dates: Array<{ date: string; from: string; to: string }>
}

const PRESETS: Record<PresetKey, { label: string; from: string; to: string }> = {
  full: { label: '終日', from: '09:00', to: '18:00' },
  morning: { label: '午前', from: '09:00', to: '13:00' },
  afternoon: { label: '午後', from: '13:00', to: '18:00' },
  custom: { label: 'カスタム', from: '10:00', to: '18:00' },
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export function ShiftPickerPage(): JSX.Element {
  const weekStartDate = useMemo(() => getWeekStartFromUrl(), [])
  const weekDays = useMemo(() => buildWeekDays(weekStartDate), [weekStartDate])
  const [lineUserId, setLineUserId] = useState('')
  const [days, setDays] = useState<DaySelection[]>(() =>
    buildWeekDays(weekStartDate).map((date) => ({
      date,
      enabled: false,
      preset: 'full',
      from: PRESETS.full.from,
      to: PRESETS.full.to,
    })),
  )
  const [status, setStatus] = useState<'idle' | 'initializing' | 'ready' | 'submitting' | 'submitted' | 'error'>('initializing')
  const [message, setMessage] = useState('LIFF を初期化しています...')

  useEffect(() => {
    let active = true

    async function initialize(): Promise<void> {
      const liffId = import.meta.env.VITE_LIFF_ID
      if (!liffId) {
        if (!active) return
        setStatus('error')
        setMessage('VITE_LIFF_ID が未設定です。')
        return
      }

      try {
        await liff.init({ liffId })
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href })
          return
        }

        const profile = await liff.getProfile()
        if (!active) return
        setLineUserId(profile.userId)
        setStatus('ready')
        setMessage('入力して送信すると LINE トークへ戻ります。')
      } catch (error) {
        console.error('LIFF init failed', error)
        if (!active) return
        setStatus('error')
        setMessage('LIFF の初期化に失敗しました。時間をおいて再度お試しください。')
      }
    }

    void initialize()
    return () => {
      active = false
    }
  }, [])

  const selectedCount = days.filter((day) => day.enabled).length

  async function handleSubmit(): Promise<void> {
    const availableDates = days
      .filter((day) => day.enabled)
      .map((day) => ({ date: day.date, from: day.from, to: day.to }))

    if (!lineUserId) {
      setStatus('error')
      setMessage('LINE ユーザー情報を取得できませんでした。')
      return
    }

    if (availableDates.length === 0) {
      setStatus('error')
      setMessage('少なくとも1日選択してください。')
      return
    }

    const invalidSlot = availableDates.find((slot) => !slot.from || !slot.to || slot.from >= slot.to)
    if (invalidSlot) {
      setStatus('error')
      setMessage('時間帯の入力を確認してください。開始時間は終了時間より前である必要があります。')
      return
    }

    setStatus('submitting')
    setMessage('送信しています...')

    const payload: ShiftRequestPayload = {
      line_user_id: lineUserId,
      week_start_date: weekStartDate,
      available_dates: availableDates,
    }

    try {
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
      const response = await fetch(`${apiBaseUrl}/api/shift-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = (await response.json()) as { success: boolean; error?: string }
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? '送信に失敗しました。')
      }

      setStatus('submitted')
      setMessage('送信しました。LINE トークへ戻ります。')
      window.setTimeout(() => {
        if (liff.isInClient()) {
          liff.closeWindow()
        }
      }, 900)
    } catch (error) {
      console.error('shift request submit failed', error)
      setStatus('error')
      setMessage(error instanceof Error ? error.message : '送信に失敗しました。')
    }
  }

  const isSubmitting = status === 'initializing' || status === 'submitting'

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 pt-6 pb-12 sm:px-6">
      <section className="w-full">
        <div className="mb-5 flex items-center justify-between px-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Shift Picker</p>
            <h1 className="mt-1 text-2xl font-extrabold text-gray-900 sm:text-3xl">来週のシフト希望</h1>
          </div>
          <div className="rounded-full border border-gray-200 bg-white px-4 py-2 text-right shadow-sm">
            <p className="text-xs text-gray-500">対象週</p>
            <p className="text-sm font-semibold text-gray-900">{formatRange(weekDays[0], weekDays[6])}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 p-5">
            <h2 className="text-lg font-bold text-gray-900">希望ありの日だけチェックしてください</h2>
            <p className="mt-1 text-sm text-gray-500">
              プリセットで時短入力できます。{selectedCount > 0 ? `${selectedCount}日を選択中です。` : '未選択です。'}
            </p>
          </div>
          <div className="space-y-4 p-4 sm:p-6">
            {days.map((day) => (
              <article
                key={day.date}
                className={cn(
                  'rounded-xl border p-4 transition',
                  day.enabled ? 'border-[#06C755] bg-green-50/40 ring-2 ring-[#06C755]/25' : 'border-gray-200 bg-white',
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 rounded border-gray-300 text-[#06C755] focus:ring-[#06C755]"
                      checked={day.enabled}
                      onChange={(event) =>
                        setDays((current) =>
                          current.map((item) =>
                            item.date === day.date ? { ...item, enabled: event.target.checked } : item,
                          ),
                        )
                      }
                    />
                    <span>
                      <span className="block text-lg font-bold text-gray-900">
                        {formatDayLabel(day.date)}
                      </span>
                      <span className="text-sm text-gray-500">{day.enabled ? '時間帯を設定できます' : '休みの場合はオフのままでOK'}</span>
                    </span>
                  </label>

                  <select
                    className="h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                    value={day.preset}
                    disabled={!day.enabled}
                    onChange={(event) => {
                      const nextPreset = event.target.value as PresetKey
                      setDays((current) =>
                        current.map((item) =>
                          item.date === day.date
                            ? {
                                ...item,
                                preset: nextPreset,
                                from: PRESETS[nextPreset].from,
                                to: PRESETS[nextPreset].to,
                              }
                            : item,
                        ),
                      )
                    }}
                  >
                    {Object.entries(PRESETS).map(([key, preset]) => (
                      <option key={key} value={key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <input
                    type="time"
                    className="h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                    value={day.from}
                    disabled={!day.enabled}
                    onChange={(event) =>
                      setDays((current) =>
                        current.map((item) => (item.date === day.date ? { ...item, from: event.target.value, preset: 'custom' } : item)),
                      )
                    }
                  />
                  <span className="hidden text-center text-sm text-gray-500 sm:block">〜</span>
                  <input
                    type="time"
                    className="h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                    value={day.to}
                    disabled={!day.enabled}
                    onChange={(event) =>
                      setDays((current) =>
                        current.map((item) => (item.date === day.date ? { ...item, to: event.target.value, preset: 'custom' } : item)),
                      )
                    }
                  />
                </div>
              </article>
            ))}

            <div className={cn(
              'rounded-lg border p-4 text-sm',
              status === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50 text-gray-600',
            )}>
              <p className="font-medium">{message}</p>
            </div>

            {/* 送信ボタン（インライン） */}
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting}
              className="h-14 w-full rounded-lg text-base font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {status === 'submitting' ? '送信中...' : status === 'submitted' ? '送信しました' : `送信する${selectedCount > 0 ? `（${selectedCount}日）` : ''}`}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

function buildWeekDays(weekStartDate: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStartDate, index))
}

function getWeekStartFromUrl(): string {
  const value = new URLSearchParams(window.location.search).get('week')
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  return getNextMonday()
}

function getNextMonday(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 1 ? 7 : (8 - day) % 7
  now.setDate(now.getDate() + diff)
  return toDateString(now)
}

function addDays(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00+09:00`)
  base.setDate(base.getDate() + days)
  return toDateString(base)
}

function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDayLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00+09:00`)
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[date.getDay()]})`
}

function formatRange(startDate: string, endDate: string): string {
  return `${formatDayLabel(startDate)}〜${formatDayLabel(endDate)}`
}
