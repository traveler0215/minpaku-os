import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { Property, Staff } from '../lib/types'

const inputClassName = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20'

type MessageTarget =
  | { kind: 'individual'; staff_id: string }
  | { kind: 'role'; role: Staff['role'] }
  | { kind: 'all' }

interface MessageDraft {
  target: MessageTarget
  text: string
}

export function StaffPage(): JSX.Element {
  const { token } = useAuth()
  const [staff, setStaff] = useState<Staff[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [wageDrafts, setWageDrafts] = useState<Record<string, string>>({})
  const [wageTypeDrafts, setWageTypeDrafts] = useState<Record<string, 'hourly' | 'daily'>>({})
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<Staff['role']>('cleaner')
  const [inviteProperties, setInviteProperties] = useState<string[]>([])
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState<MessageDraft | null>(null)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function load(): Promise<void> {
    if (!token) return
    const [staffList, propertyList] = await Promise.all([
      apiFetch<Staff[]>('/api/staff', undefined, token),
      apiFetch<Property[]>('/api/properties', undefined, token),
    ])
    setStaff(staffList)
    setProperties(propertyList)
    setWageDrafts(Object.fromEntries(staffList.map((member) => [member.id, member.hourly_wage !== null ? String(member.hourly_wage) : ''])))
    setWageTypeDrafts(Object.fromEntries(staffList.map((member) => [member.id, member.wage_type ?? 'hourly'])))
  }

  useEffect(() => {
    void load().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'スタッフ情報の取得に失敗しました。')
    })
  }, [token])

  async function handleInvite(): Promise<void> {
    if (!token || !inviteName.trim()) return

    try {
      setError(null)
      setMessage(null)
      const result = await apiFetch<{ invite_code: string }>('/api/staff/invite', {
        method: 'POST',
        body: JSON.stringify({ name: inviteName, role: inviteRole, property_ids: inviteProperties }),
      }, token)
      setInviteCode(result.invite_code)
      setMessage('招待コードを発行しました。')
      setInviteName('')
      setInviteProperties([])
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '招待コードの発行に失敗しました。')
    }
  }

  async function toggleStaffProperty(member: Staff, propertyId: string): Promise<void> {
    if (!token) return
    const current = member.property_ids ?? []
    const next = current.includes(propertyId)
      ? current.filter((id) => id !== propertyId)
      : [...current, propertyId]

    try {
      setError(null)
      await apiFetch(`/api/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ property_ids: next }),
      }, token)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '担当物件の更新に失敗しました。')
    }
  }

  async function updateRole(member: Staff, role: Staff['role']): Promise<void> {
    if (!token) return

    try {
      setError(null)
      await apiFetch(`/api/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }, token)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'スタッフ更新に失敗しました。')
    }
  }

  async function updateHourlyWage(member: Staff): Promise<void> {
    if (!token) return

    const rawValue = wageDrafts[member.id] ?? ''
    const nextValue = rawValue.trim() === '' ? null : Number(rawValue)

    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      setError('時給は0以上の数値で入力してください。')
      setWageDrafts((current) => ({ ...current, [member.id]: member.hourly_wage !== null ? String(member.hourly_wage) : '' }))
      return
    }

    if (nextValue === member.hourly_wage) return

    try {
      setError(null)
      setMessage(null)
      await apiFetch(`/api/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ hourly_wage: nextValue }),
      }, token)
      setMessage('時給を更新しました。')
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '時給の更新に失敗しました。')
      setWageDrafts((current) => ({ ...current, [member.id]: member.hourly_wage !== null ? String(member.hourly_wage) : '' }))
    }
  }

  async function updateWageType(member: Staff, wageType: 'hourly' | 'daily'): Promise<void> {
    if (!token || wageType === member.wage_type) return
    try {
      setError(null)
      await apiFetch(`/api/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ wage_type: wageType }),
      }, token)
      setMessage(`給与タイプを${wageType === 'hourly' ? '時給' : '日給'}に変更しました。`)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '給与タイプの更新に失敗しました。')
    }
  }

  function openMessageModalForStaff(member: Staff): void {
    setMessageDraft({ target: { kind: 'individual', staff_id: member.id }, text: '' })
    setError(null)
    setMessage(null)
  }

  function openMessageModalBroadcast(): void {
    setMessageDraft({ target: { kind: 'all' }, text: '' })
    setError(null)
    setMessage(null)
  }

  async function handleSendMessage(): Promise<void> {
    if (!token || !messageDraft) return
    const text = messageDraft.text.trim()
    if (!text) {
      setError('メッセージを入力してください。')
      return
    }
    if (text.length > 5000) {
      setError('メッセージは5000文字以内で入力してください。')
      return
    }

    setSendingMessage(true)
    try {
      setError(null)
      if (messageDraft.target.kind === 'individual') {
        const result = await apiFetch<{ staff_name: string; sent_to: number }>(
          `/api/staff/${messageDraft.target.staff_id}/message`,
          { method: 'POST', body: JSON.stringify({ text }) },
          token,
        )
        setMessage(`${result.staff_name}さんに送信しました。`)
      } else {
        const body: { text: string; role?: Staff['role'] } = { text }
        if (messageDraft.target.kind === 'role') {
          body.role = messageDraft.target.role
        }
        const result = await apiFetch<{ sent_to: number }>(
          '/api/staff/broadcast',
          { method: 'POST', body: JSON.stringify(body) },
          token,
        )
        setMessage(`${result.sent_to}名に送信しました。`)
      }
      setMessageDraft(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'メッセージの送信に失敗しました。')
    } finally {
      setSendingMessage(false)
    }
  }

  async function deactivateStaff(member: Staff): Promise<void> {
    if (!token) return

    try {
      setError(null)
      setMessage(null)
      await apiFetch(`/api/staff/${member.id}`, { method: 'DELETE' }, token)
      setMessage('スタッフを無効化しました。')
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'スタッフの無効化に失敗しました。')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start justify-between gap-3 lg:block">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">スタッフ管理</h1>
            <p className="mt-1 text-sm text-gray-500">役割、時給、LINE連携状況を一元管理します</p>
          </div>
          <button
            type="button"
            onClick={openMessageModalBroadcast}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 lg:mt-3"
          >
            ✉️ メッセージ送信
          </button>
        </div>
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">招待コード発行</h2>
              <p className="mt-1 text-xs text-gray-500">24時間有効の 6 桁コードを生成します</p>
            </div>
            <button
              type="button"
              onClick={() => void handleInvite()}
              className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              発行
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <input
              className={inputClassName}
              placeholder="スタッフ名"
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
            />
            <select
              className={inputClassName}
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as Staff['role'])}
            >
              <option value="cleaner">清掃スタッフ</option>
              <option value="checkin">チェックイン担当</option>
              <option value="manager">マネージャー</option>
            </select>
          </div>
          {properties.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-gray-500">担当物件（後から変更可能）</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {properties.map((property) => (
                  <label key={property.id} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-gray-300 text-[#06C755] focus:ring-[#06C755]"
                      checked={inviteProperties.includes(property.id)}
                      onChange={(event) => {
                        setInviteProperties((current) =>
                          event.target.checked
                            ? [...current, property.id]
                            : current.filter((id) => id !== property.id)
                        )
                      }}
                    />
                    {property.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {inviteCode && (
            <div className="mt-3 space-y-2">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="mb-1 text-xs font-medium text-gray-500">スタッフに送るメッセージ（タップでコピー）</p>
                <button
                  type="button"
                  onClick={() => {
                    const msg = `【民泊OS スタッフ招待】\n\n① 下記リンクから友だち追加してください\n${import.meta.env.VITE_LINE_ADD_URL ?? 'https://line.me/R/ti/p/YOUR_LINE_BOT_ID'}\n\n② 追加したら招待コードを送信してください\n招待コード: ${inviteCode}\n\n※コードは24時間有効です`
                    void navigator.clipboard.writeText(msg).then(() => setMessage('メッセージをコピーしました'))
                  }}
                  className="w-full whitespace-pre-line rounded-lg border border-gray-200 bg-white p-3 text-left text-sm text-gray-800 hover:bg-gray-50"
                >
                  {`【民泊OS スタッフ招待】\n\n① 下記リンクから友だち追加してください\n${import.meta.env.VITE_LINE_ADD_URL ?? 'https://line.me/R/ti/p/YOUR_LINE_BOT_ID'}\n\n② 追加したら招待コードを送信してください\n招待コード: ${inviteCode}\n\n※コードは24時間有効です`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {staff.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">スタッフがまだ登録されていません</p>
        ) : (
          <>
            {/* スマホ: カード表示 */}
            <div className="sm:hidden divide-y divide-gray-100">
              {staff.map((member) => (
                <div key={member.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{member.name}</p>
                      <p className="text-xs text-gray-400">{member.hourly_wage !== null ? `¥${member.hourly_wage.toLocaleString()}/${(member.wage_type ?? 'hourly') === 'daily' ? '日' : 'h'}` : '給与未設定'}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${member.line_user_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {member.line_user_id ? 'LINE連携済み' : 'LINE未連携'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-[#06C755]"
                      value={member.role}
                      onChange={(event) => void updateRole(member, event.target.value as Staff['role'])}
                    >
                      <option value="cleaner">清掃スタッフ</option>
                      <option value="checkin">チェックイン担当</option>
                      <option value="manager">マネージャー</option>
                    </select>
                    <select
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-[#06C755]"
                      value={wageTypeDrafts[member.id] ?? member.wage_type ?? 'hourly'}
                      onChange={(event) => {
                        const val = event.target.value as 'hourly' | 'daily'
                        setWageTypeDrafts((c) => ({ ...c, [member.id]: val }))
                        void updateWageType(member, val)
                      }}
                    >
                      <option value="hourly">時給</option>
                      <option value="daily">日給</option>
                    </select>
                    <input
                      className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-[#06C755]"
                      type="number" min="0" placeholder="¥"
                      value={wageDrafts[member.id] ?? ''}
                      onChange={(event) => setWageDrafts((current) => ({ ...current, [member.id]: event.target.value }))}
                      onBlur={() => void updateHourlyWage(member)}
                    />
                  </div>
                  <details className="group">
                    <summary className="cursor-pointer list-none text-xs text-gray-500 group-open:mb-1">
                      担当物件: {(member.property_ids ?? []).length > 0
                        ? (member.property_ids ?? []).map((pid) => properties.find((p) => p.id === pid)?.name ?? pid).join(', ')
                        : '未設定（タップで選択）'}
                    </summary>
                    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50 p-2">
                      {properties.map((property) => (
                        <label key={property.id} className="flex items-center gap-1.5 text-xs text-gray-700">
                          <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 text-[#06C755]"
                            checked={(member.property_ids ?? []).includes(property.id)}
                            onChange={() => void toggleStaffProperty(member, property.id)} />
                          {property.name}
                        </label>
                      ))}
                    </div>
                  </details>
                  <div className="flex gap-2">
                    {member.line_user_id && (
                      <button type="button" onClick={() => openMessageModalForStaff(member)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">✉️ 送信</button>
                    )}
                    <button type="button" onClick={() => void deactivateStaff(member)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">無効化</button>
                  </div>
                </div>
              ))}
            </div>
            {/* PC: テーブル表示 */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">名前</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">役割</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">給与</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">担当物件</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">LINE連携</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">アクション</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {staff.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{member.name}</p>
                        <p className="text-xs text-gray-400">{member.hourly_wage !== null ? `¥${member.hourly_wage.toLocaleString()}/${(member.wage_type ?? 'hourly') === 'daily' ? '日' : 'h'}` : '未設定'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                          value={member.role} onChange={(event) => void updateRole(member, event.target.value as Staff['role'])}>
                          <option value="cleaner">清掃スタッフ</option>
                          <option value="checkin">チェックイン担当</option>
                          <option value="manager">マネージャー</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <select className="rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                            value={wageTypeDrafts[member.id] ?? member.wage_type ?? 'hourly'}
                            onChange={(event) => { const val = event.target.value as 'hourly' | 'daily'; setWageTypeDrafts((c) => ({ ...c, [member.id]: val })); void updateWageType(member, val) }}>
                            <option value="hourly">時給</option>
                            <option value="daily">日給</option>
                          </select>
                          <input className="w-24 rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                            type="number" min="0" placeholder="¥" value={wageDrafts[member.id] ?? ''}
                            onChange={(event) => setWageDrafts((current) => ({ ...current, [member.id]: event.target.value }))}
                            onBlur={() => void updateHourlyWage(member)} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {properties.length === 0 ? <span className="text-xs text-gray-400">物件未登録</span> : (
                          <details className="group">
                            <summary className="cursor-pointer list-none text-sm text-gray-600 group-open:mb-2">
                              {(member.property_ids ?? []).length > 0
                                ? (member.property_ids ?? []).map((propertyId) => properties.find((property) => property.id === propertyId)?.name ?? propertyId).join(', ')
                                : <span className="text-gray-400">未設定（クリックして選択）</span>}
                            </summary>
                            <div className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50 p-2">
                              {properties.map((property) => (
                                <label key={property.id} className="flex items-center gap-1.5 text-xs text-gray-700">
                                  <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 text-[#06C755] focus:ring-[#06C755]"
                                    checked={(member.property_ids ?? []).includes(property.id)}
                                    onChange={() => void toggleStaffProperty(member, property.id)} />
                                  {property.name}
                                </label>
                              ))}
                            </div>
                          </details>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${member.line_user_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {member.line_user_id ? '連携済み' : '未連携'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {member.line_user_id && (
                            <button type="button" onClick={() => openMessageModalForStaff(member)}
                              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" title="LINE メッセージを送信">✉️</button>
                          )}
                          <button type="button" onClick={() => void deactivateStaff(member)}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">無効化</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* LINE メッセージ送信モーダル */}
      {messageDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !sendingMessage && setMessageDraft(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-bold text-gray-900">LINE メッセージ送信</h2>
              <button
                type="button"
                onClick={() => !sendingMessage && setMessageDraft(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">宛先</label>
                <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      checked={messageDraft.target.kind === 'all'}
                      onChange={() => setMessageDraft((d) => d ? { ...d, target: { kind: 'all' } } : d)}
                    />
                    <span>全スタッフ（LINE連携済み・有効なもの）</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      checked={messageDraft.target.kind === 'role'}
                      onChange={() => setMessageDraft((d) => d ? { ...d, target: { kind: 'role', role: 'cleaner' } } : d)}
                    />
                    <span>役割を指定</span>
                    {messageDraft.target.kind === 'role' && (
                      <select
                        className="ml-2 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                        value={messageDraft.target.role}
                        onChange={(e) => setMessageDraft((d) => d && d.target.kind === 'role' ? { ...d, target: { kind: 'role', role: e.target.value as Staff['role'] } } : d)}
                      >
                        <option value="cleaner">清掃スタッフ</option>
                        <option value="checkin">チェックイン担当</option>
                        <option value="manager">マネージャー</option>
                      </select>
                    )}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      checked={messageDraft.target.kind === 'individual'}
                      onChange={() => setMessageDraft((d) => d ? { ...d, target: { kind: 'individual', staff_id: staff.find((m) => m.line_user_id && m.is_active === 1)?.id ?? '' } } : d)}
                    />
                    <span>個別に指定</span>
                    {messageDraft.target.kind === 'individual' && (
                      <select
                        className="ml-2 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                        value={messageDraft.target.staff_id}
                        onChange={(e) => setMessageDraft((d) => d && d.target.kind === 'individual' ? { ...d, target: { kind: 'individual', staff_id: e.target.value } } : d)}
                      >
                        <option value="">選択してください</option>
                        {staff.filter((m) => m.line_user_id && m.is_active === 1).map((member) => (
                          <option key={member.id} value={member.id}>{member.name}</option>
                        ))}
                      </select>
                    )}
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">
                  メッセージ <span className="text-gray-400">（{messageDraft.text.length} / 5000）</span>
                </label>
                <textarea
                  className={`${inputClassName} min-h-36`}
                  placeholder="例: 明日は予約が多いので9:30には到着お願いします。"
                  value={messageDraft.text}
                  maxLength={5000}
                  onChange={(e) => setMessageDraft((d) => d ? { ...d, text: e.target.value } : d)}
                />
              </div>

              {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !sendingMessage && setMessageDraft(null)}
                disabled={sendingMessage}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleSendMessage()}
                disabled={sendingMessage || !messageDraft.text.trim()}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {sendingMessage ? '送信中...' : '送信する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
