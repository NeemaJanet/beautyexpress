/**
 * All pages and their web addresses (routes).
 * Pages are loaded on demand (React.lazy) so the first page loads quickly.
 */
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { LoadingState } from './components/common/States.jsx'
import { RequireAuth, RequireRole } from './components/navigation/Guards.jsx'
import { AuthLayout } from './layouts/AuthLayout.jsx'
import { DashboardLayout } from './layouts/DashboardLayout.jsx'
import { PublicLayout } from './layouts/PublicLayout.jsx'
import HomePage from './pages/public/HomePage.jsx'

const page = (loader) => lazy(loader)

// Public
const ExplorePage = page(() => import('./pages/public/ExplorePage.jsx'))
const CategoriesPage = page(() => import('./pages/public/CategoriesPage.jsx'))
const CategoryPage = page(() => import('./pages/public/CategoryPage.jsx'))
const StylistProfilePage = page(() => import('./pages/public/StylistProfilePage.jsx'))
const ServiceDetailPage = page(() => import('./pages/public/ServiceDetailPage.jsx'))
const AboutPage = page(() => import('./pages/public/AboutPage.jsx'))
const ContactPage = page(() => import('./pages/public/ContactPage.jsx'))
const TermsPage = page(() => import('./pages/public/TermsPage.jsx'))
const PrivacyPage = page(() => import('./pages/public/PrivacyPage.jsx'))
const CancellationPolicyPage = page(() => import('./pages/public/CancellationPolicyPage.jsx'))
const NotFoundPage = page(() => import('./pages/public/NotFoundPage.jsx'))

// Auth
const SignInPage = page(() => import('./pages/auth/SignInPage.jsx'))
const SignUpPage = page(() => import('./pages/auth/SignUpPage.jsx'))
const ForgotPasswordPage = page(() => import('./pages/auth/ForgotPasswordPage.jsx'))
const ResetPasswordPage = page(() => import('./pages/auth/ResetPasswordPage.jsx'))
const OnboardingPage = page(() => import('./pages/auth/OnboardingPage.jsx'))

// Client
const ClientDashboardPage = page(() => import('./pages/client/ClientDashboardPage.jsx'))
const ProfilePage = page(() => import('./pages/client/ProfilePage.jsx'))
const AddressesPage = page(() => import('./pages/client/AddressesPage.jsx'))
const FavoritesPage = page(() => import('./pages/client/FavoritesPage.jsx'))
const ClientBookingsPage = page(() => import('./pages/client/ClientBookingsPage.jsx'))
const ReviewsPage = page(() => import('./pages/client/ReviewsPage.jsx'))
const PaymentsPage = page(() => import('./pages/client/PaymentsPage.jsx'))
const SupportPage = page(() => import('./pages/client/SupportPage.jsx'))
const CheckoutPage = page(() => import('./pages/client/CheckoutPage.jsx'))

// Shared (client, stylist and admin)
const BookingDetailPage = page(() => import('./pages/shared/BookingDetailPage.jsx'))
const BookingConfirmationPage = page(() => import('./pages/shared/BookingConfirmationPage.jsx'))
const ReceiptPage = page(() => import('./pages/shared/ReceiptPage.jsx'))
const MessagesPage = page(() => import('./pages/shared/MessagesPage.jsx'))
const NotificationsPage = page(() => import('./pages/shared/NotificationsPage.jsx'))

// Stylist
const StylistDashboardPage = page(() => import('./pages/stylist/StylistDashboardPage.jsx'))
const StylistProfileEditorPage = page(() => import('./pages/stylist/StylistProfileEditorPage.jsx'))
const PortfolioPage = page(() => import('./pages/stylist/PortfolioPage.jsx'))
const ServicesManagerPage = page(() => import('./pages/stylist/ServicesManagerPage.jsx'))
const AvailabilityPage = page(() => import('./pages/stylist/AvailabilityPage.jsx'))
const StylistBookingsPage = page(() => import('./pages/stylist/StylistBookingsPage.jsx'))
const EarningsPage = page(() => import('./pages/stylist/EarningsPage.jsx'))
const StylistSettingsPage = page(() => import('./pages/stylist/StylistSettingsPage.jsx'))

// Admin
const AdminDashboardPage = page(() => import('./pages/admin/AdminDashboardPage.jsx'))
const AdminUsersPage = page(() => import('./pages/admin/AdminUsersPage.jsx'))
const AdminStylistsPage = page(() => import('./pages/admin/AdminStylistsPage.jsx'))
const AdminBookingsPage = page(() => import('./pages/admin/AdminBookingsPage.jsx'))
const AdminTransactionsPage = page(() => import('./pages/admin/AdminTransactionsPage.jsx'))
const AdminReportsPage = page(() => import('./pages/admin/AdminReportsPage.jsx'))
const AdminCategoriesPage = page(() => import('./pages/admin/AdminCategoriesPage.jsx'))
const AdminSettingsPage = page(() => import('./pages/admin/AdminSettingsPage.jsx'))
const AdminAuditPage = page(() => import('./pages/admin/AdminAuditPage.jsx'))

function SearchRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/explore${search}`} replace />
}

export default function App() {
  return (
    <Suspense fallback={<LoadingState className="min-h-screen" />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          <Route path="explore" element={<ExplorePage />} />
          <Route path="search" element={<SearchRedirect />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="categories/:slug" element={<CategoryPage />} />
          <Route path="stylists/:id" element={<StylistProfilePage />} />
          <Route path="stylists/:id/services/:serviceId" element={<ServiceDetailPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="cancellation-policy" element={<CancellationPolicyPage />} />
          <Route
            path="book/:serviceId"
            element={
              <RequireAuth>
                <CheckoutPage />
              </RequireAuth>
            }
          />
        </Route>

        <Route element={<AuthLayout />}>
          <Route path="sign-in" element={<SignInPage />} />
          <Route path="sign-up" element={<SignUpPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route
            path="onboarding"
            element={
              <RequireAuth allowIncompleteOnboarding>
                <OnboardingPage />
              </RequireAuth>
            }
          />
        </Route>

        {/* Shared signed-in pages */}
        <Route element={<RequireAuth />}>
          <Route element={<DashboardLayout />}>
            <Route path="bookings/:id" element={<BookingDetailPage />} />
            <Route path="bookings/:id/confirmed" element={<BookingConfirmationPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="messages/:conversationId" element={<MessagesPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
          </Route>
          <Route path="bookings/:id/receipt" element={<ReceiptPage />} />

          <Route path="client" element={<DashboardLayout area="client" />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<ClientDashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="addresses" element={<AddressesPage />} />
            <Route path="favorites" element={<FavoritesPage />} />
            <Route path="bookings" element={<ClientBookingsPage />} />
            <Route path="reviews" element={<ReviewsPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="support" element={<SupportPage />} />
          </Route>

          <Route path="stylist" element={<RequireRole role="stylist" />}>
            <Route element={<DashboardLayout area="stylist" />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<StylistDashboardPage />} />
              <Route path="profile" element={<StylistProfileEditorPage />} />
              <Route path="portfolio" element={<PortfolioPage />} />
              <Route path="services" element={<ServicesManagerPage />} />
              <Route path="availability" element={<AvailabilityPage />} />
              <Route path="bookings" element={<StylistBookingsPage />} />
              <Route path="earnings" element={<EarningsPage />} />
              <Route path="settings" element={<StylistSettingsPage />} />
            </Route>
          </Route>

          <Route path="admin" element={<RequireRole role="admin" />}>
            <Route element={<DashboardLayout area="admin" />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="stylists" element={<AdminStylistsPage />} />
              <Route path="bookings" element={<AdminBookingsPage />} />
              <Route path="transactions" element={<AdminTransactionsPage />} />
              <Route path="reports" element={<AdminReportsPage />} />
              <Route path="categories" element={<AdminCategoriesPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route path="audit" element={<AdminAuditPage />} />
            </Route>
          </Route>
        </Route>

        <Route element={<PublicLayout />}>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
