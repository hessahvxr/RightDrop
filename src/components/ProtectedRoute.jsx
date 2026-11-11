import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FullScreenLoader from './FullScreenLoader'

// Wraps a layout route so only signed-in users with the expected role can reach it.
// - If auth is still loading, show a loader.
// - If there is no session, redirect to that role's login page.
// - If the session exists but the role does not match, redirect the user to the
//   dashboard for their actual role (so a patient landing on /doctor goes to /patient).
export default function ProtectedRoute({ allowRole, redirectTo, children }) {
  const { loading, session, role } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenLoader />

  if (!session) {
    return <Navigate to={redirectTo} replace state={{ from: location }} />
  }

  if (role && role !== allowRole) {
    const home = role === 'doctor' ? '/doctor' : '/patient'
    return <Navigate to={home} replace />
  }

  // Signed in but the role is not known yet (it is still being loaded): wait.
  // The doctor area is never shown to a patient, or the reverse, even for a moment.
  if (!role) return <FullScreenLoader />

  return children
}
