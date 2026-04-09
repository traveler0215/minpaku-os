import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function LoginPage(): JSX.Element {
  const { requestCode, verifyCode } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [devCode, setDevCode] = useState<string | null>(null)

  async function handleRequestCode(): Promise<void> {
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    try {
      const result = await requestCode(email.trim())
      setDevCode(result.code)
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コードの送信に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(): Promise<void> {
    if (!code.trim()) return
    setLoading(true)
    setError(null)
    try {
      await verifyCode(email.trim(), code.trim())
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '認証に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl text-white text-xl font-bold"
            style={{ backgroundColor: '#06C755' }}
          >
            M
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Minpaku-OS</h1>
          <p className="mt-1 text-sm text-gray-500">管理画面にログイン</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {step === 'email' ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleRequestCode()}
                  placeholder="admin@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="button"
                onClick={() => void handleRequestCode()}
                disabled={loading || !email.trim()}
                className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {loading ? '送信中...' : 'コードを送信'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                <span className="font-medium">{email}</span> に送信されたコードを入力してください。
              </p>
              {devCode && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
                  <p className="text-xs text-amber-600">MVP: 認証コード</p>
                  <p className="mt-1 text-2xl font-bold tracking-widest text-amber-800">{devCode}</p>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  認証コード
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleVerify()}
                  placeholder="123456"
                  maxLength={6}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-2xl font-bold tracking-widest outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/20"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={loading || code.length !== 6}
                className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {loading ? '確認中...' : 'ログイン'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('email'); setCode(''); setError(null) }}
                className="w-full text-center text-sm text-gray-400 hover:text-gray-600"
              >
                メールアドレスを変更
              </button>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          MVP: コードはAPIレスポンスにも含まれます
        </p>
      </div>
    </div>
  )
}
