import { Link } from 'react-router-dom'
import { Avatar } from '../../components/common/Avatar.jsx'
import { Button } from '../../components/common/Button.jsx'
import { PageHeader } from '../../components/common/PageHeader.jsx'
import { RatingStars } from '../../components/common/RatingStars.jsx'
import { AsyncBoundary, EmptyState } from '../../components/common/States.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { listFavorites, setFavorite } from '../../services/stylistService.js'

export default function FavoritesPage() {
  useDocumentTitle('Favourites')
  const { user } = useAuth()
  const list = useAsync(() => listFavorites(user.id), [user.id])

  const remove = async (id) => {
    await setFavorite(user.id, id, false)
    list.setData((rows) => rows.filter((r) => r.stylist_id !== id))
  }

  return (
    <div>
      <PageHeader title="Favourites" description="Stylists you saved." />
      <AsyncBoundary loading={list.loading} error={list.error} onRetry={list.reload}
        isEmpty={!list.data?.filter((f) => f.stylist_profiles).length}
        empty={<EmptyState title="No favourites yet" action={<Button to="/explore">Find stylists</Button>}>Tap Save on a stylist’s profile to keep them here.</EmptyState>}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.data?.filter((f) => f.stylist_profiles).map(({ stylist_id, stylist_profiles: s }) => (
            <li key={stylist_id} className="panel flex items-center gap-4 p-4">
              <Avatar src={s.avatar_url} name={s.display_name} size="md" />
              <div className="min-w-0 flex-1">
                <Link to={`/stylists/${stylist_id}`} className="font-medium hover:text-brown">{s.display_name}</Link>
                <p className="truncate text-sm text-stone">{s.headline || s.city}</p>
                <RatingStars value={s.rating_avg} count={s.rating_count} />
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(stylist_id)} aria-label={`Remove ${s.display_name} from favourites`}>Remove</Button>
            </li>
          ))}
        </ul>
      </AsyncBoundary>
    </div>
  )
}
