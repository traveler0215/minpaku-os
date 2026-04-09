import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { execSync } from 'node:child_process'

const app = new Hono()

interface ProposeShiftsBody {
  reservations?: unknown
  shift_requests?: unknown
  week_start_date?: string
  notes?: string
}

interface GenerateMessageBody {
  inquiry_text?: string
  reservation?: unknown
  property?: unknown
  language?: string
  tone?: string
}

interface ParseCsvBody {
  platform?: string
  csv_text?: string
}

app.get('/', (c) => c.json({ success: true, data: { service: 'minpaku-os-agent' } }))

app.post('/propose-shifts', async (c) => {
  const body = await safeJson<ProposeShiftsBody>(c)
  if (!Array.isArray(body.reservations)) throw new HTTPException(400, { message: 'reservations は配列で指定してください' })
  if (!Array.isArray(body.shift_requests)) throw new HTTPException(400, { message: 'shift_requests は配列で指定してください' })

  const prompt = [
    'あなたは民泊運営のシフトアサイン担当です。',
    '入力の予約データとスタッフ希望から、無理のない清掃/チェックイン対応シフト案を JSON のみで返してください。',
    '出力形式:',
    '{"shifts":[{"staff_id":"...","property_id":"...","reservation_id":"...","task_type":"cleaning","date":"YYYY-MM-DD","start_time":"HH:MM","end_time":"HH:MM","reason":"..."}]}',
    '補足:',
    '- JSON 以外の説明文を付けない',
    '- task_type は cleaning/checkin/checkout/inspection のいずれか',
    '- 時刻は 24時間表記',
    '',
    JSON.stringify({
      week_start_date: body.week_start_date ?? null,
      notes: body.notes ?? null,
      reservations: body.reservations,
      shift_requests: body.shift_requests,
    }, null, 2),
  ].join('\n')

  const raw = runClaude(prompt)
  return c.json({ success: true, data: parseClaudeJson(raw) })
})

app.post('/generate-message', async (c) => {
  const body = await safeJson<GenerateMessageBody>(c)
  const inquiryText = body.inquiry_text?.trim()
  if (!inquiryText) throw new HTTPException(400, { message: 'inquiry_text は必須です' })

  const prompt = [
    'あなたは日本の民泊ホスト向けカスタマーサポート担当です。',
    '問い合わせに対する返信下書きを作ってください。',
    '簡潔で丁寧、過剰に硬すぎない文面にしてください。',
    '物件の詳細情報（設備、アクセス、ハウスルール、Wi-Fi等）が提供されている場合は、回答に活用してください。',
    `言語: ${body.language ?? 'ja'}`,
    `トーン: ${body.tone ?? 'friendly'}`,
    '',
    JSON.stringify({
      inquiry_text: inquiryText,
      reservation: body.reservation ?? null,
      property: body.property ?? null,
    }, null, 2),
  ].join('\n')

  const draft = runClaude(prompt)
  return c.json({
    success: true,
    data: {
      draft_text: draft.trim(),
    },
  })
})

app.post('/parse-csv', async (c) => {
  const body = await safeJson<ParseCsvBody>(c)
  const csvText = body.csv_text?.trim()
  if (!csvText) throw new HTTPException(400, { message: 'csv_text は必須です' })

  const prompt = [
    'あなたは Airbnb / Booking.com の売上明細を構造化するアシスタントです。',
    '入力はCSVまたはPDFから抽出したテキストです。形式に関わらず内容を解析してください。',
    'JSON のみで返してください（説明文・マークダウン不要）。',
    '出力形式:',
    '{"rows":[{"external_id":"...","guest_name":"...","checkin_date":"YYYY-MM-DD","checkout_date":"YYYY-MM-DD","gross_amount":0,"net_amount":0,"ota_fee_amount":0}]}',
    'ルール:',
    '- external_id は予約番号・確認番号など識別子になるもの',
    '- gross_amount は宿泊料合計（税込）、ota_fee_amount はAirbnb/Booking手数料、net_amount は手取り額',
    '- 日付は必ず YYYY-MM-DD 形式に変換',
    '- 金額は数値のみ（通貨記号・カンマなし）',
    '- 不明値は null',
    '',
    JSON.stringify({
      platform: body.platform ?? null,
      text: csvText,
    }, null, 2),
  ].join('\n')

  const raw = runClaude(prompt)
  return c.json({ success: true, data: parseClaudeJson(raw) })
})

app.onError((error, c) => {
  const status = error instanceof HTTPException ? error.status : 500
  const message = error instanceof HTTPException ? error.message : (error instanceof Error ? error.message : 'Internal Server Error')
  console.error(error)
  return c.json({ success: false, error: message }, status)
})

const port = Number.parseInt(process.env.PORT ?? '8788', 10)
serve({
  fetch: app.fetch,
  port,
})

function runClaude(prompt: string): string {
  return execSync('claude -p', {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000, // 2分でタイムアウト
  }).toString()
}

function parseClaudeJson(raw: string): unknown {
  const direct = tryParseJson(raw)
  if (direct !== null) return direct

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    const parsed = tryParseJson(fenced[1])
    if (parsed !== null) return parsed
  }

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    const parsed = tryParseJson(raw.slice(start, end + 1))
    if (parsed !== null) return parsed
  }

  throw new Error('claude -p の出力を JSON として解釈できませんでした')
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function safeJson<T>(c: { req: { json: <U>() => Promise<U> } }): Promise<T> {
  try {
    return await c.req.json<T>()
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON' })
  }
}
