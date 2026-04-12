import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { Property } from '../lib/types'

type RevenueTab = 'revenue' | 'costs'
type CostCategory = 'cleaning' | 'supplies' | 'maintenance' | 'utilities' | 'other'

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
    pages.push(text)
  }
  return pages.join('\n')
}

interface RevenueSummaryRow {
  year_month: string
  property_name: string
  platform: string
  reservation_count: number
  gross_amount_total: number
  ota_fee_amount_total: number
  net_amount_total: number
}

interface RevenueSummaryResponse {
  totals: { reservation_count: number; gross_amount_total: number; ota_fee_amount_total: number; net_amount_total: number; total_cost?: number; total_labor?: number; profit?: number }
  rows: RevenueSummaryRow[]
}

interface CostRow {
  id: string
  property_id: string
  category: CostCategory
  amount: number
  date: string
  description: string | null
  created_at: string
  property_name: string
}

interface CostListResponse {
  total_amount: number
  rows: CostRow[]
}

type ImportStep = 'idle' | 'extracting' | 'importing' | 'done'

const inputClassName = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20'

const categoryBadgeClass: Record<CostCategory, string> = {
  cleaning: 'bg-blue-100 text-blue-700',
  supplies: 'bg-yellow-100 text-yellow-700',
  maintenance: 'bg-red-100 text-red-700',
  utilities: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-600',
}

const AGENT_ENABLED = import.meta.env.VITE_AGENT_ENABLED === 'true'

export function RevenuePage(): JSX.Element {
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState<RevenueTab>('revenue')
  const [properties, setProperties] = useState<Property[]>([])
  const [summary, setSummary] = useState<RevenueSummaryRow[]>([])
  const [summaryTotals, setSummaryTotals] = useState<RevenueSummaryResponse['totals'] | null>(null)
  const [costs, setCosts] = useState<CostRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [step, setStep] = useState<ImportStep>('idle')
  const [extractedText, setExtractedText] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [platform, setPlatform] = useState<'airbnb' | 'booking'>('airbnb')
  const [costForm, setCostForm] = useState({
    property_id: '',
    category: 'cleaning' as CostCategory,
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    description: '',
  })
  const fileRef = useRef<HTMLInputElement>(null)

  async function load(): Promise<void> {
    if (!token) return
    const [propertyList, summaryData, costData] = await Promise.all([
      apiFetch<Property[]>('/api/properties', undefined, token),
      apiFetch<RevenueSummaryResponse>('/api/revenue/summary', undefined, token).catch(() => ({
        totals: { reservation_count: 0, gross_amount_total: 0, ota_fee_amount_total: 0, net_amount_total: 0, total_cost: 0, profit: 0 },
        rows: [],
      })),
      apiFetch<CostListResponse>('/api/costs', undefined, token).catch(() => ({ total_amount: 0, rows: [] })),
    ])
    setProperties(propertyList)
    setSummary(summaryData.rows)
    setSummaryTotals(summaryData.totals)
    setCosts(costData.rows)
    setCostForm((current) => ({
      ...current,
      property_id: current.property_id || propertyList[0]?.id || '',
    }))
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : '売上データの取得に失敗しました'))
  }, [token])

  async function handleFileSelect(file: File): Promise<void> {
    const isPdf = file.name.endsWith('.pdf')
    const isCsv = file.name.endsWith('.csv') || file.name.endsWith('.tsv')
    if (!isPdf && !isCsv) {
      setError('PDFまたはCSVファイルを選択してください')
      return
    }
    setError(null)
    setMessage(null)
    setFileName(file.name)
    setStep('extracting')

    try {
      const text = isCsv ? await file.text() : await extractTextFromPdf(file)
      setExtractedText(text)
      setStep('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ファイルの読み込みに失敗しました')
      setStep('idle')
    }
  }

  async function handleImport(): Promise<void> {
    if (!token || !extractedText) return
    setError(null)
    setMessage(null)
    setStep('importing')
    try {
      const result = await apiFetch<{
        row_count: number
        matched_count: number
        created_count: number
        unmatched_count: number
      }>('/api/revenue/import', {
        method: 'POST',
        body: JSON.stringify({ csv_text: extractedText, platform }),
      }, token)
      setMessage(`インポート完了: ${result.row_count}行解析 / ${result.created_count}件新規作成 / ${result.matched_count}件更新 / ${result.unmatched_count}件スキップ`)
      setExtractedText(null)
      setFileName(null)
      setStep('done')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'インポートに失敗しました')
      setStep('idle')
    }
  }

  async function handleCreateCost(): Promise<void> {
    if (!token) return
    const amount = Number(costForm.amount)

    if (!costForm.property_id || !Number.isFinite(amount) || amount < 0 || !costForm.date) {
      setError('物件・カテゴリ・金額・日付を入力してください')
      return
    }

    try {
      setError(null)
      setMessage(null)
      await apiFetch('/api/costs', {
        method: 'POST',
        body: JSON.stringify({
          property_id: costForm.property_id,
          category: costForm.category,
          amount,
          date: costForm.date,
          description: costForm.description.trim() || null,
        }),
      }, token)
      setMessage('コストを登録しました')
      setCostForm((current) => ({
        ...current,
        category: 'cleaning',
        amount: '',
        date: new Date().toISOString().slice(0, 10),
        description: '',
      }))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'コスト登録に失敗しました')
    }
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) void handleFileSelect(file)
  }

  const totalGross = summary.reduce((sum, r) => sum + (r.gross_amount_total ?? 0), 0)
  const totalNet = summary.reduce((sum, r) => sum + (r.net_amount_total ?? 0), 0)
  const totalCost = summaryTotals?.total_cost ?? costs.reduce((sum, row) => sum + (row.amount ?? 0), 0)
  const totalLabor = summaryTotals?.total_labor ?? 0
  const profit = summaryTotals?.profit ?? (totalNet - totalCost - totalLabor)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">収益管理</h1>
        <p className="mt-1 text-sm text-gray-500">売上とコストを同じ画面で管理します</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{message}</div>}

      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('revenue')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${activeTab === 'revenue' ? 'text-white' : 'text-gray-600'}`}
          style={activeTab === 'revenue' ? { backgroundColor: '#06C755' } : undefined}
        >
          売上
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('costs')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${activeTab === 'costs' ? 'text-white' : 'text-gray-600'}`}
          style={activeTab === 'costs' ? { backgroundColor: '#06C755' } : undefined}
        >
          経費
        </button>
      </div>

      {activeTab === 'revenue' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">総売上（税込）</p>
                <p className="mt-1 text-3xl font-bold text-gray-900">¥{totalGross.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">OTA手数料差引後</p>
                <p className="mt-1 text-3xl font-bold text-gray-900">¥{totalNet.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">経費</p>
                <p className="mt-1 text-2xl font-bold text-red-600">¥{totalCost.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">人件費</p>
                <p className="mt-1 text-2xl font-bold text-red-600">¥{totalLabor.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">営業利益</p>
                <p className={`mt-1 text-3xl font-bold ${profit >= 0 ? 'text-gray-900' : 'text-red-600'}`}>¥{profit.toLocaleString()}</p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-gray-200 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">月別売上</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">月</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">物件</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">OTA</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">件数</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">売上</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">OTA差引後</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                          売上データがありません。右のパネルからPDFをインポートしてください。
                        </td>
                      </tr>
                    ) : summary.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.year_month}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{row.property_name}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.platform === 'airbnb' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                            {row.platform === 'airbnb' ? 'Airbnb' : row.platform === 'booking' ? 'Booking.com' : row.platform}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-500">{row.reservation_count}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-900">¥{(row.gross_amount_total ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">¥{(row.net_amount_total ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-900">売上インポート</h2>
              <p className="text-xs text-gray-400">Airbnb / Booking.com のCSVまたはPDFをアップロード</p>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">OTAを選択</label>
                <div className="flex gap-2">
                  {(['airbnb', 'booking'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatform(p)}
                      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                        platform === p
                          ? 'border-[#06C755] bg-green-50 text-green-700'
                          : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      {p === 'airbnb' ? 'Airbnb' : 'Booking.com'}
                    </button>
                  ))}
                </div>
              </div>

              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-[#06C755] hover:bg-green-50"
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.csv,.tsv"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) void handleFileSelect(e.target.files[0]) }}
                />
                {step === 'extracting' ? (
                  <p className="text-sm text-gray-500">テキストを抽出中...</p>
                ) : fileName ? (
                  <div className="text-center">
                    <p className="text-2xl">📄</p>
                    <p className="mt-1 text-sm font-medium text-gray-700">{fileName}</p>
                    <p className="text-xs text-gray-400">クリックで別のファイルを選択</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-2xl">📥</p>
                    <p className="mt-2 text-sm font-medium text-gray-700">PDF / CSVをドロップまたはクリック</p>
                    <p className="text-xs text-gray-400">明細書・取引履歴のPDFまたはCSVに対応</p>
                  </div>
                )}
              </div>

              {extractedText && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-600">抽出テキスト</p>
                  <pre className="max-h-40 overflow-y-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100 whitespace-pre-wrap">
                    {extractedText.slice(0, 800)}{extractedText.length > 800 ? '\n...' : ''}
                  </pre>
                </div>
              )}

              {AGENT_ENABLED ? (
                <button
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={!extractedText || step === 'importing'}
                  className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {step === 'importing' ? 'AI解析・インポート中...' : 'インポート実行'}
                </button>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  AI取り込み機能は現在無効です。手動でコスト・売上を追加してください。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-gray-500">総コスト</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">¥{totalCost.toLocaleString()}</p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-gray-200 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">コスト一覧</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">日付</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">物件</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">カテゴリ</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">金額</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">説明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {costs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">コストデータがありません</td>
                      </tr>
                    ) : costs.map((cost) => (
                      <tr key={cost.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{cost.date}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{cost.property_name}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${categoryBadgeClass[cost.category]}`}>
                            {categoryLabel(cost.category)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">¥{cost.amount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{cost.description || '未設定'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-900">＋コスト追加</h2>
              <p className="text-xs text-gray-400">物件ごとの運営コストを登録します</p>
            </div>
            <div className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">物件</label>
                <select className={inputClassName} value={costForm.property_id} onChange={(e) => setCostForm({ ...costForm, property_id: e.target.value })}>
                  <option value="">物件を選択</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>{property.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">カテゴリ</label>
                <select className={inputClassName} value={costForm.category} onChange={(e) => setCostForm({ ...costForm, category: e.target.value as CostCategory })}>
                  <option value="cleaning">清掃費</option>
                  <option value="supplies">備品・消耗品</option>
                  <option value="maintenance">修繕費</option>
                  <option value="utilities">水道光熱費</option>
                  <option value="other">その他</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">金額</label>
                <input className={inputClassName} type="number" min="0" value={costForm.amount} onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">日付</label>
                <input className={inputClassName} type="date" value={costForm.date} onChange={(e) => setCostForm({ ...costForm, date: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">説明</label>
                <textarea className={`${inputClassName} min-h-24`} value={costForm.description} onChange={(e) => setCostForm({ ...costForm, description: e.target.value })} />
              </div>
              <button
                type="button"
                onClick={() => void handleCreateCost()}
                className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: '#06C755' }}
              >
                コストを追加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function categoryLabel(category: CostCategory): string {
  if (category === 'cleaning') return '清掃'
  if (category === 'supplies') return '備品'
  if (category === 'maintenance') return '修繕'
  if (category === 'utilities') return '水道光熱'
  return 'その他'
}
