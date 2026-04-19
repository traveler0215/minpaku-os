export interface Env {
  // Cloudflare D1
  DB: D1Database

  // Cloudflare KV（セッション・キャッシュ）
  KV: KVNamespace

  // 環境変数
  ENVIRONMENT: string
  LINE_CHANNEL_SECRET: string        // LINE Messaging API チャネルシークレット
  LINE_CHANNEL_ACCESS_TOKEN: string  // LINE Messaging API アクセストークン
  LINE_STAFF_CHANNEL_SECRET: string  // スタッフ用チャネル（ゲスト用と別の場合）
  LINE_STAFF_ACCESS_TOKEN: string
  ADMIN_JWT_SECRET: string           // 管理画面JWTシークレット
  LIFF_ID: string
  AGENT_ENDPOINT: string
  ADMIN_URL?: string                    // 管理画面URL（Pages）
  CLOUDFLARE_TURNSTILE_SECRET?: string  // Turnstile（ボット対策、任意）

  // Stripe（SaaS課金）
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRICE_PRO?: string              // Pro plan price ID
  STRIPE_PRICE_PROPERTY_OVERAGE?: string // +¥500/物件 metered price ID
  STRIPE_PRICE_BUSINESS?: string         // Business plan price ID

  // AI（メッセージ生成）
  ANTHROPIC_API_KEY?: string
}

// ─── DB型（スキーマと1対1） ──────────────────────────────

export interface Tenant {
  id: string
  name: string
  subdomain: string | null
  plan: 'trial' | 'free' | 'pro' | 'business' | 'enterprise' | 'cancelled'
  trial_ends_at: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  property_limit: number
  ai_monthly_limit: number
  is_active: number  // 0 or 1
  created_at: string
  updated_at: string
}

export interface Property {
  id: string
  tenant_id: string
  name: string
  address: string
  checkin_time: string
  checkout_time: string
  airbnb_ical_url: string | null
  booking_ical_url: string | null
  own_site_ical_url: string | null
  lock_adapter: 'manual' | 'remotelock' | 'sesame' | 'alfa'
  lock_config_json: string | null
  annual_day_limit: number
  created_at: string
  updated_at: string
}

export interface Reservation {
  id: string
  tenant_id: string
  property_id: string
  platform: 'airbnb' | 'booking' | 'direct' | 'other'
  external_id: string | null
  guest_name: string | null
  guest_email: string | null
  guest_count: number
  checkin_date: string   // YYYY-MM-DD
  checkout_date: string  // YYYY-MM-DD
  checkin_time: string | null
  checkout_time: string | null
  gross_amount: number | null
  net_amount: number | null
  ota_fee_amount: number | null
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'blocked'
  notes: string | null
  raw_ical_data: string | null
  created_at: string
  updated_at: string
}

export interface Staff {
  id: string
  tenant_id: string
  line_user_id: string
  name: string
  role: 'cleaner' | 'checkin' | 'manager'
  employment_type: 'part_time' | 'full_time'
  hourly_wage: number | null
  wage_type: 'hourly' | 'daily'
  is_active: number  // 0 or 1
  invited_at: string | null
  created_at: string
  updated_at: string
}

export interface ShiftRequest {
  id: string
  tenant_id: string
  staff_id: string
  week_start_date: string
  available_dates_json: string  // JSON string
  available_time_json: string   // JSON string
  notes: string | null
  collected_at: string
}

export interface Shift {
  id: string
  tenant_id: string
  staff_id: string
  property_id: string
  reservation_id: string | null
  task_type: 'cleaning' | 'checkin' | 'checkout' | 'inspection'
  date: string
  start_time: string | null
  end_time: string | null
  status: 'proposed' | 'notified' | 'confirmed' | 'declined' | 'completed' | 'cancelled'
  completion_note: string | null
  completion_photo_urls: string | null  // JSON string
  proposed_by: 'system' | 'manual'
  created_at: string
  updated_at: string
}

export interface MessageDraft {
  id: string
  tenant_id: string
  reservation_id: string
  message_type: 'inquiry_reply' | 'checkin_guide' | 'review_reply' | 'custom'
  original_text: string | null
  draft_text: string
  final_text: string | null
  language: string
  status: 'draft' | 'approved' | 'sent'
  created_at: string
  updated_at: string
}

export interface GuestRegistryEntry {
  id: string
  tenant_id: string
  reservation_id: string
  guest_name: string
  nationality: string | null
  passport_number: string | null
  address: string | null
  occupation: string | null
  created_at: string
}

export interface CleaningChecklistItem {
  id: string
  tenant_id: string
  property_id: string
  label: string
  sort_order: number
  created_at: string
}

export interface CleaningChecklistResult {
  id: string
  tenant_id: string
  shift_id: string
  item_id: string
  checked: number
  photo_url: string | null
  checked_at: string | null
}

export interface MessageTemplate {
  id: string
  tenant_id: string
  name: string
  category: string
  language: string
  body_text: string
  created_at: string
  updated_at: string
}

export interface StaffAutoMessage {
  tenant_id: string
  role: 'cleaner' | 'checkin' | 'manager'
  event_type: 'shift_accept' | 'shift_complete' | 'shift_decline'
  body_text: string
  updated_at: string
}

export interface AdminUser {
  id: string
  tenant_id: string
  email: string
  name: string
  role: 'owner' | 'manager' | 'viewer'
  is_active: number
  last_login: string | null
  created_at: string
}

// ─── API レスポンス型 ─────────────────────────────────────

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

// ─── LINE Webhook 型 ──────────────────────────────────────

export interface LineWebhookBody {
  destination: string
  events: LineEvent[]
}

export interface LineEvent {
  type: 'message' | 'follow' | 'unfollow' | 'postback'
  replyToken?: string
  source: { type: 'user' | 'group'; userId: string; groupId?: string }
  timestamp: number
  message?: {
    type: 'text' | 'image'
    id: string
    text?: string
  }
  postback?: { data: string }
}

export interface LaborCost {
  id: string
  tenant_id: string
  shift_id: string
  staff_id: string
  staff_name: string
  property_id: string | null
  date: string
  hours: number | null
  wage_type: 'hourly' | 'daily'
  wage_rate: number | null
  amount: number
  note: string | null
  created_at: string
  updated_at: string
}
