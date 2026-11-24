import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PriceBreakdown } from '../../src/components/bookings/PriceBreakdown.jsx'
import { StatusBadge } from '../../src/components/common/Badge.jsx'
import { Button } from '../../src/components/common/Button.jsx'
import { Input } from '../../src/components/common/Field.jsx'
import { RatingStars } from '../../src/components/common/RatingStars.jsx'
import { StylistCard } from '../../src/components/stylists/StylistCard.jsx'

describe('UI components', () => {
  it('Button: disabled while loading and announces busy state', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    const btn = screen.getByRole('button', { name: /save/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('Input: label and error are linked for screen readers', () => {
    render(<Input label="Email" error="Enter a valid email address." />)
    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter a valid email address.')
  })

  it('PriceBreakdown shows each line and the server total', () => {
    render(
      <PriceBreakdown
        currency="cad"
        total={23625}
        items={[
          { kind: 'service', description: 'Knotless braids', amount_cents: 18000 },
          { kind: 'option', description: 'Length: Mid-back', amount_cents: 3000 },
          { kind: 'discount', description: 'Promo WELCOME10', amount_cents: -1000 },
        ]}
        deposit={4725}
        balance={18900}
      />,
    )
    expect(screen.getByText('Knotless braids')).toBeInTheDocument()
    expect(screen.getByText('Promo WELCOME10')).toBeInTheDocument()
    expect(screen.getByText(/236\.25/)).toBeInTheDocument()
    expect(screen.getByText(/due when you book/)).toBeInTheDocument()
  })

  it('StatusBadge uses human labels', () => {
    render(<StatusBadge status="cancelled_by_stylist" />)
    expect(screen.getByText('Cancelled by stylist')).toBeInTheDocument()
  })

  it('RatingStars input reports the chosen value', () => {
    const onChange = vi.fn()
    render(<RatingStars value={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }))
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('StylistCard links to the profile and shows price and distance', () => {
    render(
      <MemoryRouter>
        <StylistCard
          s={{
            stylist_id: 'abc',
            display_name: 'Amara Demo',
            business_name: 'Amara Braids',
            headline: 'Knotless braids',
            city: 'Fredericton',
            distance_km: 3.2,
            from_price_cents: 6000,
            rating_avg: 4.8,
            rating_count: 12,
            offers_mobile: true,
            offers_studio: true,
            is_verified: true,
          }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/stylists/abc')
    expect(screen.getByText(/3\.2 km/)).toBeInTheDocument()
    expect(screen.getByText(/from \$60\.00/)).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })
})
