import type { ApiResponse, Env, MessageTemplate } from '../types'

interface TemplateInput {
  name?: string
  category?: string
  language?: string
  body_text?: string
}

export async function templateRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname, searchParams } = url

  if (pathname === '/api/templates') {
    if (request.method === 'GET') return handleListTemplates(env, searchParams)
    if (request.method === 'POST') return handleCreateTemplate(request, env)
    return jsonError('Method Not Allowed', 405)
  }

  const templateId = getIdFromPath(pathname, '/api/templates/')
  if (templateId) {
    if (request.method === 'PATCH') return handlePatchTemplate(request, env, templateId)
    if (request.method === 'DELETE') return handleDeleteTemplate(env, templateId)
    return jsonError('Method Not Allowed', 405)
  }

  return jsonError('Not Found', 404)
}

async function handleListTemplates(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const category = searchParams.get('category')?.trim()
  const language = searchParams.get('language')?.trim()
  const conditions: string[] = []
  const bindings: string[] = []

  if (category) {
    conditions.push('category = ?')
    bindings.push(category)
  }
  if (language) {
    conditions.push('language = ?')
    bindings.push(language)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await env.DB
    .prepare(`
      SELECT *
      FROM message_templates
      ${where}
      ORDER BY updated_at DESC, created_at DESC
    `)
    .bind(...bindings)
    .all<MessageTemplate>()

  return jsonOk(rows.results)
}

async function handleCreateTemplate(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<TemplateInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const normalized = normalizeTemplateInput(payload)
  if (!normalized.ok) return jsonError(normalized.error, 400)

  const inserted = await env.DB
    .prepare(`
      INSERT INTO message_templates (name, category, language, body_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      RETURNING *
    `)
    .bind(normalized.value.name, normalized.value.category, normalized.value.language, normalized.value.body_text)
    .first<MessageTemplate>()

  return jsonOk(inserted)
}

async function handlePatchTemplate(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT * FROM message_templates WHERE id = ?').bind(id).first<MessageTemplate>()
  if (!existing) return jsonError('テンプレートが見つかりません', 404)

  const payload = await safeJson<TemplateInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const normalized = normalizeTemplateInput(payload, existing)
  if (!normalized.ok) return jsonError(normalized.error, 400)

  await env.DB
    .prepare(`
      UPDATE message_templates
      SET name = ?, category = ?, language = ?, body_text = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(normalized.value.name, normalized.value.category, normalized.value.language, normalized.value.body_text, id)
    .run()

  const updated = await env.DB.prepare('SELECT * FROM message_templates WHERE id = ?').bind(id).first<MessageTemplate>()
  return jsonOk(updated)
}

async function handleDeleteTemplate(env: Env, id: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id FROM message_templates WHERE id = ?').bind(id).first<{ id: string }>()
  if (!existing) return jsonError('テンプレートが見つかりません', 404)

  await env.DB.prepare('DELETE FROM message_templates WHERE id = ?').bind(id).run()
  return jsonOk({ id, deleted: true })
}

function normalizeTemplateInput(
  input: TemplateInput,
  existing?: MessageTemplate
): { ok: true; value: Required<TemplateInput> } | { ok: false; error: string } {
  const value: Required<TemplateInput> = {
    name: input.name?.trim() || existing?.name || '',
    category: input.category?.trim() || existing?.category || 'general',
    language: input.language?.trim() || existing?.language || 'ja',
    body_text: input.body_text?.trim() || existing?.body_text || '',
  }

  if (!value.name) return { ok: false, error: 'name は必須です' }
  if (!value.category) return { ok: false, error: 'category は必須です' }
  if (!value.language) return { ok: false, error: 'language は必須です' }
  if (!value.body_text) return { ok: false, error: 'body_text は必須です' }
  return { ok: true, value }
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
