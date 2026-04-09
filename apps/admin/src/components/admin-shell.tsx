import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

interface NavItem {
  to: string
  label: string
  icon: string
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: '',
    items: [
      { to: '/dashboard', label: 'ダッシュボード', icon: '🏠' },
      { to: '/calendar', label: 'カレンダー', icon: '📅' },
    ],
  },
  {
    label: '予約・収益',
    items: [
      { to: '/reservations', label: '予約管理', icon: '📋' },
      { to: '/revenue', label: '収益管理', icon: '💴' },
    ],
  },
  {
    label: 'スタッフ',
    items: [
      { to: '/shifts', label: 'シフト管理', icon: '🗓️' },
      { to: '/staff', label: 'スタッフ', icon: '👥' },
    ],
  },
  {
    label: 'コミュニケーション',
    items: [
      { to: '/messages', label: 'メッセージ', icon: '💬' },
    ],
  },
  {
    label: '設定',
    items: [
      { to: '/properties', label: '物件管理', icon: '🏢' },
      { to: '/settings', label: '設定', icon: '⚙️' },
    ],
  },
]

export function AdminShell(): JSX.Element {
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-white border-r border-gray-200 transition-transform duration-300 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-200">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-sm font-bold" style={{ backgroundColor: '#06C755' }}>
            M
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Minpaku-OS</p>
            <p className="text-xs text-gray-400">管理画面</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              {section.label && (
                <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-[#06C755] text-white'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        }`
                      }
                    >
                      <span className="text-base leading-none">{item.icon}</span>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4">
          <p className="text-xs text-gray-500 font-medium truncate">{user?.email}</p>
          <button
            type="button"
            onClick={logout}
            className="mt-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            ログアウト
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="text-gray-500 hover:text-gray-900"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-bold text-gray-900">Minpaku-OS</span>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
