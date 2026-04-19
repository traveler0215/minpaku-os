import type { ApiResponse, Env, MessageDraft, Reservation } from '../types'

interface GenerateMessageInput {
  inquiry_text?: string
  reservation_id?: string
  message_type?: MessageDraft['message_type']
  language?: string
  tone?: string
}

interface DraftPatchInput {
  draft_text?: string
  final_text?: string | null
  status?: MessageDraft['status']
  language?: string
}

interface AgentGenerateResponse {
  draft_text?: string
}

export async function messageDraftRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname, searchParams } = url
  const draftId = getIdFromPath(pathname, '/api/messages/')

  if (pathname === '/api/messages/generate') {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    return handleGenerateMessage(request, env)
  }

  if (pathname === '/api/messages') {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    return handleListMessages(env, searchParams)
  }

  if (pathname.endsWith('/send') && pathname.startsWith('/api/messages/')) {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    const id = pathname.slice('/api/messages/'.length, -'/send'.length)
    return handleSendMessage(request, env, id)
  }

  if (draftId) {
    if (request.method !== 'PATCH') return jsonError('Method Not Allowed', 405)
    return handlePatchMessage(request, env, draftId)
  }

  return jsonError('Not Found', 404)
}

async function handleGenerateMessage(request: Request, env: Env): Promise<Response> {
  if (!env.AGENT_ENDPOINT?.trim()) {
    return jsonError('AGENT_ENDPOINT が設定されていません', 500)
  }

  const payload = await safeJson<GenerateMessageInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const inquiryText = payload.inquiry_text?.trim()
  const reservationId = payload.reservation_id?.trim()
  const messageType = payload.message_type ?? 'inquiry_reply'
  const language = payload.language?.trim() || 'ja'
  const tone = payload.tone?.trim() || 'friendly'

  if (!inquiryText || !reservationId) {
    return jsonError('inquiry_text と reservation_id は必須です', 400)
  }

  const reservation = await env.DB
    .prepare('SELECT * FROM reservations WHERE id = ?')
    .bind(reservationId)
    .first<Reservation>()

  if (!reservation) {
    return jsonError('予約が見つかりません', 404)
  }

  // 物件詳細情報を取得してメッセージ生成に渡す
  const property = await env.DB
    .prepare('SELECT name, address, description, amenities, access_info, house_rules, wifi_ssid, wifi_password, emergency_contact, checkin_time, checkout_time, max_guests FROM properties WHERE id = ?')
    .bind(reservation.property_id)
    .first()

  const agentRes = await fetch(joinUrl(env.AGENT_ENDPOINT, '/generate-message'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inquiry_text: inquiryText,
      reservation,
      property,
      language,
      tone,
    }),
  })

  if (!agentRes.ok) {
    const message = await safeReadText(agentRes)
    console.error('generate-message failed', message)
    return jsonError('下書き生成に失敗しました', 502)
  }

  const agentBody = await safeJsonFromResponse<{ success?: boolean; data?: AgentGenerateResponse }>(agentRes)
  const draftText = agentBody?.data?.draft_text?.trim()
  if (!draftText) {
    return jsonError('下書き生成結果が不正です', 502)
  }

  const inserted = await env.DB
    .prepare(`
      INSERT INTO message_drafts (
        reservation_id, message_type, original_text, draft_text, final_text, language, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, NULL, ?, 'draft', datetime('now'), datetime('now'))
      RETURNING *
    `)
    .bind(reservationId, messageType, inquiryText, draftText, language)
    .first<MessageDraft>()

  return jsonOk(inserted)
}

async function handleListMessages(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const reservationId = searchParams.get('reservation_id')?.trim()

  const rows = reservationId
    ? await env.DB
        .prepare(`
          SELECT *
          FROM message_drafts
          WHERE reservation_id = ?
          ORDER BY created_at DESC
        `)
        .bind(reservationId)
        .all<MessageDraft>()
    : await env.DB
        .prepare(`
          SELECT *
          FROM message_drafts
          ORDER BY created_at DESC
        `)
        .all<MessageDraft>()

  return jsonOk(rows.results)
}

async function handlePatchMessage(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT * FROM message_drafts WHERE id = ?')
    .bind(id)
    .first<MessageDraft>()

  if (!existing) return jsonError('下書きが見つかりません', 404)

  const payload = await safeJson<DraftPatchInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const draftText = payload.draft_text !== undefined ? payload.draft_text.trim() : existing.draft_text
  const finalText = payload.final_text !== undefined ? (payload.final_text?.trim() || null) : existing.final_text
  const status = payload.status ?? existing.status
  const language = payload.language?.trim() || existing.language

  if (!draftText) return jsonError('draft_text は空にできません', 400)
  if (!['draft', 'approved', 'sent'].includes(status)) {
    return jsonError('status が不正です', 400)
  }
  if (status === 'approved' && !(finalText || draftText)) {
    return jsonError('approved にするには本文が必要です', 400)
  }

  await env.DB
    .prepare(`
      UPDATE message_drafts
      SET draft_text = ?, final_text = ?, status = ?, language = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(draftText, finalText, status, language, id)
    .run()

  const updated = await env.DB
    .prepare('SELECT * FROM message_drafts WHERE id = ?')
    .bind(id)
    .first<MessageDraft>()

  return jsonOk(updated)
}

async function handleSendMessage(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT * FROM message_drafts WHERE id = ?')
    .bind(id)
    .first<MessageDraft>()

  if (!existing) return jsonError('下書きが見つかりません', 404)

  const payload = await safeJson<{ final_text?: string }>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const finalText = payload.final_text?.trim() || existing.final_text?.trim() || existing.draft_text.trim()
  if (!finalText) return jsonError('final_text は必須です', 400)

  await env.DB
    .prepare(`
      UPDATE message_drafts
      SET final_text = ?, status = 'sent', updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(finalText, id)
    .run()

  const updated = await env.DB
    .prepare('SELECT * FROM message_drafts WHERE id = ?')
    .bind(id)
    .first<MessageDraft>()

  return jsonOk(updated)
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function getIdFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  return rest && !rest.includes('/') ? rest : null
}

async function safeJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

async function safeJsonFromResponse<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function jsonOk<T>(data: T): Response {
  const body: ApiResponse<T> = { success: true, data }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jsonError(error: string, status: number): Response {
  const body: ApiResponse<never> = { success: false, error }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
