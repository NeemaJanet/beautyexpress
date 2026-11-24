import { Button } from '../../components/common/Button.jsx'
import { brand } from '../../config/brand.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'

export default function AboutPage() {
  useDocumentTitle('About')
  return (
    <div className="container-page py-14">
      <div className="max-w-3xl">
        <h1 className="text-4xl sm:text-5xl">Good hair appointments should be easy to find.</h1>
        <p className="mt-6 text-lg leading-relaxed text-ink-soft">
          {brand.name} connects people with independent and salon hairstylists. Clients see real prices, real availability
          and real reviews before they book. Stylists keep control of their prices, hours and travel area, and get paid
          through the platform.
        </p>
      </div>

      <div className="mt-14 grid gap-10 md:grid-cols-2">
        <section>
          <h2 className="text-2xl">For clients</h2>
          <ul className="mt-4 space-y-3 text-ink-soft">
            <li>Search by style, price, rating, distance and the day you are free.</li>
            <li>Choose a salon, the stylist’s studio, or a stylist who comes to you.</li>
            <li>See the full price, including booking fee and any travel fee, before you confirm.</li>
            <li>Message your stylist, get reminders and manage changes in one place.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-2xl">For stylists</h2>
          <ul className="mt-4 space-y-3 text-ink-soft">
            <li>List your services with options like length, size and add-ons.</li>
            <li>Set your weekly hours, breaks, days off and how much notice you need.</li>
            <li>Accept bookings instantly or review each request first.</li>
            <li>Receive payouts to your bank account through Stripe.</li>
          </ul>
          <Button to="/sign-up?role=stylist" className="mt-6">
            Create a stylist profile
          </Button>
        </section>
      </div>

      <section className="mt-14 max-w-3xl border-t border-sand pt-10">
        <h2 className="text-2xl">Safety and trust</h2>
        <p className="mt-4 text-ink-soft">
          Home addresses are never shown publicly. A mobile stylist sees your address only after they confirm your booking,
          and stylists’ studio addresses are shared only with confirmed clients. Card details are handled by Stripe and are
          never stored by {brand.name}. If something goes wrong, you can report it or open a dispute from the booking page.
        </p>
      </section>
    </div>
  )
}
