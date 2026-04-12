import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { MessageDraft, MessageTemplate, Reservation, Property } from '../lib/types'

const inputClassName = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20'

const STATUS_BADGE: Record<MessageDraft['status'], string> = {
  draft: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  sent: 'bg-blue-100 text-blue-700',
}

const MESSAGE_TYPE_LABEL: Record<MessageDraft['message_type'], string> = {
  inquiry_reply: '問い合わせ返信',
  checkin_guide: 'チェックイン案内',
  review_reply: 'レビュー返信',
  custom: 'カスタム',
}

const AGENT_ENABLED = import.meta.env.VITE_AGENT_ENABLED === 'true'

export function MessagesPage(): JSX.Element {
  const { token } = useAuth()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<'drafts' | 'templates'>('drafts')
  const [drafts, setDrafts] = useState<MessageDraft[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [reservationId, setReservationId] = useState(searchParams.get('reservation_id') ?? '')
  const [originalText, setOriginalText] = useState('')
  const [draftText, setDraftText] = useState('')
  const [finalText, setFinalText] = useState('')
  const [templateForm, setTemplateForm] = useState<Partial<MessageTemplate>>({
    category: 'general',
    language: 'ja',
  })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(nextSelectedId?: string | null): Promise<void> {
    if (!token) return
    try {
      setError(null)
      const result = await apiFetch<MessageDraft[]>('/api/messages', undefined, token)
      setDrafts(result)
      const selected = nextSelectedId
        ? result.find((draft) => draft.id === nextSelectedId) ?? null
        : result.find((draft) => draft.id === selectedId) ?? result[0] ?? null
      setSelectedId(selected?.id ?? null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '下書き一覧の取得に失敗しました。')
    }
  }

  async function loadTemplates(nextSelectedTemplateId?: string | null): Promise<void> {
    if (!token) return
    try {
      setError(null)
      const result = await apiFetch<MessageTemplate[]>('/api/templates', undefined, token)
      setTemplates(result)
      const selected = nextSelectedTemplateId
        ? result.find((template) => template.id === nextSelectedTemplateId) ?? null
        : result.find((template) => template.id === selectedTemplateId) ?? result[0] ?? null
      setSelectedTemplateId(selected?.id ?? null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'テンプレート一覧の取得に失敗しました。')
    }
  }

  async function loadReservations(): Promise<void> {
    if (!token) return
    const [resList, propList] = await Promise.all([
      apiFetch<Reservation[]>('/api/reservations', undefined, token),
      apiFetch<Property[]>('/api/properties', undefined, token),
    ])
    setReservations(resList)
    setProperties(propList)
  }

  useEffect(() => {
    void load()
    void loadTemplates()
    void loadReservations()
  }, [token])

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedId) ?? null,
    [drafts, selectedId],
  )

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  )

  useEffect(() => {
    setDraftText(selectedDraft?.draft_text ?? '')
    setFinalText(selectedDraft?.final_text ?? selectedDraft?.draft_text ?? '')
  }, [selectedDraft])

  useEffect(() => {
    setTemplateForm(selectedTemplate ?? { category: 'general', language: 'ja' })
  }, [selectedTemplate])

  async function handleGenerate(): Promise<void> {
    if (!token) return
    try {
      setError(null)
      setMessage(null)
      const created = await apiFetch<MessageDraft>('/api/messages/generate', {
        method: 'POST',
        body: JSON.stringify({ reservation_id: reservationId, inquiry_text: originalText }),
      }, token)
      setReservationId('')
      setOriginalText('')
      setMessage('下書きを生成しました。')
      await load(created.id)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '下書き生成に失敗しました。')
    }
  }

  async function handleSave(status: MessageDraft['status']): Promise<void> {
    if (!token || !selectedDraft) return
    try {
      setError(null)
      setMessage(null)
      await apiFetch<MessageDraft>(`/api/messages/${selectedDraft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          draft_text: draftText,
          final_text: finalText || null,
          status,
        }),
      }, token)
      setMessage(status === 'approved' ? '下書きを承認しました。' : '下書きを更新しました。')
      await load(selectedDraft.id)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '下書き更新に失敗しました。')
    }
  }

  async function handleSend(): Promise<void> {
    if (!token || !selectedDraft) return
    try {
      setError(null)
      setMessage(null)
      await apiFetch<MessageDraft>(`/api/messages/${selectedDraft.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ final_text: finalText || draftText }),
      }, token)
      setMessage('送信用テキストを保存しました。')
      await load(selectedDraft.id)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '送信処理に失敗しました。')
    }
  }

  async function handleSaveTemplate(): Promise<void> {
    if (!token) return
    try {
      setError(null)
      setMessage(null)
      if (selectedTemplateId) {
        await apiFetch<MessageTemplate>(`/api/templates/${selectedTemplateId}`, {
          method: 'PATCH',
          body: JSON.stringify(templateForm),
        }, token)
        setMessage('テンプレートを更新しました。')
        await loadTemplates(selectedTemplateId)
        return
      }

      const created = await apiFetch<MessageTemplate>('/api/templates', {
        method: 'POST',
        body: JSON.stringify(templateForm),
      }, token)
      setMessage('テンプレートを作成しました。')
      await loadTemplates(created.id)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'テンプレート保存に失敗しました。')
    }
  }

  async function handleDeleteTemplate(templateId: string): Promise<void> {
    if (!token) return
    try {
      setError(null)
      setMessage(null)
      await apiFetch(`/api/templates/${templateId}`, { method: 'DELETE' }, token)
      setSelectedTemplateId(null)
      setTemplateForm({ category: 'general', language: 'ja' })
      setMessage('テンプレートを削除しました。')
      await loadTemplates(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'テンプレート削除に失敗しました。')
    }
  }

  function handleInsertTemplate(template: MessageTemplate): void {
    setOriginalText((current) => current ? `${current}\n\n${template.body_text}` : template.body_text)
    setActiveTab('drafts')
    setMessage(`テンプレート「${template.name}」を本文に挿入しました。`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">メッセージ下書き</h1>
        <p className="mt-1 text-sm text-gray-500">生成済みの返信案を確認し、編集・承認・送信用に確定します</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('drafts')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${activeTab === 'drafts' ? 'text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
          style={activeTab === 'drafts' ? { backgroundColor: '#06C755' } : undefined}
        >
          下書き
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('templates')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${activeTab === 'templates' ? 'text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
          style={activeTab === 'templates' ? { backgroundColor: '#06C755' } : undefined}
        >
          テンプレート
        </button>
      </div>

      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {activeTab === 'drafts' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900">新規生成</h2>
              <p className="mt-1 text-xs text-gray-500">予約IDと問い合わせ本文から返信下書きを作成します</p>
              <div className="mt-4 grid gap-3">
                <select
                  className={inputClassName}
                  value={reservationId}
                  onChange={(event) => setReservationId(event.target.value)}
                >
                  <option value="">予約を選択</option>
                  {reservations.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.checkin_date}〜{r.checkout_date} / {properties.find(p => p.id === r.property_id)?.name ?? '不明'} / {r.guest_name ?? 'ゲスト未設定'} ({r.platform})
                    </option>
                  ))}
                </select>
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    className={inputClassName}
                    value={selectedTemplateId ?? ''}
                    onChange={(event) => setSelectedTemplateId(event.target.value || null)}
                  >
                    <option value="">テンプレートを選択</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} / {template.category} / {template.language}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => selectedTemplate && handleInsertTemplate(selectedTemplate)}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700"
                  >
                    本文に挿入
                  </button>
                </div>
                <textarea
                  className={`${inputClassName} min-h-32`}
                  placeholder="ゲストからの問い合わせ文"
                  value={originalText}
                  onChange={(event) => setOriginalText(event.target.value)}
                />
                {AGENT_ENABLED && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                      style={{ backgroundColor: '#06C755' }}
                    >
                      生成する
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">下書き一覧</h2>
                <p className="text-xs text-gray-500">{drafts.length} 件</p>
              </div>
              <div className="divide-y divide-gray-100">
                {drafts.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-gray-400">下書きはまだありません</p>
                ) : drafts.map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    onClick={() => setSelectedId(draft.id)}
                    className={`block w-full px-5 py-4 text-left hover:bg-gray-50 ${selectedId === draft.id ? 'bg-green-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{MESSAGE_TYPE_LABEL[draft.message_type]}</p>
                        <p className="mt-1 text-xs text-gray-400">予約ID: {draft.reservation_id}</p>
                        <p className="mt-2 line-clamp-2 text-sm text-gray-600">{draft.final_text ?? draft.draft_text}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[draft.status]}`}>
                        {draft.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-900">編集パネル</h2>
              <p className="text-xs text-gray-500">下書きの内容を確認して承認フローを進めます</p>
            </div>
            {!selectedDraft ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">左の一覧から下書きを選択してください</div>
            ) : (
              <div className="space-y-4 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[selectedDraft.status]}`}>
                    {selectedDraft.status}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {MESSAGE_TYPE_LABEL[selectedDraft.message_type]}
                  </span>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">問い合わせ原文</label>
                  <textarea
                    className={`${inputClassName} min-h-24 bg-gray-50 text-gray-600`}
                    value={selectedDraft.original_text ?? ''}
                    readOnly
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">下書き</label>
                  <textarea
                    className={`${inputClassName} min-h-36`}
                    value={draftText}
                    onChange={(event) => setDraftText(event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">最終版テキスト</label>
                  <textarea
                    className={`${inputClassName} min-h-36`}
                    value={finalText}
                    onChange={(event) => setFinalText(event.target.value)}
                  />
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleSave('draft')}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSave('approved')}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    承認
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    送信用に保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">テンプレート一覧</h2>
                  <p className="text-xs text-gray-500">{templates.length} 件</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedTemplateId(null); setTemplateForm({ category: 'general', language: 'ja' }) }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: '#06C755' }}
                >
                  ＋テンプレート追加
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">名前</th>
                    <th className="px-4 py-3 text-left">カテゴリ</th>
                    <th className="px-4 py-3 text-left">言語</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {templates.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">テンプレートはまだありません</td>
                    </tr>
                  ) : templates.map((template) => (
                    <tr key={template.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">{template.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{template.category}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{template.language}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleInsertTemplate(template)}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
                          >
                            挿入
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedTemplateId(template.id)}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteTemplate(template.id)}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
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

          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-900">{selectedTemplateId ? 'テンプレート編集' : 'テンプレート作成'}</h2>
              <p className="text-xs text-gray-500">名前・カテゴリ・本文を管理します</p>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">名前</label>
                <input
                  className={inputClassName}
                  value={templateForm.name ?? ''}
                  onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">カテゴリ</label>
                  <input
                    className={inputClassName}
                    value={templateForm.category ?? 'general'}
                    onChange={(event) => setTemplateForm({ ...templateForm, category: event.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">言語</label>
                  <input
                    className={inputClassName}
                    value={templateForm.language ?? 'ja'}
                    onChange={(event) => setTemplateForm({ ...templateForm, language: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">本文</label>
                <textarea
                  className={`${inputClassName} min-h-56`}
                  value={templateForm.body_text ?? ''}
                  onChange={(event) => setTemplateForm({ ...templateForm, body_text: event.target.value })}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveTemplate()}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: '#06C755' }}
                >
                  保存
                </button>
                {selectedTemplate && (
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate(selectedTemplate)}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700"
                  >
                    下書き生成欄に挿入
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
