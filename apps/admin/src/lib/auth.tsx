import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiFetch } from './api'
import type { AdminUser } from './types'

const TOKEN_KEY = 'minpaku_os_admin_token'

interface AuthContextValue {
  token: string | null
  user: AdminUser | null
  isLoading: boolean
  requestCode: (email: string) => Promise<{ email: string; code: string; expires_in_sec: number }>
  verifyCode: (email: string, code: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [token, setToken] = useState<string | null>(() => window.localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<AdminUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function bootstrap(): Promise<void> {
      if (!token) {
        setIsLoading(false)
        return
      }

      try {
        const me = await apiFetch<AdminUser>('/api/auth/me', undefined, token)
        setUser(me)
      } catch {
        window.localStorage.removeItem(TOKEN_KEY)
        setToken(null)
        setUser(null)
      } finally {
        setIsLoading(false)
      }
    }

    void bootstrap()
  }, [token])

  async function requestCode(email: string): Promise<{ email: string; code: string; expires_in_sec: number }> {
    return apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  }

  async function verifyCode(email: string, code: string): Promise<void> {
    const result = await apiFetch<{ token: string; user: AdminUser }>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    })
    window.localStorage.setItem(TOKEN_KEY, result.token)
    setToken(result.token)
    setUser(result.user)
  }

  async function refresh(): Promise<void> {
    if (!token) return
    const me = await apiFetch<AdminUser>('/api/auth/me', undefined, token)
    setUser(me)
  }

  function logout(): void {
    window.localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, isLoading, requestCode, verifyCode, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return value
}
