import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { AdminShell } from './components/admin-shell'
import { DashboardPage } from './pages/Dashboard'
import { CalendarPage } from './pages/Calendar'
import { ReservationsPage } from './pages/Reservations'
import { StaffPage } from './pages/Staff'
import { ShiftsPage } from './pages/Shifts'
import { PropertiesPage } from './pages/Properties'
import { RevenuePage } from './pages/Revenue'
import { MessagesPage } from './pages/Messages'
import { SettingsPage } from './pages/Settings'
import { LoginPage } from './pages/Login'
import { ShiftPickerPage } from './pages/ShiftPicker'
import { InvitePage } from './pages/Invite'
import { SetupPage } from './pages/Setup'

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/shift-picker" element={<ShiftPickerPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route element={<ProtectedRoutes />}>
          <Route element={<AdminShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/reservations" element={<ReservationsPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/shifts" element={<ShiftsPage />} />
            <Route path="/properties" element={<PropertiesPage />} />
            <Route path="/revenue" element={<RevenuePage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

function ProtectedRoutes(): JSX.Element {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">読み込み中...</main>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
