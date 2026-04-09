import type { ApiResponse } from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function apiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? ''
}

export async function apiFetch<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
  })

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null
  if (!response.ok || !payload?.success) {
    throw new ApiError(payload && !payload.success ? payload.error : 'API request failed', response.status)
  }

  return payload.data
}
