/**
 * LINE Messaging API ユーティリティ
 */

import type { LineEvent } from '../types'

const LINE_API = 'https://api.line.me/v2/bot'

/**
 * LINE Webhook の署名を検証する
 */
export async function verifyLineSignature(
  body: string,
  signature: string,
  channelSecret: string
): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)))
  return expected === signature
}

/**
 * テキストメッセージを返信する
 */
export async function replyText(
  replyToken: string,
  text: string,
  accessToken: string
): Promise<void> {
  await lineApiPost('/message/reply', {
    replyToken,
    messages: [{ type: 'text', text }],
  }, accessToken)
}

/**
 * テキストメッセージをプッシュ送信する
 */
export async function pushText(
  to: string,
  text: string,
  accessToken: string
): Promise<void> {
  await lineApiPost('/message/push', {
    to,
    messages: [{ type: 'text', text }],
  }, accessToken)
}

/**
 * 確認ボタン付きメッセージを送信する
 */
export async function pushConfirm(
  to: string,
  text: string,
  confirmLabel: string,
  declineLabel: string,
  confirmData: string,
  declineData: string,
  accessToken: string
): Promise<void> {
  await lineApiPost('/message/push', {
    to,
    messages: [{
      type: 'template',
      altText: text,
      template: {
        type: 'confirm',
        text,
        actions: [
          { type: 'postback', label: confirmLabel, data: confirmData },
          { type: 'postback', label: declineLabel, data: declineData },
        ],
      },
    }],
  }, accessToken)
}

/**
 * ボタンテンプレート付きメッセージを送信する
 */
export async function pushButtonLink(
  to: string,
  text: string,
  label: string,
  uri: string,
  accessToken: string
): Promise<void> {
  await lineApiPost('/message/push', {
    to,
    messages: [{
      type: 'template',
      altText: text,
      template: {
        type: 'buttons',
        text,
        actions: [
          { type: 'uri', label, uri },
        ],
      },
    }],
  }, accessToken)
}

/**
 * グループにテキストメッセージを送信する
 */
export async function pushGroupText(
  groupId: string,
  text: string,
  accessToken: string
): Promise<void> {
  return pushText(groupId, text, accessToken)
}

/**
 * Multicast（複数ユーザーに同時送信）
 */
export async function multicastText(
  userIds: string[],
  text: string,
  accessToken: string
): Promise<void> {
  await lineApiPost('/message/multicast', {
    to: userIds,
    messages: [{ type: 'text', text }],
  }, accessToken)
}

/**
 * postback.data をパースする
 * 形式: "action=confirm_shift&shift_id=xxx"
 */
export function parsePostbackData(data: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(data))
}

// ─── Rich Menu API ──────────────────────────────────────

/**
 * リッチメニューを作成し richMenuId を返す
 */
export async function createRichMenu(
  menu: Record<string, unknown>,
  accessToken: string
): Promise<string> {
  const res = await fetch(`${LINE_API}/richmenu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(menu),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LINE API createRichMenu error [${res.status}]: ${err}`)
  }
  const data = (await res.json()) as { richMenuId: string }
  return data.richMenuId
}

/**
 * リッチメニューに画像をアップロード
 */
export async function uploadRichMenuImage(
  richMenuId: string,
  imageBuffer: ArrayBuffer,
  accessToken: string
): Promise<void> {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        Authorization: `Bearer ${accessToken}`,
      },
      body: imageBuffer,
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LINE API uploadRichMenuImage error [${res.status}]: ${err}`)
  }
}

/**
 * ユーザーにリッチメニューをリンク
 */
export async function linkRichMenuToUser(
  userId: string,
  richMenuId: string,
  accessToken: string
): Promise<void> {
  const res = await fetch(`${LINE_API}/user/${userId}/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LINE API linkRichMenuToUser error [${res.status}]: ${err}`)
  }
}

/**
 * ユーザーからリッチメニューを解除
 */
export async function unlinkRichMenuFromUser(
  userId: string,
  accessToken: string
): Promise<void> {
  const res = await fetch(`${LINE_API}/user/${userId}/richmenu`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LINE API unlinkRichMenuFromUser error [${res.status}]: ${err}`)
  }
}

/**
 * デフォルトリッチメニューを設定
 */
export async function setDefaultRichMenu(
  richMenuId: string,
  accessToken: string
): Promise<void> {
  const res = await fetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LINE API setDefaultRichMenu error [${res.status}]: ${err}`)
  }
}

/**
 * LINE API への POST リクエスト共通処理
 */
async function lineApiPost(
  path: string,
  body: unknown,
  accessToken: string
): Promise<void> {
  const res = await fetch(`${LINE_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LINE API error [${res.status}]: ${err}`)
  }
}

/**
 * 日付を日本語の読みやすい形式に変換
 * "2026-04-14" → "4月14日(火)"
 *
 * 注意: Cloudflare Workers は UTC 環境のため、JST midnight を Date に渡すと
 * 前日の UTC になって日付がズレる。ここでは文字列から直接 year/month/day を
 * 取り出し、曜日だけ Date.UTC で計算する（タイムゾーン非依存）。
 */
export function formatDateJa(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const weekday = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
  const days = ['日', '月', '火', '水', '木', '金', '土']
  return `${m}月${d}日(${days[weekday]})`
}
