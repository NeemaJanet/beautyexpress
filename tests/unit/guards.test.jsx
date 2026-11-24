// Route guards: what signed-out users, clients and stylists see.
// (Real protection is in the database — see tests/integration/rls.test.js.)
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authState = { current: {} }
vi.mock('../../src/contexts/AuthContext.jsx', () => ({
  useAuth: () => authState.current,
}))

const { RequireAuth, RequireRole } = await import('../../src/components/navigation/Guards.jsx')

function renderAt(path, element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in" element={<p>sign in page</p>} />
        <Route path="/onboarding" element={<p>onboarding page</p>} />
        <Route path="/protected" element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

const client = { user: { id: 'u1' }, profile: { onboarding_completed: true }, isAdmin: false, isStylist: false, loading: false }

describe('RequireAuth', () => {
  beforeEach(() => {
    authState.current = {}
  })

  it('sends signed-out visitors to sign in', () => {
    authState.current = { user: null, loading: false }
    renderAt('/protected', <RequireAuth><p>secret</p></RequireAuth>)
    expect(screen.getByText('sign in page')).toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('sends people who have not finished onboarding to onboarding', () => {
    authState.current = { ...client, profile: { onboarding_completed: false } }
    renderAt('/protected', <RequireAuth><p>secret</p></RequireAuth>)
    expect(screen.getByText('onboarding page')).toBeInTheDocument()
  })

  it('shows the page to an onboarded user', () => {
    authState.current = client
    renderAt('/protected', <RequireAuth><p>secret</p></RequireAuth>)
    expect(screen.getByText('secret')).toBeInTheDocument()
  })
})

describe('RequireRole', () => {
  it('blocks clients from the admin area', () => {
    authState.current = client
    renderAt('/protected', <RequireRole role="admin"><p>admin console</p></RequireRole>)
    expect(screen.queryByText('admin console')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /for administrators/i })).toBeInTheDocument()
  })

  it('blocks clients from the stylist area and offers to become a stylist', () => {
    authState.current = client
    renderAt('/protected', <RequireRole role="stylist"><p>stylist tools</p></RequireRole>)
    expect(screen.queryByText('stylist tools')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /become a stylist/i })).toBeInTheDocument()
  })

  it('lets admins in', () => {
    authState.current = { ...client, isAdmin: true }
    renderAt('/protected', <RequireRole role="admin"><p>admin console</p></RequireRole>)
    expect(screen.getByText('admin console')).toBeInTheDocument()
  })
})
