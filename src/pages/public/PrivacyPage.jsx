import { brand } from '../../config/brand.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { LegalNotice } from './LegalNotice.jsx'

export default function PrivacyPage() {
  useDocumentTitle('Privacy policy')
  return (
    <article className="container-page prose-legal py-14">
      <h1 className="mb-2 text-4xl">Privacy policy</h1>
      <p className="text-sm text-stone">Last updated: replace with your publication date</p>
      <LegalNotice />
      <p>
        This policy explains what personal information {brand.name} collects and how it is used. In Canada, it should be
        reviewed against PIPEDA and any applicable provincial privacy law.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, email address, phone number (optional) and profile photo.</li>
        <li>Booking details: services, dates, notes you add and, for mobile appointments, the service address.</li>
        <li>Approximate location you choose for search. Stylists’ public location is rounded to about 1 km.</li>
        <li>Messages you send through the app, reviews and support requests.</li>
        <li>Payment records. Card numbers are collected and stored by Stripe, not by us.</li>
      </ul>

      <h2>How it is shared</h2>
      <ul>
        <li>Your stylist sees your name, booking details and, once the booking is confirmed, the service address.</li>
        <li>Clients see a stylist’s studio address only after their booking is confirmed.</li>
        <li>Service providers who run the platform for us: Supabase (database and hosting), Stripe (payments), our email and SMS providers.</li>
        <li>We do not sell personal information.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>Update your profile and notification preferences at any time.</li>
        <li>Ask for a copy of your information or for your account to be deleted by contacting us.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit. Access is restricted by database security rules so people only see information
        they are entitled to. No system is perfectly secure; tell us right away if you suspect misuse of your account.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions: <a className="link" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
      </p>
    </article>
  )
}
