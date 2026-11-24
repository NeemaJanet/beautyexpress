import { Link } from 'react-router-dom'
import { brand } from '../../config/brand.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { LegalNotice } from './LegalNotice.jsx'

export default function TermsPage() {
  useDocumentTitle('Terms of service')
  return (
    <article className="container-page prose-legal py-14">
      <h1 className="mb-2 text-4xl">Terms of service</h1>
      <p className="text-sm text-stone">Last updated: replace with your publication date</p>
      <LegalNotice />

      <h2>1. Who we are</h2>
      <p>
        {brand.legalName} (“{brand.name}”, “we”) operates an online marketplace that lets clients find and book
        independent and salon-based hairstylists (“stylists”). {brand.name} is not a salon and does not provide hair
        services. Each stylist is an independent business responsible for the services they provide.
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>You must be at least the age of majority in your province to create an account.</li>
        <li>Keep your login details private. You are responsible for activity on your account.</li>
        <li>We may suspend accounts that break these terms, endanger others or misuse payments.</li>
      </ul>

      <h2>3. Bookings</h2>
      <p>
        Prices, durations and availability are set by stylists. The total shown at checkout, including any booking fee,
        travel fee and taxes, is the amount you agree to pay. Some bookings are confirmed instantly; others are requests
        the stylist may accept or decline.
      </p>

      <h2>4. Payments</h2>
      <p>
        Card payments are processed by Stripe. Stylists receive payouts through Stripe Connect after the appointment,
        less the platform commission. Where offered, manual Interac e-Transfer payments are confirmed only after our team
        verifies receipt.
      </p>

      <h2>5. Cancellations, no-shows and refunds</h2>
      <p>
        Our <Link to="/cancellation-policy" className="link">cancellation and refund policy</Link> forms part of these terms.
      </p>

      <h2>6. Conduct</h2>
      <ul>
        <li>Treat others respectfully. Harassment, discrimination or unsafe behaviour is not allowed.</li>
        <li>Do not arrange to pay outside the platform for bookings made on {brand.name}.</li>
        <li>Reviews must be honest and about a real appointment.</li>
      </ul>

      <h2>7. Stylist obligations</h2>
      <p>
        Stylists confirm they hold any licences, permits and insurance required where they work, follow health and safety
        rules, describe their services and prices accurately, and handle their own tax obligations.
      </p>

      <h2>8. Disputes</h2>
      <p>
        If something goes wrong, open a dispute from the booking page within 30 days. We review the information from
        both sides and may issue a full or partial refund.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the extent permitted by law, {brand.name} is not liable for the services stylists provide. Nothing in these
        terms limits rights you have under consumer protection law.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions: <a className="link" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
      </p>
    </article>
  )
}
