import { verifyJwt } from '../lib/auth'
import type { ApiResponse, Env } from '../types'

interface RevenueImportJsonInput {
  platform?: string
  csv_text?: string
  period_from?: string
  period_to?: string
}

interface ParsedCsvRow {
  external_id?: string | null
  guest_name?: string | null
  checkin_date?: string | null
  checkout_date?: string | null
  gross_amount?: number | null
  net_amount?: number | null
  ota_fee_amount?: number | null
}

interface ParsedCsvResponse {
  rows?: unknown
}

interface CostInput {
  property_id?: string
  category?: 'cleaning' | 'supplies' | 'maintenance' | 'utilities' | 'other'
  amount?: number
  date?: string
  description?: string | null
}

interface CostRow {
  id: string
  property_id: string
  category: string
  amount: number
  date: string
  description: string | null
  created_at: string
  property_name: string
}

interface RevenueSummaryRow {
  year_month: string
  year: string
  property_id: string
  property_name: string
  platform: string
  reservation_count: number
  gross_amount_total: number
  ota_fee_amount_total: number
  net_amount_total: number
}

export async function revenueRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname, searchParams } = url

  if (pathname === '/api/revenue/import') {
    if (request.method !== 'POST') return jsonError('Method Not Allowed', 405)
    return handleImportRevenue(request, env)
  }

  if (pathname === '/api/revenue/summary') {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    return handleRevenueSummary(env, searchParams)
  }

  if (pathname === '/api/revenue/export') {
    if (request.method !== 'GET') return jsonError('Method Not Allowed', 405)
    return handleRevenueExport(env, searchParams)
  }

  if (pathname === '/api/costs') {
    if (request.method === 'POST') return handleCreateCost(request, env)
    if (request.method === 'GET') return handleListCosts(env, searchParams)
    return jsonError('Method Not Allowed', 405)
  }

  return jsonError('Not Found', 404)
}

async function handleImportRevenue(request: Request, env: Env): Promise<Response> {
  if (!env.AGENT_ENDPOINT?.trim()) {
    return jsonError('AGENT_ENDPOINT が設定されていません', 500)
  }

  const payload = await readRevenueImportInput(request)
  if (!payload) return jsonError('Invalid request body', 400)

  const platform = payload.platform?.trim().toLowerCase()
  const csvText = payload.csv_text?.trim()

  if (!platform || !['airbnb', 'booking'].includes(platform)) {
    return jsonError('platform は airbnb または booking を指定してください', 400)
  }
  if (!csvText) {
    return jsonError('csv_text は必須です', 400)
  }

  const agentRes = await fetch(joinUrl(env.AGENT_ENDPOINT, '/parse-csv'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform,
      csv_text: csvText,
    }),
  })

  if (!agentRes.ok) {
    const message = await safeReadText(agentRes)
    console.error('parse-csv failed', message)
    return jsonError('CSV の解析に失敗しました', 502)
  }

  const agentBody = await safeJsonFromResponse<{ success?: boolean; data?: ParsedCsvResponse; error?: string }>(agentRes)
  const rows = normalizeParsedRows(agentBody?.data?.rows)
  if (!rows) {
    return jsonError('CSV 解析結果の形式が不正です', 502)
  }

  const periodFrom = payload.period_from?.trim() || detectPeriodFrom(rows) || new Date().toISOString().slice(0, 10)
  const periodTo = payload.period_to?.trim() || detectPeriodTo(rows) || new Date().toISOString().slice(0, 10)

  const importedBy = await getRequesterEmail(request, env)
  const matchedReservationIds: string[] = []
  let matchedCount = 0

  let createdCount = 0

  // デフォルト物件（1件しかない場合に自動紐づけ）
  const defaultProperty = await env.DB
    .prepare('SELECT id FROM properties LIMIT 2')
    .all<{ id: string }>()
  const defaultPropertyId = defaultProperty.results[0]?.id ?? null

  for (const row of rows) {
    const externalId = row.external_id?.trim()

    // external_idがある場合、既存予約にマッチを試みる
    if (externalId) {
      const result = await env.DB
        .prepare(`
          UPDATE reservations
          SET gross_amount = ?, net_amount = ?, ota_fee_amount = ?, updated_at = datetime('now')
          WHERE external_id = ?
        `)
        .bind(
          toIntegerOrNull(row.gross_amount),
          toIntegerOrNull(row.net_amount),
          toIntegerOrNull(row.ota_fee_amount),
          externalId
        )
        .run()

      if ((result.meta.changes ?? 0) > 0) {
        matchedCount += 1
        const matchedRows = await env.DB
          .prepare('SELECT id FROM reservations WHERE external_id = ?')
          .bind(externalId)
          .all<{ id: string }>()
        matchedReservationIds.push(...matchedRows.results.map((matched) => matched.id))
        continue
      }
    }

    // マッチしなかった場合、新規予約として作成
    const checkinDate = row.checkin_date?.trim()
    const checkoutDate = row.checkout_date?.trim()
    if (!checkinDate) continue

    if (!defaultPropertyId) continue  // 物件が特定できない場合はスキップ

    await env.DB
      .prepare(`
        INSERT INTO reservations
          (property_id, platform, external_id, guest_name, guest_email, guest_count,
           checkin_date, checkout_date, gross_amount, net_amount, ota_fee_amount, status,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, 'confirmed', datetime('now'), datetime('now'))
      `)
      .bind(
        defaultPropertyId,
        platform,
        externalId ?? null,
        row.guest_name?.trim() ?? null,
        checkinDate,
        checkoutDate ?? checkinDate,
        toIntegerOrNull(row.gross_amount),
        toIntegerOrNull(row.net_amount),
        toIntegerOrNull(row.ota_fee_amount),
        )
      .run()
    createdCount++
  }

  const importResult = await env.DB
    .prepare(`
      INSERT INTO revenue_imports (platform, period_from, period_to, row_count, matched_count, imported_at, imported_by)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
      RETURNING id, imported_at
    `)
    .bind(platform, periodFrom, periodTo, rows.length, matchedCount, importedBy)
    .first<{ id: string; imported_at: string }>()

  return jsonOk({
    import_id: importResult?.id ?? null,
    platform,
    period_from: periodFrom,
    period_to: periodTo,
    row_count: rows.length,
    matched_count: matchedCount,
    created_count: createdCount,
    unmatched_count: Math.max(0, rows.length - matchedCount - createdCount),
    matched_reservation_ids: Array.from(new Set(matchedReservationIds)),
    imported_at: importResult?.imported_at ?? null,
  })
}

async function handleRevenueSummary(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const month = searchParams.get('month')?.trim()
  const year = searchParams.get('year')?.trim()
  const propertyId = searchParams.get('property_id')?.trim()
  const platform = searchParams.get('platform')?.trim()

  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return jsonError('month は YYYY-MM 形式で指定してください', 400)
  }
  if (year && !/^\d{4}$/.test(year)) {
    return jsonError('year は YYYY 形式で指定してください', 400)
  }

  const conditions = ["r.status NOT IN ('cancelled', 'blocked')"]
  const bindings: string[] = []

  if (month) {
    conditions.push("substr(r.checkin_date, 1, 7) = ?")
    bindings.push(month)
  }
  if (year) {
    conditions.push("substr(r.checkin_date, 1, 4) = ?")
    bindings.push(year)
  }
  if (propertyId) {
    conditions.push('r.property_id = ?')
    bindings.push(propertyId)
  }
  if (platform) {
    conditions.push('r.platform = ?')
    bindings.push(platform)
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const rows = await env.DB
    .prepare(`
      SELECT
        substr(r.checkin_date, 1, 7) AS year_month,
        substr(r.checkin_date, 1, 4) AS year,
        r.property_id,
        p.name AS property_name,
        r.platform,
        COUNT(*) AS reservation_count,
        COALESCE(SUM(r.gross_amount), 0) AS gross_amount_total,
        COALESCE(SUM(r.ota_fee_amount), 0) AS ota_fee_amount_total,
        COALESCE(SUM(r.net_amount), 0) AS net_amount_total
      FROM reservations r
      JOIN properties p ON p.id = r.property_id
      ${where}
      GROUP BY year_month, year, r.property_id, p.name, r.platform
      ORDER BY year_month DESC, p.name ASC, r.platform ASC
    `)
    .bind(...bindings)
    .all<RevenueSummaryRow>()

  const totals = rows.results.reduce((acc, row) => {
    acc.reservation_count += Number(row.reservation_count ?? 0)
    acc.gross_amount_total += Number(row.gross_amount_total ?? 0)
    acc.ota_fee_amount_total += Number(row.ota_fee_amount_total ?? 0)
    acc.net_amount_total += Number(row.net_amount_total ?? 0)
    return acc
  }, {
    reservation_count: 0,
    gross_amount_total: 0,
    ota_fee_amount_total: 0,
    net_amount_total: 0,
  })

  // コスト集計
  const costConditions = ['1 = 1']
  const costBindings: string[] = []
  if (month) { costConditions.push("substr(c.date, 1, 7) = ?"); costBindings.push(month) }
  if (year) { costConditions.push("substr(c.date, 1, 4) = ?"); costBindings.push(year) }
  if (propertyId) { costConditions.push('c.property_id = ?'); costBindings.push(propertyId) }

  const costRows = await env.DB
    .prepare(`
      SELECT COALESCE(SUM(c.amount), 0) AS total_cost
      FROM costs c
      WHERE ${costConditions.join(' AND ')}
    `)
    .bind(...costBindings)
    .first<{ total_cost: number }>()

  const totalCost = Number(costRows?.total_cost ?? 0)

  // 人件費集計
  const laborConditions = ['1 = 1']
  const laborBindings: string[] = []
  if (month) { laborConditions.push("substr(lc.date, 1, 7) = ?"); laborBindings.push(month) }
  if (year) { laborConditions.push("substr(lc.date, 1, 4) = ?"); laborBindings.push(year) }

  const laborRow = await env.DB
    .prepare(`SELECT COALESCE(SUM(lc.amount), 0) AS total_labor FROM labor_costs lc WHERE ${laborConditions.join(' AND ')}`)
    .bind(...laborBindings)
    .first<{ total_labor: number }>()

  const totalLabor = Number(laborRow?.total_labor ?? 0)

  return jsonOk({
    filters: {
      month: month ?? null,
      year: year ?? null,
      property_id: propertyId ?? null,
      platform: platform ?? null,
    },
    totals: {
      ...totals,
      total_cost: totalCost,
      total_labor: totalLabor,
      profit: totals.net_amount_total - totalCost - totalLabor,
    },
    rows: rows.results.map((row) => ({
      ...row,
      reservation_count: Number(row.reservation_count ?? 0),
      gross_amount_total: Number(row.gross_amount_total ?? 0),
      ota_fee_amount_total: Number(row.ota_fee_amount_total ?? 0),
      net_amount_total: Number(row.net_amount_total ?? 0),
    })),
  })
}

async function handleRevenueExport(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const month = searchParams.get('month')?.trim()
  const year = searchParams.get('year')?.trim()
  const propertyId = searchParams.get('property_id')?.trim()

  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return jsonError('month は YYYY-MM 形式で指定してください', 400)
  }
  if (year && !/^\d{4}$/.test(year)) {
    return jsonError('year は YYYY 形式で指定してください', 400)
  }

  const revenueConditions = ["r.status NOT IN ('cancelled', 'blocked')"]
  const costConditions = ['1 = 1']
  const revenueBindings: string[] = []
  const costBindings: string[] = []

  if (month) {
    revenueConditions.push("substr(r.checkin_date, 1, 7) = ?")
    costConditions.push("substr(c.date, 1, 7) = ?")
    revenueBindings.push(month)
    costBindings.push(month)
  }
  if (year) {
    revenueConditions.push("substr(r.checkin_date, 1, 4) = ?")
    costConditions.push("substr(c.date, 1, 4) = ?")
    revenueBindings.push(year)
    costBindings.push(year)
  }
  if (propertyId) {
    revenueConditions.push('r.property_id = ?')
    costConditions.push('c.property_id = ?')
    revenueBindings.push(propertyId)
    costBindings.push(propertyId)
  }

  const revenueRows = await env.DB
    .prepare(`
      SELECT
        'revenue' AS row_type,
        r.checkin_date AS date,
        p.name AS property_name,
        r.platform AS category,
        COALESCE(r.guest_name, '') AS description,
        COALESCE(r.gross_amount, 0) AS gross_amount,
        COALESCE(r.ota_fee_amount, 0) AS ota_fee_amount,
        COALESCE(r.net_amount, 0) AS net_amount
      FROM reservations r
      JOIN properties p ON p.id = r.property_id
      WHERE ${revenueConditions.join(' AND ')}
      ORDER BY r.checkin_date ASC
    `)
    .bind(...revenueBindings)
    .all<{
      row_type: string
      date: string
      property_name: string
      category: string
      description: string
      gross_amount: number
      ota_fee_amount: number
      net_amount: number
    }>()

  const costRows = await env.DB
    .prepare(`
      SELECT
        'cost' AS row_type,
        c.date AS date,
        p.name AS property_name,
        c.category AS category,
        COALESCE(c.description, '') AS description,
        0 AS gross_amount,
        0 AS ota_fee_amount,
        -c.amount AS net_amount
      FROM costs c
      JOIN properties p ON p.id = c.property_id
      WHERE ${costConditions.join(' AND ')}
      ORDER BY c.date ASC
    `)
    .bind(...costBindings)
    .all<{
      row_type: string
      date: string
      property_name: string
      category: string
      description: string
      gross_amount: number
      ota_fee_amount: number
      net_amount: number
    }>()

  const csv = toCsv([
    ['row_type', 'date', 'property_name', 'category', 'description', 'gross_amount', 'ota_fee_amount', 'net_amount'],
    ...revenueRows.results.map((row) => [
      row.row_type,
      row.date,
      row.property_name,
      row.category,
      row.description,
      String(row.gross_amount ?? 0),
      String(row.ota_fee_amount ?? 0),
      String(row.net_amount ?? 0),
    ]),
    ...costRows.results.map((row) => [
      row.row_type,
      row.date,
      row.property_name,
      row.category,
      row.description,
      String(row.gross_amount ?? 0),
      String(row.ota_fee_amount ?? 0),
      String(row.net_amount ?? 0),
    ]),
  ])

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="revenue-export-${month ?? year ?? 'all'}.csv"`,
    },
  })
}

async function handleCreateCost(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<CostInput>(request)
  if (!payload) return jsonError('Invalid JSON', 400)

  const propertyId = payload.property_id?.trim()
  const category = payload.category?.trim()
  const amount = payload.amount
  const date = payload.date?.trim()
  const description = payload.description?.trim() || null

  if (!propertyId || !category || amount === undefined || !date) {
    return jsonError('property_id, category, amount, date は必須です', 400)
  }
  if (!['cleaning', 'supplies', 'maintenance', 'utilities', 'other'].includes(category)) {
    return jsonError('category が不正です', 400)
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return jsonError('amount は0以上で指定してください', 400)
  }
  if (!isDate(date)) {
    return jsonError('date は YYYY-MM-DD 形式で指定してください', 400)
  }

  const property = await env.DB
    .prepare('SELECT id, name FROM properties WHERE id = ?')
    .bind(propertyId)
    .first<{ id: string; name: string }>()
  if (!property) return jsonError('物件が見つかりません', 404)

  const inserted = await env.DB
    .prepare(`
      INSERT INTO costs (property_id, category, amount, date, description, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      RETURNING id, property_id, category, amount, date, description, created_at
    `)
    .bind(propertyId, category, Math.round(amount), date, description)
    .first<{
      id: string
      property_id: string
      category: string
      amount: number
      date: string
      description: string | null
      created_at: string
    }>()

  return jsonOk({
    ...inserted,
    property_name: property.name,
  })
}

async function handleListCosts(env: Env, searchParams: URLSearchParams): Promise<Response> {
  const propertyId = searchParams.get('property_id')?.trim()
  const month = searchParams.get('month')?.trim()

  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return jsonError('month は YYYY-MM 形式で指定してください', 400)
  }

  const conditions: string[] = []
  const bindings: string[] = []

  if (propertyId) {
    conditions.push('c.property_id = ?')
    bindings.push(propertyId)
  }
  if (month) {
    conditions.push('substr(c.date, 1, 7) = ?')
    bindings.push(month)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await env.DB
    .prepare(`
      SELECT c.id, c.property_id, c.category, c.amount, c.date, c.description, c.created_at, p.name AS property_name
      FROM costs c
      JOIN properties p ON p.id = c.property_id
      ${where}
      ORDER BY c.date DESC, c.created_at DESC
    `)
    .bind(...bindings)
    .all<CostRow>()

  const totalAmount = rows.results.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
  return jsonOk({
    total_amount: totalAmount,
    rows: rows.results,
  })
}

async function readRevenueImportInput(request: Request): Promise<RevenueImportJsonInput | null> {
  const contentType = request.headers.get('Content-Type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await request.formData()
      const csvFile = form.get('file')
      const csvTextField = form.get('csv_text')

      let csvText = ''
      if (typeof csvTextField === 'string') {
        csvText = csvTextField
      } else if (csvFile instanceof File) {
        csvText = await csvFile.text()
      }

      return {
        platform: asFormString(form.get('platform')),
        csv_text: csvText,
        period_from: asFormString(form.get('period_from')),
        period_to: asFormString(form.get('period_to')),
      }
    } catch {
      return null
    }
  }

  return safeJson<RevenueImportJsonInput>(request)
}

async function getRequesterEmail(request: Request, env: Env): Promise<string> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return 'unknown'
  const payload = await verifyJwt(auth.slice(7), env.ADMIN_JWT_SECRET)
  return payload?.email ?? 'unknown'
}

function normalizeParsedRows(rows: unknown): ParsedCsvRow[] | null {
  if (!Array.isArray(rows)) return null

  return rows.map((row) => {
    const value = (row && typeof row === 'object') ? row as Record<string, unknown> : {}
    return {
      external_id: asNullableString(value.external_id),
      guest_name: asNullableString(value.guest_name),
      checkin_date: asNullableString(value.checkin_date),
      checkout_date: asNullableString(value.checkout_date),
      gross_amount: asNullableNumber(value.gross_amount),
      net_amount: asNullableNumber(value.net_amount),
      ota_fee_amount: asNullableNumber(value.ota_fee_amount),
    }
  })
}

function detectPeriodFrom(rows: ParsedCsvRow[]): string | null {
  const dates = rows
    .map((row) => row.checkin_date?.trim() ?? '')
    .filter((date): date is string => isDate(date))
    .sort()
  return dates[0] ?? null
}

function detectPeriodTo(rows: ParsedCsvRow[]): string | null {
  const dates = rows
    .map((row) => row.checkout_date?.trim() ?? row.checkin_date?.trim() ?? '')
    .filter((date): date is string => isDate(date))
    .sort()
  return dates[dates.length - 1] ?? null
}

function toIntegerOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Math.round(value)
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asFormString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map(csvEscape).join(','))
    .join('\n')
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
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
