import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { DaysUsedSummary, OccupancyAnalytics, Property, Reservation } from '../lib/types'

export function DashboardPage(): JSX.Element {
  const { token } = useAuth()
  const [properties, setProperties] = useState<Property[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [summaries, setSummaries] = useState<DaysUsedSummary[]>([])
  const [occupancy, setOccupancy] = useState<OccupancyAnalytics[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load(): Promise<void> {
      if (!token) return
      try {
        setError(null)
        const propertyList = await apiFetch<Property[]>('/api/properties', undefined, token)
        const month = new Date().toISOString().slice(0, 7)
        const reservationList = await apiFetch<Reservation[]>(`/api/reservations?month=${month}`, undefined, token)
        const annualSummaries = await Promise.all(
          propertyList.map((property) =>
            apiFetch<DaysUsedSummary>(`/api/reservations/180days/${property.id}`, undefined, token).catch(() => ({
              property_id: property.id,
              property_name: property.name,
              year: new Date().getFullYear(),
              days_used: 0,
              annual_day_limit: property.annual_day_limit,
              remaining_days: property.annual_day_limit,
            })),
          ),
        )
        const range = recentThreeMonthRange()
        const occupancyList = await Promise.all(
          propertyList.map((property) =>
            apiFetch<OccupancyAnalytics>(
              `/api/analytics/occupancy?property_id=${property.id}&from=${range.from}&to=${range.to}`,
              undefined,
              token,
            ).catch(() => ({
              property_id: property.id,
              property_name: property.name,
              period: { ...range, total_days: 0 },
              occupied_days: 0,
              occupancy_rate: 0,
              monthly: [],
            })),
          ),
        )

        setProperties(propertyList)
        setReservations(reservationList)
        setSummaries(annualSummaries)
        setOccupancy(occupancyList)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'ダッシュボードの取得に失敗しました。')
      }
    }
    void load()
  }, [token])

  const today = new Date().toISOString().slice(0, 10)
  const todayCheckins = reservations.filter((r) => r.checkin_date === today)
  const todayCheckouts = reservations.filter((r) => r.checkout_date === today)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ダッシュボード</h1>
        <p className="mt-1 text-sm text-gray-500">今日の運営状況 — {today}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="物件数" value={properties.length} icon="🏢" color="bg-green-100 text-green-700" />
        <StatCard label="今月の予約" value={reservations.length} icon="📋" color="bg-blue-100 text-blue-700" />
        <StatCard label="本日チェックイン" value={todayCheckins.length} icon="🔑" color="bg-amber-100 text-amber-700" />
        <StatCard label="本日チェックアウト" value={todayCheckouts.length} icon="🧳" color="bg-purple-100 text-purple-700" />
      </div>

      {summaries.filter(s => {
        const prop = properties.find(p => p.id === s.property_id) as Record<string, unknown> | undefined
        return !prop || (prop.license_type ?? 'minpaku') === 'minpaku'
      }).length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">民泊新法 年間稼働日数</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {summaries.filter(s => {
              const prop = properties.find(p => p.id === s.property_id) as Record<string, unknown> | undefined
              return !prop || (prop.license_type ?? 'minpaku') === 'minpaku'
            }).map((summary) => {
              const pct = Math.min(100, Math.round((summary.days_used / summary.annual_day_limit) * 100))
              return (
                <div key={summary.property_id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-medium text-gray-700">{summary.property_name}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {summary.days_used}
                    <span className="ml-1 text-sm font-normal text-gray-400">/ {summary.annual_day_limit} 日</span>
                  </p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${pct >= 80 ? 'bg-red-500' : 'bg-[#06C755]'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-400">残り {summary.remaining_days} 日 ({pct}%)</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {occupancy.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">稼働率</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {occupancy.map((item) => {
              const currentKey = currentMonthKey()
              const current = item.monthly.find((month) => month.month === currentKey) ?? item.monthly[item.monthly.length - 1]
              const trend = item.monthly.slice(-3)
              return (
                <div key={item.property_id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="text-sm font-medium text-gray-700">{item.property_name}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{current?.rate ?? 0}%</p>
                  <p className="text-xs text-gray-400">今月の稼働率</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-[#06C755]" style={{ width: `${Math.max(0, Math.min(100, current?.rate ?? 0))}%` }} />
                  </div>
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-500">過去3ヶ月の推移</p>
                    <div className="grid grid-cols-3 gap-2">
                      {trend.map((month) => (
                        <div key={month.month} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                          <p className="text-xs text-gray-500">{month.month}</p>
                          <p className="text-sm font-semibold text-gray-900">{month.rate}%</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <TodayCard title="今日のチェックイン" count={todayCheckins.length}>
          {todayCheckins.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400">本日のチェックインはありません</p>
          ) : todayCheckins.map((r) => (
            <div key={r.id} className="px-5 py-3">
              <p className="text-sm font-medium text-gray-900">{r.guest_name ?? 'ゲスト名未設定'}</p>
              <p className="text-xs text-gray-400">
                {properties.find((p) => p.id === r.property_id)?.name ?? '不明'} / {platformLabel(r.platform)}
              </p>
            </div>
          ))}
        </TodayCard>

        <TodayCard title="今日のチェックアウト" count={todayCheckouts.length}>
          {todayCheckouts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400">本日のチェックアウトはありません</p>
          ) : todayCheckouts.map((r) => (
            <div key={r.id} className="px-5 py-3">
              <p className="text-sm font-medium text-gray-900">{r.guest_name ?? 'ゲスト名未設定'}</p>
              <p className="text-xs text-gray-400">
                {properties.find((p) => p.id === r.property_id)?.name ?? '不明'} / {r.checkout_time ?? '11:00'}
              </p>
            </div>
          ))}
        </TodayCard>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg ${color}`}>{icon}</div>
      </div>
    </div>
  )
}

function TodayCard({ title, count, children }: { title: string; count: number; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-400">{count} 件</p>
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  )
}

function platformLabel(platform: Reservation['platform']): string {
  if (platform === 'airbnb') return 'Airbnb'
  if (platform === 'booking') return 'Booking.com'
  if (platform === 'direct') return '直接予約'
  return 'その他'
}

function recentThreeMonthRange(): { from: string; to: string } {
  const today = new Date()
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1))
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}
