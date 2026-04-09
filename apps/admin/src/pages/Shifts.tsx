import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { Property, Shift, Staff } from '../lib/types'

type ShiftRow = Shift & {
  staff_name?: string
  property_name?: string
}

const STATUS_BADGE: Record<Shift['status'], string> = {
  proposed: 'bg-amber-100 text-amber-700',
  notified: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-green-100 text-green-700',
  declined: 'bg-rose-100 text-rose-700',
  completed: 'bg-gray-200 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

const TASK_LABEL: Record<Shift['task_type'], string> = {
  cleaning: '清掃',
  checkin: 'チェックイン',
  checkout: 'チェックアウト',
  inspection: '点検',
}

export function ShiftsPage(): JSX.Element {
  const { token } = useAuth()
  const [staff, setStaff] = useState<Staff[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const weekStart = getWeekStart()

  async function load(): Promise<void> {
    if (!token) return

    try {
      setError(null)
      const [staffList, propertyList, shiftList] = await Promise.all([
        apiFetch<Staff[]>('/api/staff', undefined, token),
        apiFetch<Property[]>('/api/properties', undefined, token),
        apiFetch<ShiftRow[]>(`/api/shifts?week=${weekStart}`, undefined, token).catch(() => []),
      ])
      setStaff(staffList)
      setProperties(propertyList)
      setShifts(shiftList)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'シフト一覧の取得に失敗しました。')
    }
  }

  useEffect(() => {
    void load()
  }, [token, weekStart])

  async function handlePropose(): Promise<void> {
    if (!token) return

    try {
      setError(null)
      setMessage(null)
      await apiFetch('/api/shifts/propose', { method: 'POST' }, token)
      setMessage('シフト提案を作成しました。')
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'シフト提案に失敗しました。')
    }
  }

  async function handleConfirmAll(): Promise<void> {
    if (!token) return

    try {
      setError(null)
      setMessage(null)
      await apiFetch(`/api/shifts/confirm-all?week=${weekStart}`, { method: 'POST' }, token)
      setMessage('提案済みシフトを確定しました。')
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '一括確定に失敗しました。')
    }
  }

  async function updateShiftStatus(shiftId: string, status: Shift['status']): Promise<void> {
    if (!token) return

    try {
      setError(null)
      setMessage(null)
      await apiFetch(`/api/shifts/${shiftId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }, token)
      setMessage(status === 'completed' ? 'シフトを完了に更新しました。' : 'シフトを確定しました。')
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'シフト更新に失敗しました。')
    }
  }

  const proposedCount = shifts.filter((shift) => shift.status === 'proposed').length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">シフト管理</h1>
          <p className="mt-1 text-sm text-gray-500">{weekStart} 開始週の清掃・対応予定を管理します</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleConfirmAll()}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            提案を一括確定
          </button>
          <button
            type="button"
            onClick={() => void handlePropose()}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            シフト提案
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="今週のシフト" value={shifts.length} />
        <SummaryCard label="提案待ち" value={proposedCount} />
        <SummaryCard label="稼働スタッフ" value={new Set(shifts.map((shift) => shift.staff_id)).size || staff.length} />
      </div>

      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">スタッフ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">物件</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">日付</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">タスク</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">時間</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">状態</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">アクション</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shifts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">この週のシフトはまだありません</td>
                </tr>
              ) : shifts.map((shift) => (
                <tr key={shift.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{shift.staff_name ?? staff.find((member) => member.id === shift.staff_id)?.name ?? '未設定'}</p>
                    <p className="text-xs text-gray-400">{shift.staff_id}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {shift.property_name ?? properties.find((property) => property.id === shift.property_id)?.name ?? '未設定'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(shift.date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{TASK_LABEL[shift.task_type]}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatTimeRange(shift.start_time, shift.end_time)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[shift.status]}`}>
                      {shift.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {shift.status === 'proposed' && (
                        <button
                          type="button"
                          onClick={() => void updateShiftStatus(shift.id, 'confirmed')}
                          className="rounded-lg px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                          style={{ backgroundColor: '#06C755' }}
                        >
                          確定
                        </button>
                      )}
                      {shift.status !== 'completed' && shift.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => void updateShiftStatus(shift.id, 'completed')}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          完了
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
    </div>
  )
}

function getWeekStart(): string {
  const now = new Date()
  const date = new Date(now)
  const diff = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - diff)
  return date.toISOString().slice(0, 10)
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00`))
}

function formatTimeRange(startTime: string | null, endTime: string | null): string {
  if (!startTime && !endTime) return '未設定'
  return `${startTime ?? '--:--'} - ${endTime ?? '--:--'}`
}
