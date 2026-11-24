import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

export function SuspendedBanner() {
  const { isSuspended, profile } = useAuth()
  if (!isSuspended) return null
  return (
    <div role="alert" className="bg-danger px-4 py-3 text-center text-sm text-white">
      Your account is suspended{profile?.status_reason ? `: ${profile.status_reason}` : ''}. You can view your
      information but cannot make new bookings or send messages.{' '}
      <Link to="/contact" className="underline">
        Contact support
      </Link>
    </div>
  )
}
