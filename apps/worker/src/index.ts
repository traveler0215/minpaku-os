import { handleDailyReport, handleICalSync, handleDailyTasks, handleWeeklyReport, handleWeeklyShift } from './lib/cron'
import { handleLineWebhook } from './routes/webhook'
import { reservationRoutes } from './routes/reservations'
import { staffRoutes } from './routes/staff'
import { shiftRoutes } from './routes/shifts'
import { propertyRoutes } from './routes/properties'
import { revenueRoutes } from './routes/revenue'
import { messageDraftRoutes } from './routes/message-drafts'
import { authRoutes } from './routes/auth'
import { adminUserRoutes } from './routes/admin-users'
import { checklistRoutes } from './routes/checklist'
import { templateRoutes } from './routes/templates'
import { staffAutoMessageRoutes } from './routes/staff-auto-messages'
import { analyticsRoutes } from './routes/analytics'
import { handleIcalFeed } from './routes/ical-feed'
import { guestRoutes } from './routes/guests'
import { laborRoutes } from './routes/labor'
import { verifyAdminToken } from './lib/auth'
import type { Env } from './types'

export default {
  /**
   * HTTP リクエストハンドラー
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    // CORS プリフライト
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() })
    }

    // LINE Webhook（認証不要 / LINE署名検証）
    if (pathname === '/webhook/line') {
      return handleLineWebhook(request, env, ctx)
    }

    if (pathname.startsWith('/ical/')) {
      return handleIcalFeed(request, env)
    }

    // LIFF からのシフト希望送信（JWT不要）
    if (pathname === '/api/shift-requests') {
      return withCors(await shiftRoutes(request, env))
    }

    // 認証 API（ログイン導線は JWT 不要、/me はルート内で検証）
    if (pathname.startsWith('/api/auth')) {
      return withCors(await authRoutes(request, env))
    }

    // 管理API（認証必須）
    if (pathname.startsWith('/api/')) {
      const authError = await verifyAdminToken(request, env)
      if (authError) return withCors(authError)

      if (pathname.includes('/checklist'))          return withCors(await checklistRoutes(request, env))
      if (pathname.endsWith('/guests'))             return withCors(await guestRoutes(request, env))
      if (pathname.startsWith('/api/guests/'))      return withCors(await guestRoutes(request, env))
      if (pathname.startsWith('/api/reservations')) return withCors(await reservationRoutes(request, env))
      if (pathname === '/api/staff-auto-messages') return withCors(await staffAutoMessageRoutes(request, env))
      if (pathname.startsWith('/api/staff'))        return withCors(await staffRoutes(request, env))
      if (pathname.startsWith('/api/shifts'))       return withCors(await shiftRoutes(request, env))
      if (pathname.startsWith('/api/properties'))   return withCors(await propertyRoutes(request, env))
      if (pathname.startsWith('/api/revenue'))      return withCors(await revenueRoutes(request, env))
      if (pathname.startsWith('/api/costs'))        return withCors(await revenueRoutes(request, env))
      if (pathname.startsWith('/api/messages'))     return withCors(await messageDraftRoutes(request, env))
      if (pathname.startsWith('/api/templates'))    return withCors(await templateRoutes(request, env))
      if (pathname.startsWith('/api/analytics'))    return withCors(await analyticsRoutes(request, env))
      if (pathname.startsWith('/api/admin-users'))  return withCors(await adminUserRoutes(request, env))
      if (pathname.startsWith('/api/labor-costs'))  return withCors(await laborRoutes(request, env))

      // LINE 設定 API（KV ベース）
      if (pathname === '/api/settings/line') {
        if (request.method === 'GET') {
          const hideGuestName = await env.KV.get('config:hide_guest_name') === 'true'
          const showPlatform = await env.KV.get('config:show_platform') === 'true'
          const notifyNoActivity = await env.KV.get('config:notify_no_activity') !== 'false'
          return withCors(new Response(JSON.stringify({ success: true, data: { hide_guest_name: hideGuestName, show_platform: showPlatform, notify_no_activity: notifyNoActivity } }), {
            headers: { 'Content-Type': 'application/json' },
          }))
        }
        if (request.method === 'PATCH') {
          const body = await request.json() as { hide_guest_name?: boolean; show_platform?: boolean; notify_no_activity?: boolean }
          for (const [key, kvKey] of [['hide_guest_name', 'config:hide_guest_name'], ['show_platform', 'config:show_platform']] as const) {
            const val = body[key]
            if (val !== undefined) {
              if (val) await env.KV.put(kvKey, 'true')
              else await env.KV.delete(kvKey)
            }
          }
          if (body.notify_no_activity !== undefined) {
            if (body.notify_no_activity) await env.KV.delete('config:notify_no_activity')
            else await env.KV.put('config:notify_no_activity', 'false')
          }
          const hideGuestName = await env.KV.get('config:hide_guest_name') === 'true'
          const showPlatform = await env.KV.get('config:show_platform') === 'true'
          const notifyNoActivity = await env.KV.get('config:notify_no_activity') !== 'false'
          return withCors(new Response(JSON.stringify({ success: true, data: { hide_guest_name: hideGuestName, show_platform: showPlatform, notify_no_activity: notifyNoActivity } }), {
            headers: { 'Content-Type': 'application/json' },
          }))
        }
      }

      return withCors(new Response('Not Found', { status: 404 }))
    }

    return new Response('minpaku-os worker', { status: 200 })
  },

  /**
   * Cron トリガーハンドラー
   */
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const cron = event.cron

    switch (cron) {
      case '0 * * * *':   // 毎時: iCal同期
        await handleICalSync(env)
        break
      case '0 8 * * *':   // 毎日08:00: 清掃タスク発行
        await handleDailyTasks(env, cron)
        break
      case '0 23 * * *':  // 毎日23:00: 翌日チェックイン確認
        await handleDailyTasks(env, cron)
        await handleDailyReport(env)
        break
      case '0 9 * * 1':   // 毎週月曜: シフト希望収集
        await handleWeeklyShift(env)
        await handleWeeklyReport(env)
        break
    }
  },
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v))
  return new Response(response.body, { status: response.status, headers })
}
