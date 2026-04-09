import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { Property, Staff } from '../lib/types'

const inputClassName = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20'

export function StaffPage(): JSX.Element {
  const { token } = useAuth()
  const [staff, setStaff] = useState<Staff[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [wageDrafts, setWageDrafts] = useState<Record<string, string>>({})
  const [wageTypeDrafts, setWageTypeDrafts] = useState<Record<string, 'hourly' | 'daily'>>({})
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<Staff['role']>('cleaner')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
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
        body: JSON.stringify({ name: inviteName, role: inviteRole }),
      }, token)
      setInviteCode(result.invite_code)
      setMessage('招待コードを発行しました。')
      setInviteName('')
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '招待コードの発行に失敗しました。')
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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">スタッフ管理</h1>
          <p className="mt-1 text-sm text-gray-500">役割、時給、LINE連携状況を一元管理します</p>
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
        <div className="overflow-x-auto">
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
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">スタッフがまだ登録されていません</td>
                </tr>
              ) : staff.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{member.name}</p>
                    <p className="text-xs text-gray-400">{member.hourly_wage !== null ? `¥${member.hourly_wage.toLocaleString()}/${(member.wage_type ?? 'hourly') === 'daily' ? '日' : 'h'}` : '未設定'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                      value={member.role}
                      onChange={(event) => void updateRole(member, event.target.value as Staff['role'])}
                    >
                      <option value="cleaner">清掃スタッフ</option>
                      <option value="checkin">チェックイン担当</option>
                      <option value="manager">マネージャー</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
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
                        className="w-24 rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                        type="number"
                        min="0"
                        placeholder="¥"
                        value={wageDrafts[member.id] ?? ''}
                        onChange={(event) => setWageDrafts((current) => ({ ...current, [member.id]: event.target.value }))}
                        onBlur={() => void updateHourlyWage(member)}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {(member.property_ids ?? []).map((propertyId) => properties.find((property) => property.id === propertyId)?.name ?? propertyId).join(', ') || '未設定'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${member.line_user_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {member.line_user_id ? '連携済み' : '未連携'}
                    </span>
                    {member.line_user_id && <p className="mt-1 text-xs text-gray-400">{member.line_user_id}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void deactivateStaff(member)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        無効化
                      </button>
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
