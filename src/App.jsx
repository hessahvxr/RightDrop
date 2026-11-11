import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import FullScreenLoader from './components/FullScreenLoader'
import ProtectedRoute from './components/ProtectedRoute'
import WelcomePage from './pages/WelcomePage'
import DoctorLogin from './pages/auth/DoctorLogin'
import DoctorRegister from './pages/auth/DoctorRegister'
import PatientLogin from './pages/auth/PatientLogin'
import PatientRegister from './pages/auth/PatientRegister'
import DoctorLayout from './layouts/DoctorLayout'
import DoctorDashboard from './pages/doctor/DoctorDashboard'
import DoctorPatients from './pages/doctor/DoctorPatients'
import DoctorPrescriptions from './pages/doctor/DoctorPrescriptions'
import DoctorProfile from './pages/doctor/DoctorProfile'
import PatientLayout from './layouts/PatientLayout'
import PatientToday from './pages/patient/PatientToday'
import PatientSchedule from './pages/patient/PatientSchedule'
import PatientPrescriptions from './pages/patient/PatientPrescriptions'
import PatientScan from './pages/patient/PatientScan'
import PatientProfile from './pages/patient/PatientProfile'
import PatientAssistant from './pages/patient/PatientAssistant'

function AppRoutes() {
  const { loading, session, role } = useAuth()

  // Redirect authenticated users away from the welcome page to their dashboard.
  function WelcomeOrHome() {
    if (loading) return <FullScreenLoader />
    if (session && role) {
      return <Navigate to={role === 'doctor' ? '/doctor' : '/patient'} replace />
    }
    return <WelcomePage />
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<WelcomeOrHome />} />

      {/* Auth */}
      <Route path="/auth/doctor/login" element={<DoctorLogin />} />
      <Route path="/auth/doctor/register" element={<DoctorRegister />} />
      <Route path="/auth/patient/login" element={<PatientLogin />} />
      <Route path="/auth/patient/register" element={<PatientRegister />} />

      {/* Doctor (protected) */}
      <Route
        path="/doctor"
        element={
          <ProtectedRoute allowRole="doctor" redirectTo="/auth/doctor/login">
            <DoctorLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DoctorDashboard />} />
        <Route path="patients" element={<DoctorPatients />} />
        <Route path="prescriptions" element={<DoctorPrescriptions />} />
        <Route path="profile" element={<DoctorProfile />} />
      </Route>

      {/* Patient (protected) */}
      <Route
        path="/patient"
        element={
          <ProtectedRoute allowRole="patient" redirectTo="/auth/patient/login">
            <PatientLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<PatientToday />} />
        <Route path="schedule" element={<PatientSchedule />} />
        <Route path="scan" element={<PatientScan />} />
        <Route path="assistant" element={<PatientAssistant />} />
        <Route path="prescriptions" element={<PatientPrescriptions />} />
        <Route path="profile" element={<PatientProfile />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
