import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { Property, Shift, Staff } from '../lib/types'

type ShiftRow = Shift & {
  staff_name?: string
  property_name?: string
}

interface ShiftRequestRow {
  id: string
  staff_id: string
  staff_name: string
  staff_role: string
  week_start_date: string
  available_dates: string[]
  available_times: Record<string, { from: string; to: string }>
  notes: string | null
  collected_at: string
}

interface ShiftRequestResponse {
  week_start_date: string
  requests: ShiftRequestRow[]
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

const AGENT_ENABLED = import.meta.env.VITE_AGENT_ENABLED === 'true'

interface ShiftFormDraft {
  id: string | null
  staff_id: string
  property_id: string
  task_type: Shift['task_type']
  date: string
  start_time: string
  end_time: string
  notify: boolean
}

const EMPTY_DRAFT: ShiftFormDraft = {
  id: null,
  staff_id: '',
  property_id: '',
  task_type: 'cleaning',
  date: '',
  start_time: '10:00',
  end_time: '14:00',
  notify: true,
}

interface RequestDaySlot {
  date: string
  enabled: boolean
  from: string
  to: string
}

interface ShiftRequestDraft {
  id: string | null
  staff_id: string
  week_start_date: string
  days: RequestDaySlot[]
  notify: boolean
}

function buildEmptyRequestDays(weekStart: string): RequestDaySlot[] {
  return buildWeekDays(weekStart).map((date) => ({
    date,
    enabled: false,
    from: '09:00',
    to: '18:00',
  }))
}

export function ShiftsPage(): JSX.Element {
  const { token } = useAuth()
  const [staff, setStaff] = useState<Staff[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [shiftRequests, setShiftRequests] = useState<ShiftRequestRow[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<ShiftFormDraft | null>(null)
  const [requestDraft, setRequestDraft] = useState<ShiftRequestDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const weekStart = getWeekStart()
  const nextWeekStart = getNextMondayFromWeek(weekStart)

  function openCreateModal(): void {
    setEditDraft({ ...EMPTY_DRAFT, date: weekStart })
    setError(null)
    setMessage(null)
  }

  function openEditModal(shift: ShiftRow): void {
    setEditDraft({
      id: shift.id,
      staff_id: shift.staff_id,
      property_id: shift.property_id,
      task_type: shift.task_type,
      date: shift.date,
      start_time: shift.start_time ?? '10:00',
      end_time: shift.end_time ?? '14:00',
      notify: false,
    })
    setError(null)
    setMessage(null)
  }

  async function handleSaveDraft(): Promise<void> {
    if (!token || !editDraft) return
    if (!editDraft.staff_id || !editDraft.property_id || !editDraft.date) {
      setError('スタッフ・物件・日付は必須です。')
      return
    }
    if (editDraft.start_time >= editDraft.end_time) {
      setError('開始時間は終了時間より前にしてください。')
      return
    }

    setSaving(true)
    try {
      setError(null)
      const body = {
        staff_id: editDraft.staff_id,
        property_id: editDraft.property_id,
        task_type: editDraft.task_type,
        date: editDraft.date,
        start_time: editDraft.start_time,
        end_time: editDraft.end_time,
        notify: editDraft.notify,
      }
      if (editDraft.id) {
        await apiFetch(`/api/shifts/${editDraft.id}`, { method: 'PATCH', body: JSON.stringify(body) }, token)
      } else {
        await apiFetch('/api/shifts', { method: 'POST', body: JSON.stringify(body) }, token)
      }
      setMessage(editDraft.notify ? 'シフトを保存し、LINE通知を送信しました。' : 'シフトを保存しました。')
      setEditDraft(null)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'シフトの保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteShift(shift: ShiftRow): Promise<void> {
    if (!token) return
    if (!window.confirm(`${shift.staff_name ?? 'スタッフ'}の ${formatDate(shift.date)} のシフトを削除しますか？`)) return
    try {
      setError(null)
      await apiFetch(`/api/shifts/${shift.id}`, { method: 'DELETE' }, token)
      setMessage('シフトを削除しました。')
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'シフトの削除に失敗しました。')
    }
  }

  function openRequestCreateModal(): void {
    setRequestDraft({
      id: null,
      staff_id: '',
      week_start_date: nextWeekStart,
      days: buildEmptyRequestDays(nextWeekStart),
      notify: true,
    })
    setError(null)
    setMessage(null)
  }

  function openRequestEditModal(request: ShiftRequestRow): void {
    const days = buildWeekDays(request.week_start_date).map<RequestDaySlot>((date) => {
      const enabled = request.available_dates.includes(date)
      const time = request.available_times[date]
      return {
        date,
        enabled,
        from: time?.from?.slice(0, 5) ?? '09:00',
        to: time?.to?.slice(0, 5) ?? '18:00',
      }
    })
    setRequestDraft({
      id: request.id,
      staff_id: request.staff_id,
      week_start_date: request.week_start_date,
      days,
      notify: true,
    })
    setError(null)
    setMessage(null)
  }

  async function handleSaveRequest(): Promise<void> {
    if (!token || !requestDraft) return
    if (!requestDraft.staff_id) {
      setError('スタッフを選択してください。')
      return
    }
    const availableDates = requestDraft.days
      .filter((day) => day.enabled)
      .map((day) => ({ date: day.date, from: day.from, to: day.to }))
    if (availableDates.length === 0) {
      setError('少なくとも1日は選択してください。')
      return
    }
    const invalid = availableDates.find((d) => d.from >= d.to)
    if (invalid) {
      setError('開始時間は終了時間より前である必要があります。')
      return
    }

    setSaving(true)
    try {
      setError(null)
      await apiFetch('/api/shifts/requests', {
        method: 'POST',
        body: JSON.stringify({
          staff_id: requestDraft.staff_id,
          week_start_date: requestDraft.week_start_date,
          available_dates: availableDates,
          notify: requestDraft.notify,
        }),
      }, token)
      setMessage(requestDraft.notify ? 'シフト希望を保存し、LINE通知を送信しました。' : 'シフト希望を保存しました。')
      setRequestDraft(null)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'シフト希望の保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteRequest(request: ShiftRequestRow): Promise<void> {
    if (!token) return
    if (!window.confirm(`${request.staff_name}のシフト希望を削除しますか？`)) return
    try {
      setError(null)
      await apiFetch(`/api/shifts/requests/${request.id}`, { method: 'DELETE' }, token)
      setMessage('シフト希望を削除しました。')
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'シフト希望の削除に失敗しました。')
    }
  }

  async function load(): Promise<void> {
    if (!token) return

    try {
      setError(null)
      const [staffList, propertyList, shiftList, requestList] = await Promise.all([
        apiFetch<Staff[]>('/api/staff', undefined, token),
        apiFetch<Property[]>('/api/properties', undefined, token),
        apiFetch<ShiftRow[]>(`/api/shifts?week=${weekStart}`, undefined, token).catch(() => []),
        apiFetch<ShiftRequestResponse>(`/api/shifts/requests?week=${nextWeekStart}`, undefined, token).catch(() => ({ week_start_date: nextWeekStart, requests: [] })),
      ])
      setStaff(staffList)
      setProperties(propertyList)
      setShifts(shiftList)
      setShiftRequests(requestList.requests)
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
          {AGENT_ENABLED && (
            <>
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
            </>
          )}
          <button
            type="button"
            onClick={openCreateModal}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            ＋ シフト追加
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

      {/* 来週のシフト希望（LIFF から収集） */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">来週のシフト希望</h2>
            <p className="mt-0.5 text-xs text-gray-500">{nextWeekStart} 週 / LIFF で収集中 ・ {shiftRequests.length} 件</p>
          </div>
          <button
            type="button"
            onClick={openRequestCreateModal}
            className="self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ＋ 希望を追加
          </button>
        </div>
        {shiftRequests.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">
            まだシフト希望は集まっていません。<br />
            <span className="text-xs">毎週月曜09:00にスタッフへ LIFF リンクが自動配信されます。</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">スタッフ</th>
                  {buildWeekDays(nextWeekStart).map((day) => (
                    <th key={day} className="px-3 py-3 text-center text-xs font-semibold text-gray-500 whitespace-nowrap">
                      {formatShortDay(day)}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">送信日時</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">アクション</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shiftRequests.map((request) => (
                  <tr key={request.id} className="hover:bg-gray-50">
                    <td className="sticky left-0 bg-white px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{request.staff_name}</p>
                      <p className="text-xs text-gray-400">{request.staff_role}</p>
                    </td>
                    {buildWeekDays(nextWeekStart).map((day) => {
                      const available = request.available_dates.includes(day)
                      const time = request.available_times[day]
                      return (
                        <td key={day} className="px-3 py-3 text-center text-xs">
                          {available ? (
                            <div className="rounded-md bg-green-100 px-1 py-1 font-medium text-green-700">
                              {time ? `${time.from.slice(0, 5)}〜${time.to.slice(0, 5)}` : '○'}
                            </div>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatCollectedAt(request.collected_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openRequestEditModal(request)}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteRequest(request)}
                          className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 今週の確定シフト */}
      <div>
        <h2 className="mb-2 text-lg font-bold text-gray-900">今週の確定シフト</h2>
      </div>

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
                    <div className="flex flex-wrap justify-end gap-2">
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
                      <button
                        type="button"
                        onClick={() => openEditModal(shift)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteShift(shift)}
                        className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* シフト追加・編集モーダル */}
      {editDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setEditDraft(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                {editDraft.id ? 'シフト編集' : '新しいシフト'}
              </h2>
              <button
                type="button"
                onClick={() => !saving && setEditDraft(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">スタッフ</label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                  value={editDraft.staff_id}
                  onChange={(e) => setEditDraft((d) => d ? { ...d, staff_id: e.target.value } : d)}
                >
                  <option value="">選択してください</option>
                  {staff.filter((m) => m.is_active === 1).map((member) => (
                    <option key={member.id} value={member.id}>{member.name}（{member.role}）</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">物件</label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                  value={editDraft.property_id}
                  onChange={(e) => setEditDraft((d) => d ? { ...d, property_id: e.target.value } : d)}
                >
                  <option value="">選択してください</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>{property.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">タスク種別</label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                  value={editDraft.task_type}
                  onChange={(e) => setEditDraft((d) => d ? { ...d, task_type: e.target.value as Shift['task_type'] } : d)}
                >
                  <option value="cleaning">清掃</option>
                  <option value="checkin">チェックイン</option>
                  <option value="checkout">チェックアウト</option>
                  <option value="inspection">点検</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">日付</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                  value={editDraft.date}
                  onChange={(e) => setEditDraft((d) => d ? { ...d, date: e.target.value } : d)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-600">開始時間</label>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                    value={editDraft.start_time}
                    onChange={(e) => setEditDraft((d) => d ? { ...d, start_time: e.target.value } : d)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-600">終了時間</label>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                    value={editDraft.end_time}
                    onChange={(e) => setEditDraft((d) => d ? { ...d, end_time: e.target.value } : d)}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-[#06C755] focus:ring-[#06C755]"
                  checked={editDraft.notify}
                  onChange={(e) => setEditDraft((d) => d ? { ...d, notify: e.target.checked } : d)}
                />
                保存時にスタッフへ LINE 通知する（承諾 / 辞退ボタン付き）
              </label>

              {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !saving && setEditDraft(null)}
                disabled={saving}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中...' : editDraft.id ? '更新する' : '作成する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* シフト希望 追加・編集モーダル */}
      {requestDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setRequestDraft(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {requestDraft.id ? 'シフト希望を編集' : 'シフト希望を追加'}
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">対象週: {requestDraft.week_start_date} 〜</p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setRequestDraft(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">スタッフ</label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20 disabled:bg-gray-50"
                  value={requestDraft.staff_id}
                  disabled={requestDraft.id !== null}
                  onChange={(e) => setRequestDraft((d) => d ? { ...d, staff_id: e.target.value } : d)}
                >
                  <option value="">選択してください</option>
                  {staff.filter((m) => m.is_active === 1).map((member) => (
                    <option key={member.id} value={member.id}>{member.name}（{member.role}）</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600">対応可能な日と時間帯</p>
                {requestDraft.days.map((day, index) => (
                  <div
                    key={day.date}
                    className={`rounded-lg border p-3 ${day.enabled ? 'border-[#06C755] bg-green-50/40' : 'border-gray-200 bg-white'}`}
                  >
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-[#06C755] focus:ring-[#06C755]"
                        checked={day.enabled}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setRequestDraft((d) => d ? {
                            ...d,
                            days: d.days.map((x, i) => i === index ? { ...x, enabled: checked } : x),
                          } : d)
                        }}
                      />
                      <span className="text-sm font-medium text-gray-900">{formatShortDay(day.date)}</span>
                    </label>
                    {day.enabled && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <input
                          type="time"
                          className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
                          value={day.from}
                          onChange={(e) => {
                            const value = e.target.value
                            setRequestDraft((d) => d ? {
                              ...d,
                              days: d.days.map((x, i) => i === index ? { ...x, from: value } : x),
                            } : d)
                          }}
                        />
                        <input
                          type="time"
                          className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
                          value={day.to}
                          onChange={(e) => {
                            const value = e.target.value
                            setRequestDraft((d) => d ? {
                              ...d,
                              days: d.days.map((x, i) => i === index ? { ...x, to: value } : x),
                            } : d)
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-[#06C755] focus:ring-[#06C755]"
                  checked={requestDraft.notify}
                  onChange={(e) => setRequestDraft((d) => d ? { ...d, notify: e.target.checked } : d)}
                />
                保存時にスタッフへ LINE 通知する（確認依頼）
              </label>

              {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !saving && setRequestDraft(null)}
                disabled={saving}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleSaveRequest()}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中...' : requestDraft.id ? '更新する' : '追加する'}
              </button>
            </div>
          </div>
        </div>
      )}
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

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getWeekStart(): string {
  const now = new Date()
  const diff = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - diff)
  return formatLocalDate(now)
}

function getNextMondayFromWeek(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + 7)
  return formatLocalDate(date)
}

function buildWeekDays(weekStart: string): string[] {
  const [y, m, d] = weekStart.split('-').map(Number)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(y, m - 1, d)
    date.setDate(date.getDate() + index)
    return formatLocalDate(date)
  })
}

function formatShortDay(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`)
  const labels = ['日', '月', '火', '水', '木', '金', '土']
  return `${date.getMonth() + 1}/${date.getDate()}(${labels[date.getDay()]})`
}

function formatCollectedAt(value: string | null | undefined): string {
  if (!value) return '—'
  // SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS"（UTC）
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const withZ = normalized.endsWith('Z') ? normalized : `${normalized}Z`
  const date = new Date(withZ)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00`))
}

function formatTimeRange(startTime: string | null, endTime: string | null): string {
  if (!startTime && !endTime) return '未設定'
  return `${startTime ?? '--:--'} - ${endTime ?? '--:--'}`
}
