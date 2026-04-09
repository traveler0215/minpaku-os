export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

export interface Property {
  id: string
  name: string
  address: string
  checkin_time: string
  checkout_time: string
  airbnb_ical_url: string | null
  booking_ical_url: string | null
  lock_adapter: 'manual' | 'remotelock' | 'sesame' | 'alfa'
  lock_config_json: string | null
  annual_day_limit: number
  created_at: string
  updated_at: string
}

export interface Reservation {
  id: string
  property_id: string
  platform: 'airbnb' | 'booking' | 'direct' | 'other'
  external_id: string | null
  guest_name: string | null
  guest_email: string | null
  guest_count: number
  checkin_date: string
  checkout_date: string
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
  line_user_id: string
  name: string
  role: 'cleaner' | 'checkin' | 'manager'
  employment_type: 'part_time' | 'full_time'
  hourly_wage: number | null
  wage_type: 'hourly' | 'daily'
  is_active: number
  invited_at: string | null
  created_at: string
  updated_at: string
  property_ids?: string[]
}

export interface Shift {
  id: string
  staff_id: string
  property_id: string
  reservation_id: string | null
  task_type: 'cleaning' | 'checkin' | 'checkout' | 'inspection'
  date: string
  start_time: string | null
  end_time: string | null
  status: 'proposed' | 'notified' | 'confirmed' | 'declined' | 'completed' | 'cancelled'
  completion_note: string | null
  completion_photo_urls: string | null
  proposed_by: 'system' | 'manual'
  created_at: string
  updated_at: string
}

export interface MessageDraft {
  id: string
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
  property_id: string
  label: string
  sort_order: number
  created_at: string
}

export interface CleaningChecklistResult {
  id: string
  shift_id: string
  item_id: string
  checked: number
  photo_url: string | null
  checked_at: string | null
}

export interface MessageTemplate {
  id: string
  name: string
  category: string
  language: string
  body_text: string
  created_at: string
  updated_at: string
}

export interface AdminUser {
  id: string
  email: string
  name: string
  role: 'owner' | 'manager' | 'viewer'
  is_active: number
  last_login: string | null
  created_at: string
}

export interface DaysUsedSummary {
  property_id: string
  property_name: string
  year: number
  days_used: number
  annual_day_limit: number
  remaining_days: number
}

export interface OccupancyMonthly {
  month: string
  occupied_days: number
  total_days: number
  rate: number
}

export interface OccupancyAnalytics {
  property_id: string
  property_name: string
  period: {
    from: string
    to: string
    total_days: number
  }
  occupied_days: number
  occupancy_rate: number
  monthly: OccupancyMonthly[]
}
