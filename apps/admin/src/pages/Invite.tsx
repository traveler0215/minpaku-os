import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import type { AdminUser } from '../lib/types'

const TOKEN_KEY = 'minpaku_os_admin_token'

export function InvitePage(): JSX.Element {
  const { token } = useParams<{ token: string }>()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('招待トークンがありません')
      return
    }

    async function activate(): Promise<void> {
      try {
        const data = await apiFetch<{ token: string; user: AdminUser }>(`/api/auth/invite/${token}`)
        localStorage.setItem(TOKEN_KEY, data.token)
        window.location.href = '/'
      } catch (e) {
        setError(e instanceof Error ? e.message : 'この招待リンクは無効または期限切れです')
      }
    }

    void activate()
  }, [token])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          {error ? (
            <>
              <p className="text-3xl">🔗</p>
              <h1 className="mt-3 text-lg font-bold text-gray-900">招待リンクエラー</h1>
              <p className="mt-2 text-sm text-red-600">{error}</p>
              <a
                href="/login"
                className="mt-4 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                style={{ backgroundColor: '#06C755' }}
              >
                ログインページへ
              </a>
            </>
          ) : (
            <>
              <p className="text-3xl">⏳</p>
              <h1 className="mt-3 text-lg font-bold text-gray-900">認証中...</h1>
              <p className="mt-2 text-sm text-gray-500">招待リンクを確認しています</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
