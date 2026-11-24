import { Button } from '../../components/common/Button.jsx'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'

export default function NotFoundPage() {
  useDocumentTitle('Page not found')
  return (
    <div className="container-page py-24 text-center">
      <p className="font-display text-7xl text-fuchsia">404</p>
      <h1 className="mt-4 text-3xl">We couldn’t find that page</h1>
      <p className="mt-2 text-stone">The link may be old, or the page may have moved.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Button to="/">Go home</Button>
        <Button to="/explore" variant="secondary">
          Find a stylist
        </Button>
      </div>
    </div>
  )
}
