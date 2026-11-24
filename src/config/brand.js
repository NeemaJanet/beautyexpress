/**
 * Branding in one place. To rename the app or change the logo text, edit this
 * file. Colours and fonts live in src/styles/index.css (the @theme block) and
 * the favicon in public/favicon.svg.
 */
export const brand = {
  name: import.meta.env.VITE_APP_NAME || 'BeautyExpress',
  tagline: 'Hairstylists you can book like a ride.',
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL || 'support@beautyexpress.com',
  // Legal business details shown in the footer and legal pages. Replace before launch.
  legalName: import.meta.env.VITE_LEGAL_NAME || 'BeautyExpress Co',
  country: 'Canada',
}
