import { useEffect, useMemo, useState } from 'react'
import { ApiError, apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { AdminUser } from '../lib/types'

const inputClassName = 'border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20'
const selectClassName = 'border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20'
const primaryButtonClassName = 'text-white rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'

interface InviteFormState {
  email: string
  name: string
  role: AdminUser['role']
}

export function SettingsPage(): JSX.Element {
  const { token, user } = useAuth()
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [inviteForm, setInviteForm] = useState<InviteFormState>({ email: '', name: '', role: 'viewer' })
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [hideGuestName, setHideGuestName] = useState(false)
  const [showPlatform, setShowPlatform] = useState(false)

  useEffect(() => {
    if (!token) return
    apiFetch<{ hide_guest_name: boolean; show_platform: boolean }>('/api/settings/line', undefined, token)
      .then((data) => {
        setHideGuestName(data.hide_guest_name)
        setShowPlatform(data.show_platform)
      })
      .catch(() => {})
  }, [token])

  async function updateLineSetting(key: 'hide_guest_name' | 'show_platform', value: boolean): Promise<void> {
    if (!token) return
    try {
      const res = await apiFetch<{ hide_guest_name: boolean; show_platform: boolean }>('/api/settings/line', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      }, token)
      setHideGuestName(res.hide_guest_name)
      setShowPlatform(res.show_platform)
      setMessage('LINE表示設定を更新しました')
    } catch {
      setError('設定の更新に失敗しました')
    }
  }

  const sortedAdminUsers = useMemo(
    () => [...adminUsers].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.email.localeCompare(b.email)),
    [adminUsers]
  )

  async function loadAdminUsers(): Promise<void> {
    if (!token) return
    setIsLoading(true)
    try {
      const users = await apiFetch<AdminUser[]>('/api/admin-users', undefined, token)
      setAdminUsers(users)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '管理ユーザー一覧の取得に失敗しました。')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadAdminUsers()
  }, [token])

  async function handleInviteSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!token) return

    try {
      setIsSubmitting(true)
      setError(null)
      setMessage(null)
      setInviteUrl(null)
      const result = await apiFetch<{ user: AdminUser; invite_token: string }>('/api/admin-users', {
        method: 'POST',
        body: JSON.stringify(inviteForm),
      }, token)
      const url = `${window.location.origin}/invite/${result.invite_token}`
      setInviteUrl(url)
      setInviteForm({ email: '', name: '', role: 'viewer' })
      setIsInviteOpen(false)
      setMessage('招待リンクが生成されました。以下のURLを共有してください（24時間有効・1回限り）。')
      await loadAdminUsers()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '管理ユーザーの作成に失敗しました。')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRoleChange(target: AdminUser, role: AdminUser['role']): Promise<void> {
    if (!token) return

    const previous = adminUsers
    setAdminUsers((current) => current.map((item) => (item.id === target.id ? { ...item, role } : item)))
    try {
      setError(null)
      await apiFetch<AdminUser>(`/api/admin-users/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }, token)
      setMessage('権限を更新しました。')
    } catch (nextError) {
      setAdminUsers(previous)
      setError(nextError instanceof Error ? nextError.message : '権限更新に失敗しました。')
    }
  }

  async function handleStatusToggle(target: AdminUser): Promise<void> {
    if (!token) return

    const nextStatus = target.is_active === 1 ? 0 : 1
    const previous = adminUsers
    setAdminUsers((current) => current.map((item) => (item.id === target.id ? { ...item, is_active: nextStatus } : item)))
    try {
      setError(null)
      await apiFetch<AdminUser>(`/api/admin-users/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: nextStatus }),
      }, token)
      setMessage(nextStatus === 1 ? '管理ユーザーを有効化しました。' : '管理ユーザーを無効化しました。')
    } catch (nextError) {
      setAdminUsers(previous)
      setError(nextError instanceof Error ? nextError.message : '状態更新に失敗しました。')
    }
  }

  async function handleDelete(target: AdminUser): Promise<void> {
    if (!token || !window.confirm(`${target.name} を削除しますか？`)) return

    try {
      setError(null)
      setMessage(null)
      await apiFetch<{ id: string; deleted: boolean }>(`/api/admin-users/${target.id}`, { method: 'DELETE' }, token)
      setMessage('管理ユーザーを削除しました。')
      await loadAdminUsers()
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.status === 403) {
        setError('自分自身は削除できません。')
        return
      }
      setError(nextError instanceof Error ? nextError.message : '管理ユーザーの削除に失敗しました。')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">設定</h1>
        <p className="mt-1 text-sm text-gray-500">管理ユーザー情報とシステム設定の状態を確認します</p>
      </div>

      {/* LINE 設定 */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">LINE 表示設定</h2>
          <p className="text-xs text-gray-500">スタッフが LINE で「予約」コマンドを使った時の表示を制御します</p>
        </div>
        <div className="p-5">
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">ゲスト名を非表示にする</p>
                <p className="mt-0.5 text-xs text-gray-500">ONにすると、予約一覧で物件名のみ表示されます</p>
              </div>
              <button
                type="button"
                onClick={() => void updateLineSetting('hide_guest_name', !hideGuestName)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${hideGuestName ? 'bg-[#06C755]' : 'bg-gray-300'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${hideGuestName ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </label>
            <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">プラットフォームを表示する</p>
                <p className="mt-0.5 text-xs text-gray-500">ONにすると、予約の末尾に (airbnb) (direct) 等を表示します</p>
              </div>
              <button
                type="button"
                onClick={() => void updateLineSetting('show_platform', !showPlatform)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showPlatform ? 'bg-[#06C755]' : 'bg-gray-300'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${showPlatform ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">ユーザー情報</h2>
            <p className="text-xs text-gray-500">`/api/auth/me` の内容を表示しています</p>
          </div>
          <div className="space-y-4 p-5 text-sm">
            <InfoRow label="名前" value={user?.name ?? '-'} />
            <InfoRow label="メール" value={user?.email ?? '-'} />
            <InfoRow label="権限" value={user?.role ?? '-'} />
            <InfoRow label="最終ログイン" value={user?.last_login ?? '未記録'} />
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">システム設定</h2>
            <p className="text-xs text-gray-500">運用系の設定状態と今後の拡張ポイントです</p>
          </div>
          <div className="space-y-4 p-5">
            <SettingRow
              title="管理ユーザー招待"
              description="ログイン可能な管理ユーザーを追加・編集・停止できます。"
              status="稼働中"
            />
            <SettingRow
              title="LINE通知設定"
              description="スタッフ通知とオーナー通知は Worker 側設定を利用します。画面編集は今後追加予定です。"
              status="固定"
            />
            <SettingRow
              title="監査ログ"
              description="設定変更履歴の可視化は未着手です。必要になった段階で別カードを追加します。"
              status="計画中"
            />
          </div>
        </div>
      </div>

      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{message}</div>}
      {inviteUrl && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-medium text-gray-600">招待URL（このURLを相手に共有してください）</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-800 break-all">{inviteUrl}</code>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(inviteUrl); setMessage('URLをコピーしました') }}
              className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              コピー
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">24時間有効・1回アクセスで自動ログインします。再発行はできません。</p>
        </div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">管理ユーザー</h2>
            <p className="text-sm text-gray-500">権限の変更、無効化、有効化、削除をここで管理します。</p>
          </div>
          <button
            type="button"
            className={primaryButtonClassName}
            style={{ backgroundColor: '#06C755' }}
            onClick={() => {
              setError(null)
              setMessage(null)
              setIsInviteOpen((current) => !current)
            }}
          >
            ＋ ユーザーを招待
          </button>
        </div>

        {isInviteOpen && (
          <form onSubmit={(event) => void handleInviteSubmit(event)} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">メールアドレス</span>
                <input
                  type="email"
                  required
                  className={inputClassName}
                  value={inviteForm.email}
                  onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="admin@example.com"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">名前</span>
                <input
                  type="text"
                  required
                  className={inputClassName}
                  value={inviteForm.name}
                  onChange={(event) => setInviteForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="山田 太郎"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-gray-700">権限</span>
                <select
                  className={selectClassName}
                  value={inviteForm.role}
                  onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value as AdminUser['role'] }))}
                >
                  <option value="owner">オーナー</option>
                  <option value="manager">マネージャー</option>
                  <option value="viewer">閲覧者</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setIsInviteOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="submit"
                className={primaryButtonClassName}
                style={{ backgroundColor: '#06C755' }}
                disabled={isSubmitting}
              >
                招待を保存
              </button>
            </div>
          </form>
        )}

        <div className="border border-gray-200 bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">名前</th>
                  <th className="px-4 py-3 text-left">メール</th>
                  <th className="px-4 py-3 text-left">権限</th>
                  <th className="px-4 py-3 text-left">状態</th>
                  <th className="px-4 py-3 text-left">最終ログイン</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr className="hover:bg-gray-50">
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">読み込み中...</td>
                  </tr>
                ) : sortedAdminUsers.length === 0 ? (
                  <tr className="hover:bg-gray-50">
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">管理ユーザーが登録されていません</td>
                  </tr>
                ) : sortedAdminUsers.map((adminUser) => {
                  const isCurrentUser = adminUser.id === user?.id
                  return (
                    <tr key={adminUser.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{adminUser.name}</div>
                        <div className="text-xs text-gray-400">{new Date(adminUser.created_at).toLocaleDateString('ja-JP')} 作成</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{adminUser.email}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={roleBadgeClassName(adminUser.role)}>{adminUser.role}</span>
                          <select
                            className={selectClassName}
                            value={adminUser.role}
                            onChange={(event) => void handleRoleChange(adminUser, event.target.value as AdminUser['role'])}
                          >
                            <option value="owner">オーナー</option>
                            <option value="manager">マネージャー</option>
                            <option value="viewer">閲覧者</option>
                          </select>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={statusBadgeClassName(adminUser.is_active)}>{adminUser.is_active === 1 ? 'active' : 'inactive'}</span>
                          <button
                            type="button"
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            onClick={() => void handleStatusToggle(adminUser)}
                          >
                            {adminUser.is_active === 1 ? '無効化' : '有効化'}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatLastLogin(adminUser.last_login)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleDelete(adminUser)}
                            disabled={isCurrentUser}
                            title={isCurrentUser ? '自分自身は削除できません' : '管理ユーザーを削除'}
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  )
}

function SettingRow({ title, description, status }: { title: string; description: string; status: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">{status}</span>
      </div>
    </div>
  )
}

function roleBadgeClassName(role: AdminUser['role']): string {
  if (role === 'owner') return 'rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700'
  if (role === 'manager') return 'rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700'
  return 'rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600'
}

function statusBadgeClassName(isActive: number): string {
  return isActive === 1
    ? 'rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700'
    : 'rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700'
}

function formatLastLogin(value: string | null): string {
  if (!value) return '未ログイン'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ja-JP')
}
