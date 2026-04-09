import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { GuestRegistryEntry, Property, Reservation } from '../lib/types'

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20'

const PLATFORM_BADGE: Record<Reservation['platform'], string> = {
  airbnb: 'bg-red-100 text-red-700',
  booking: 'bg-blue-100 text-blue-700',
  direct: 'bg-green-100 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

const STATUS_BADGE: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  completed: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-yellow-100 text-yellow-700',
  checked_out: 'bg-blue-100 text-blue-700',
  blocked: 'bg-gray-100 text-gray-600',
}

const emptyForm = {
  property_id: '',
  platform: 'airbnb' as Reservation['platform'],
  guest_name: '',
  guest_email: '',
  guest_count: 1,
  checkin_date: '',
  checkout_date: '',
  notes: '',
}

const emptyGuestForm = {
  guest_name: '',
  nationality: '',
  passport_number: '',
  address: '',
  occupation: '',
}

const emptyRevenueForm = {
  gross_amount: '',
  ota_fee_amount: '',
  net_amount: '',
}

export function ReservationsPage(): JSX.Element {
  const { token } = useAuth()
  const [properties, setProperties] = useState<Property[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [selected, setSelected] = useState<Reservation | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [guests, setGuests] = useState<GuestRegistryEntry[]>([])
  const [guestForm, setGuestForm] = useState(emptyGuestForm)
  const [revenueForm, setRevenueForm] = useState(emptyRevenueForm)
  const [savingRevenue, setSavingRevenue] = useState(false)
  const [loadingGuests, setLoadingGuests] = useState(false)
  const [filters, setFilters] = useState({
    property_id: '',
    month: '',
    status: '',
    guest_name: '',
  })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(): Promise<void> {
    if (!token) return

    const reservationPath = filters.month
      ? `/api/reservations?month=${filters.month}`
      : '/api/reservations'

    const [propertyList, reservationList] = await Promise.all([
      apiFetch<Property[]>('/api/properties', undefined, token),
      apiFetch<Reservation[]>(reservationPath, undefined, token),
    ])
    setProperties(propertyList)
    setReservations(reservationList)
    setSelected((current) => current ? (reservationList.find((r) => r.id === current.id) ?? null) : null)
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : '予約一覧の取得に失敗しました'))
  }, [token, filters.month])

  useEffect(() => {
    async function loadGuests(): Promise<void> {
      if (!token || !selected || showForm) {
        setGuests([])
        return
      }

      try {
        setLoadingGuests(true)
        const entries = await apiFetch<GuestRegistryEntry[]>(`/api/reservations/${selected.id}/guests`, undefined, token)
        setGuests(entries)
      } catch (e) {
        setError(e instanceof Error ? e.message : '宿泊者名簿の取得に失敗しました')
      } finally {
        setLoadingGuests(false)
      }
    }

    void loadGuests()
  }, [token, selected, showForm])

  useEffect(() => {
    if (!selected || showForm) {
      setRevenueForm(emptyRevenueForm)
      return
    }

    setRevenueForm({
      gross_amount: selected.gross_amount?.toString() ?? '',
      ota_fee_amount: selected.ota_fee_amount?.toString() ?? '',
      net_amount: selected.net_amount?.toString() ?? '',
    })
  }, [selected, showForm])

  async function handleCreate(): Promise<void> {
    if (!token) return
    setError(null)
    setMessage(null)
    try {
      await apiFetch('/api/reservations', { method: 'POST', body: JSON.stringify(form) }, token)
      setForm(emptyForm)
      setShowForm(false)
      setMessage('予約を登録しました')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '予約登録に失敗しました')
    }
  }

  async function handleAddGuest(): Promise<void> {
    if (!token || !selected) return
    if (!guestForm.guest_name.trim()) {
      setError('宿泊者名は必須です')
      return
    }

    try {
      setError(null)
      setMessage(null)
      await apiFetch(`/api/reservations/${selected.id}/guests`, {
        method: 'POST',
        body: JSON.stringify({
          guest_name: guestForm.guest_name.trim(),
          nationality: guestForm.nationality.trim() || null,
          passport_number: guestForm.passport_number.trim() || null,
          address: guestForm.address.trim() || null,
          occupation: guestForm.occupation.trim() || null,
        }),
      }, token)
      setGuestForm(emptyGuestForm)
      setMessage('宿泊者を追加しました')
      const entries = await apiFetch<GuestRegistryEntry[]>(`/api/reservations/${selected.id}/guests`, undefined, token)
      setGuests(entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : '宿泊者の追加に失敗しました')
    }
  }

  async function handleDeleteGuest(guestId: string): Promise<void> {
    if (!token || !selected) return

    try {
      setError(null)
      setMessage(null)
      await apiFetch(`/api/guests/${guestId}`, { method: 'DELETE' }, token)
      setGuests((current) => current.filter((guest) => guest.id !== guestId))
      setMessage('宿泊者を削除しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '宿泊者の削除に失敗しました')
    }
  }

  async function handleRevenueSave(): Promise<void> {
    if (!token || !selected) return

    try {
      setSavingRevenue(true)
      setError(null)
      setMessage(null)
      await apiFetch(`/api/reservations/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          gross_amount: parseAmount(revenueForm.gross_amount),
          ota_fee_amount: parseAmount(revenueForm.ota_fee_amount),
          net_amount: parseAmount(revenueForm.net_amount),
        }),
      }, token)
      await load()
      setMessage('売上情報を更新しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '売上情報の更新に失敗しました')
    } finally {
      setSavingRevenue(false)
    }
  }

  const filteredReservations = useMemo(() => {
    const guestQuery = filters.guest_name.trim().toLowerCase()
    return reservations.filter((reservation) => {
      if (filters.property_id && reservation.property_id !== filters.property_id) return false
      if (filters.status && reservation.status !== filters.status) return false
      if (guestQuery && !(reservation.guest_name ?? '').toLowerCase().includes(guestQuery)) return false
      return true
    })
  }, [filters.guest_name, filters.property_id, filters.status, reservations])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">予約管理</h1>
          <p className="mt-1 text-sm text-gray-500">{filteredReservations.length} 件</p>
        </div>
        <button
          type="button"
          onClick={() => { setShowForm(true); setSelected(null) }}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          style={{ backgroundColor: '#06C755' }}
        >
          ＋ 手動登録
        </button>
      </div>

      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <select className={inputCls} value={filters.property_id} onChange={(e) => setFilters((current) => ({ ...current, property_id: e.target.value }))}>
            <option value="">全物件</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.name}</option>
            ))}
          </select>
          <input className={inputCls} type="month" value={filters.month} onChange={(e) => setFilters((current) => ({ ...current, month: e.target.value }))} />
          <select className={inputCls} value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))}>
            <option value="">全て</option>
            <option value="confirmed">予約確定</option>
            <option value="cancelled">キャンセル</option>
            <option value="completed">完了</option>
          </select>
          <input
            className={inputCls}
            placeholder="ゲスト名で検索"
            value={filters.guest_name}
            onChange={(e) => setFilters((current) => ({ ...current, guest_name: e.target.value }))}
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">ゲスト</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">物件</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">日程</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">OTA</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">状態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredReservations.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">予約がありません</td></tr>
                ) : filteredReservations.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => { setSelected(r); setShowForm(false) }}
                    className={`cursor-pointer transition-colors hover:bg-gray-50 ${selected?.id === r.id ? 'bg-green-50' : ''}`}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.guest_name ?? '未設定'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{properties.find((p) => p.id === r.property_id)?.name ?? '不明'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{r.checkin_date} → {r.checkout_date}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PLATFORM_BADGE[r.platform]}`}>
                        {platformLabel(r.platform)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          {selected && !showForm && (
            <>
              <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-5 py-4">
                  <h2 className="text-sm font-semibold text-gray-900">予約詳細</h2>
                </div>
                <div className="space-y-3 p-5 text-sm">
                  <Row label="ゲスト" value={selected.guest_name ?? '未設定'} />
                  <Row label="メール" value={selected.guest_email ?? '未設定'} />
                  <Row label="人数" value={`${selected.guest_count ?? '?'} 名`} />
                  <Row label="日程" value={`${selected.checkin_date} → ${selected.checkout_date}`} />
                  <Row label="物件" value={properties.find((p) => p.id === selected.property_id)?.name ?? '不明'} />
                  <Row label="OTA" value={platformLabel(selected.platform)} />
                  <Row label="状態" value={selected.status} />
                  {selected.notes && <Row label="メモ" value={selected.notes} />}

                  <div className="border-t border-gray-100 pt-3">
                    <h3 className="mb-3 text-sm font-semibold text-gray-900">売上情報</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">総売上（税込）</label>
                        <input
                          className={inputCls}
                          type="number"
                          value={revenueForm.gross_amount}
                          onChange={(e) => setRevenueForm((current) => ({ ...current, gross_amount: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">OTA手数料</label>
                        <input
                          className={inputCls}
                          type="number"
                          value={revenueForm.ota_fee_amount}
                          onChange={(e) => setRevenueForm((current) => ({ ...current, ota_fee_amount: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">OTA差引後</label>
                        <input
                          className={inputCls}
                          type="number"
                          value={revenueForm.net_amount}
                          onChange={(e) => setRevenueForm((current) => ({ ...current, net_amount: e.target.value }))}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRevenueSave()}
                        disabled={savingRevenue}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                        style={{ backgroundColor: '#06C755' }}
                      >
                        {savingRevenue ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-5 py-4">
                  <h2 className="text-sm font-semibold text-gray-900">宿泊者名簿</h2>
                </div>
                <div className="space-y-4 p-5">
                  {loadingGuests ? (
                    <p className="text-sm text-gray-400">読み込み中...</p>
                  ) : guests.length === 0 ? (
                    <p className="text-sm text-gray-400">宿泊者はまだ登録されていません</p>
                  ) : (
                    <div className="space-y-3">
                      {guests.map((guest) => (
                        <div key={guest.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 text-sm">
                              <p className="font-medium text-gray-900">{guest.guest_name}</p>
                              <p className="text-gray-500">国籍: {guest.nationality || '未設定'}</p>
                              <p className="text-gray-500">パスポート番号: {guest.passport_number || '未設定'}</p>
                              <p className="text-gray-500">住所: {guest.address || '未設定'}</p>
                              <p className="text-gray-500">職業: {guest.occupation || '未設定'}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleDeleteGuest(guest.id)}
                              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                    <h3 className="text-sm font-semibold text-gray-900">＋宿泊者追加</h3>
                    <input className={inputCls} placeholder="名前" value={guestForm.guest_name} onChange={(e) => setGuestForm({ ...guestForm, guest_name: e.target.value })} />
                    <input className={inputCls} placeholder="国籍" value={guestForm.nationality} onChange={(e) => setGuestForm({ ...guestForm, nationality: e.target.value })} />
                    <input className={inputCls} placeholder="パスポート番号" value={guestForm.passport_number} onChange={(e) => setGuestForm({ ...guestForm, passport_number: e.target.value })} />
                    <input className={inputCls} placeholder="住所" value={guestForm.address} onChange={(e) => setGuestForm({ ...guestForm, address: e.target.value })} />
                    <input className={inputCls} placeholder="職業" value={guestForm.occupation} onChange={(e) => setGuestForm({ ...guestForm, occupation: e.target.value })} />
                    <button
                      type="button"
                      onClick={() => void handleAddGuest()}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                      style={{ backgroundColor: '#06C755' }}
                    >
                      追加する
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {showForm && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">手動登録</h2>
                <p className="text-xs text-gray-400">ダブルブッキングはAPI側で検出されます</p>
              </div>
              <div className="space-y-3 p-5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">物件 <span className="text-red-500">*</span></label>
                  <select className={inputCls} value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
                    <option value="">物件を選択</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">OTA</label>
                  <select className={inputCls} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as typeof form.platform })}>
                    <option value="airbnb">Airbnb</option>
                    <option value="booking">Booking.com</option>
                    <option value="direct">直接予約</option>
                    <option value="other">その他</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">ゲスト名</label>
                  <input className={inputCls} placeholder="山田太郎" value={form.guest_name} onChange={(e) => setForm({ ...form, guest_name: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">メール</label>
                  <input className={inputCls} type="email" placeholder="guest@example.com" value={form.guest_email} onChange={(e) => setForm({ ...form, guest_email: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">人数</label>
                  <input className={inputCls} type="number" min="1" value={form.guest_count} onChange={(e) => setForm({ ...form, guest_count: Number(e.target.value) })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">チェックイン <span className="text-red-500">*</span></label>
                    <input className={inputCls} type="date" value={form.checkin_date} onChange={(e) => setForm({ ...form, checkin_date: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">チェックアウト <span className="text-red-500">*</span></label>
                    <input className={inputCls} type="date" value={form.checkout_date} onChange={(e) => setForm({ ...form, checkout_date: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">メモ</label>
                  <textarea className={`${inputCls} min-h-20 py-2`} placeholder="備考など" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    登録する
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </div>
          )}

          {!selected && !showForm && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
              左の一覧から予約を選択してください
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-gray-400">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  )
}

function platformLabel(platform: Reservation['platform']): string {
  if (platform === 'airbnb') return 'Airbnb'
  if (platform === 'booking') return 'Booking.com'
  if (platform === 'direct') return '直接予約'
  return 'その他'
}

function parseAmount(value: string): number | null {
  if (!value.trim()) return null
  return Number(value)
}
