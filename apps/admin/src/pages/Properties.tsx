import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { CleaningChecklistItem, Property } from '../lib/types'

const NEW_ID = '__new__'

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20'

export function PropertiesPage(): JSX.Element {
  const { token } = useAuth()
  const [properties, setProperties] = useState<Property[]>([])
  const [checklistItems, setChecklistItems] = useState<CleaningChecklistItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Property>>({})
  const [newChecklistLabel, setNewChecklistLabel] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(): Promise<void> {
    if (!token) return
    const list = await apiFetch<Property[]>('/api/properties', undefined, token)
    setProperties(list)
  }

  async function loadChecklist(propertyId: string): Promise<void> {
    if (!token) return
    const items = await apiFetch<CleaningChecklistItem[]>(`/api/properties/${propertyId}/checklist`, undefined, token)
    setChecklistItems(items)
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : '物件情報の取得に失敗しました'))
  }, [token])

  useEffect(() => {
    if (!selectedId || selectedId === NEW_ID) {
      setChecklistItems([])
      return
    }
    const property = properties.find((item) => item.id === selectedId)
    if (property) {
      setForm(property)
      void loadChecklist(property.id).catch((e) => setError(e instanceof Error ? e.message : 'チェックリストの取得に失敗しました'))
    }
  }, [selectedId, properties, token])

  function handleNew(): void {
    setSelectedId(NEW_ID)
    setForm({})
    setChecklistItems([])
    setNewChecklistLabel('')
    setMessage(null)
    setError(null)
  }

  async function handleSave(): Promise<void> {
    if (!token) return
    setError(null)
    try {
      if (selectedId === NEW_ID) {
        const result = await apiFetch<{ id: string; property: Property }>('/api/properties', {
          method: 'POST',
          body: JSON.stringify(form),
        }, token)
        await load()
        setSelectedId(result.property.id)
        setMessage('物件を作成しました')
      } else if (selectedId) {
        await apiFetch(`/api/properties/${selectedId}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        }, token)
        await load()
        setMessage('物件設定を更新しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '物件の保存に失敗しました')
    }
  }

  async function handleSync(): Promise<void> {
    if (!token || !selectedId || selectedId === NEW_ID) return
    setError(null)
    try {
      await apiFetch(`/api/properties/${selectedId}/sync-ical`, { method: 'POST' }, token)
      setMessage('iCal 同期を開始しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'iCal 同期に失敗しました')
    }
  }

  async function handleAddChecklistItem(): Promise<void> {
    if (!token || !selectedId || selectedId === NEW_ID) return
    try {
      setError(null)
      await apiFetch(`/api/properties/${selectedId}/checklist`, {
        method: 'POST',
        body: JSON.stringify({ label: newChecklistLabel, sort_order: checklistItems.length }),
      }, token)
      setNewChecklistLabel('')
      await loadChecklist(selectedId)
      setMessage('チェック項目を追加しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'チェック項目の追加に失敗しました')
    }
  }

  async function handleDeleteChecklistItem(itemId: string): Promise<void> {
    if (!token || !selectedId || selectedId === NEW_ID) return
    try {
      setError(null)
      await apiFetch(`/api/checklist/${itemId}`, { method: 'DELETE' }, token)
      await loadChecklist(selectedId)
      setMessage('チェック項目を削除しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'チェック項目の削除に失敗しました')
    }
  }

  async function handleCopyIcalUrl(): Promise<void> {
    if (!selectedId || selectedId === NEW_ID) return
    try {
      await navigator.clipboard.writeText(icalFeedUrl(selectedId))
      setMessage('iCal フィードURLをコピーしました')
    } catch {
      setError('iCal フィードURLのコピーに失敗しました')
    }
  }

  const isNew = selectedId === NEW_ID

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">物件管理</h1>
          <p className="mt-1 text-sm text-gray-500">{properties.length} 件登録済み</p>
        </div>
        <button
          type="button"
          onClick={handleNew}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          style={{ backgroundColor: '#06C755' }}
        >
          ＋ 新規物件を追加
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">物件一覧</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {properties.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-400">物件がありません</p>
            ) : properties.map((property) => (
              <button
                key={property.id}
                type="button"
                onClick={() => { setSelectedId(property.id); setMessage(null); setError(null) }}
                className={`w-full px-5 py-4 text-left transition-colors hover:bg-gray-50 ${selectedId === property.id ? 'border-l-2 border-[#06C755] bg-green-50' : ''}`}
              >
                <p className="text-sm font-medium text-gray-900">{property.name}</p>
                <p className="mt-0.5 text-xs text-gray-400">{property.address}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">{isNew ? '新規物件を登録' : '物件設定'}</h2>
            <p className="text-xs text-gray-400">{isNew ? '物件名と住所は必須です' : 'iCal URL と基本情報を編集できます'}</p>
          </div>

          {!selectedId ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              左の一覧から物件を選択するか、新規物件を追加してください
            </div>
          ) : (
            <div className="space-y-4 p-5">
              {message && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}
              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">物件名 <span className="text-red-500">*</span></label>
                  <input className={inputCls} placeholder="例: 渋谷マンション101" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">住所 <span className="text-red-500">*</span></label>
                  <input className={inputCls} placeholder="例: 東京都渋谷区1-1-1" value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">チェックイン時刻</label>
                  <input className={inputCls} placeholder="15:00" value={form.checkin_time ?? ''} onChange={(e) => setForm({ ...form, checkin_time: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">チェックアウト時刻</label>
                  <input className={inputCls} placeholder="11:00" value={form.checkout_time ?? ''} onChange={(e) => setForm({ ...form, checkout_time: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Airbnb iCal URL</label>
                  <input className={inputCls} placeholder="https://www.airbnb.jp/calendar/ical/..." value={form.airbnb_ical_url ?? ''} onChange={(e) => setForm({ ...form, airbnb_ical_url: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Booking.com iCal URL</label>
                  <input className={inputCls} placeholder="https://ical.booking.com/v1/..." value={form.booking_ical_url ?? ''} onChange={(e) => setForm({ ...form, booking_ical_url: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">自社HP iCal URL</label>
                  <input className={inputCls} placeholder="https://example.com/calendar.ics（Pinpoint Booking 等）" value={form.own_site_ical_url ?? ''} onChange={(e) => setForm({ ...form, own_site_ical_url: e.target.value })} />
                  <p className="mt-1 text-xs text-gray-400">自社サイトやWordPress予約プラグイン（Pinpoint Booking等）が発行する iCal URL を指定します。「direct」プラットフォームで予約が取り込まれます。</p>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">清掃マニュアルURL（PDF/Googleドキュメント等）</label>
                  <input className={inputCls} placeholder="https://docs.google.com/... or https://example.com/manual.pdf" value={(form as Record<string, string>).cleaning_manual_url ?? ''} onChange={(e) => setForm({ ...form, cleaning_manual_url: e.target.value } as typeof form)} />
                  <p className="mt-1 text-xs text-gray-400">LINEでスタッフが「チェックリスト」と送信した時にリンクも表示されます</p>
                </div>
              </div>

              {/* 物件詳細情報 */}
              <div className="border-t border-gray-200 pt-4 mt-4">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">物件詳細（メッセージ生成に利用されます）</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">許可種別</label>
                    <select className={inputCls} value={(form as Record<string, string>).license_type ?? 'minpaku'} onChange={(e) => setForm({ ...form, license_type: e.target.value } as typeof form)}>
                      <option value="minpaku">民泊新法（年間180日制限）</option>
                      <option value="ryokan">旅館業法（日数制限なし）</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">最大定員</label>
                    <input className={inputCls} type="number" min="1" placeholder="例: 6" value={(form as Record<string, string>).max_guests ?? ''} onChange={(e) => setForm({ ...form, max_guests: e.target.value } as typeof form)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">緊急連絡先</label>
                    <input className={inputCls} placeholder="例: 090-xxxx-xxxx" value={(form as Record<string, string>).emergency_contact ?? ''} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value } as typeof form)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Wi-Fi SSID</label>
                    <input className={inputCls} placeholder="例: Minpaku-Guest" value={(form as Record<string, string>).wifi_ssid ?? ''} onChange={(e) => setForm({ ...form, wifi_ssid: e.target.value } as typeof form)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Wi-Fi パスワード</label>
                    <input className={inputCls} placeholder="例: welcome123" value={(form as Record<string, string>).wifi_password ?? ''} onChange={(e) => setForm({ ...form, wifi_password: e.target.value } as typeof form)} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-gray-600">物件紹介・特徴</label>
                    <textarea className={`${inputCls} min-h-20`} placeholder="例: 駅徒歩5分、最上階角部屋、富士山ビュー" value={(form as Record<string, string>).description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value } as typeof form)} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-gray-600">設備・アメニティ</label>
                    <textarea className={`${inputCls} min-h-20`} placeholder="例: キッチン、洗濯機、乾燥機、バスタブ、プロジェクター、駐車場1台" value={(form as Record<string, string>).amenities ?? ''} onChange={(e) => setForm({ ...form, amenities: e.target.value } as typeof form)} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-gray-600">アクセス情報</label>
                    <textarea className={`${inputCls} min-h-20`} placeholder="例: JR渋谷駅南口から徒歩5分。コンビニ隣のビル3F。暗証番号は予約確定後にお知らせします。" value={(form as Record<string, string>).access_info ?? ''} onChange={(e) => setForm({ ...form, access_info: e.target.value } as typeof form)} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-gray-600">ハウスルール</label>
                    <textarea className={`${inputCls} min-h-20`} placeholder="例: 22時以降は静かにお過ごしください。ゴミは分別して指定場所に。土足禁止。" value={(form as Record<string, string>).house_rules ?? ''} onChange={(e) => setForm({ ...form, house_rules: e.target.value } as typeof form)} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-gray-600">備考（内部メモ）</label>
                    <textarea className={`${inputCls} min-h-16`} placeholder="例: 2Fの窓は開けすぎ注意。隣人クレーム歴あり。" value={(form as Record<string, string>).notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value } as typeof form)} />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {isNew ? '登録する' : '保存する'}
                </button>
                {!isNew && (
                  <button
                    type="button"
                    onClick={() => void handleSync()}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    手動同期
                  </button>
                )}
              </div>

              {!isNew && selectedId && (
                <>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <h3 className="text-sm font-semibold text-gray-900">公開 iCal フィード URL</h3>
                    <p className="mt-1 text-xs text-gray-500">このURLを他のOTAの外部カレンダーとして登録すると在庫がブロックされます</p>
                    <div className="mt-3 flex flex-col gap-2 md:flex-row">
                      <input className={inputCls} value={icalFeedUrl(selectedId)} readOnly />
                      <button
                        type="button"
                        onClick={() => void handleCopyIcalUrl()}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700"
                      >
                        コピー
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-200 px-5 py-4">
                      <h3 className="text-sm font-semibold text-gray-900">清掃チェックリスト</h3>
                      <p className="text-xs text-gray-500">清掃完了前の確認項目を物件ごとに管理します</p>
                    </div>
                    <div className="space-y-4 p-5">
                      <div className="flex flex-col gap-2 md:flex-row">
                        <input
                          className={inputCls}
                          placeholder="例: 浴室の水滴を拭き取る"
                          value={newChecklistLabel}
                          onChange={(event) => setNewChecklistLabel(event.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => void handleAddChecklistItem()}
                          className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                          style={{ backgroundColor: '#06C755' }}
                        >
                          ＋項目を追加
                        </button>
                      </div>

                      <div className="overflow-hidden rounded-lg border border-gray-200">
                        <div className="bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                          項目一覧
                        </div>
                        <div className="divide-y divide-gray-100">
                          {checklistItems.length === 0 ? (
                            <p className="px-4 py-6 text-sm text-gray-400">チェック項目はまだありません</p>
                          ) : checklistItems.map((item, index) => (
                            <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                              <p className="text-sm text-gray-900">{index + 1}. {item.label}</p>
                              <button
                                type="button"
                                onClick={() => void handleDeleteChecklistItem(item.id)}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
                              >
                                削除
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function icalFeedUrl(propertyId: string): string {
  // iCal フィードは Worker ドメインで配信されるので VITE_API_BASE_URL を優先
  const origin = import.meta.env.VITE_API_BASE_URL
    ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${origin}/ical/${propertyId}.ics`
}
