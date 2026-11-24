import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/common/Button.jsx'
import { StylistCard } from '../../components/stylists/StylistCard.jsx'
import { brand } from '../../config/brand.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js'
import { CITIES, findCity } from '../../lib/cities.js'
import { getCatalogServices, getCategories } from '../../services/catalogService.js'
import { searchStylists } from '../../services/stylistService.js'

const MODES = [
  { value: 'any', label: 'wherever suits' },
  { value: 'mobile', label: 'at my place' },
  { value: 'studio', label: "at the stylist's studio" },
  { value: 'salon', label: 'in a salon' },
]

export default function HomePage() {
  useDocumentTitle(null)
  const navigate = useNavigate()
  const services = useAsync(getCatalogServices, [])
  const categories = useAsync(getCategories, [])
  const featured = useAsync(async () => {
    const f = await searchStylists({ featured: true, limit: 6 })
    if (f.rows.length >= 3) return f.rows
    return (await searchStylists({ sort: 'rating', limit: 6 })).rows
  }, [])

  const [style, setStyle] = useState('')
  const [city, setCity] = useState('')
  const [mode, setMode] = useState('any')

  const submit = (e) => {
    e.preventDefault()
    const params = new URLSearchParams()
    const svc = services.data?.find((s) => s.name.toLowerCase() === style.trim().toLowerCase())
    if (svc) params.set('service', svc.slug)
    else if (style.trim()) params.set('q', style.trim())
    const c = findCity(city)
    if (c) {
      params.set('lat', c.lat)
      params.set('lng', c.lng)
      params.set('place', `${c.name}, ${c.province}`)
    } else if (city.trim()) {
      params.set('place', city.trim())
    }
    if (mode !== 'any') params.set('mode', mode)
    navigate(`/explore?${params}`)
  }

  const fieldClass =
    'mx-1 inline-block min-w-0 max-w-full border-b-2 border-fuchsia bg-transparent px-1 font-display italic text-fuchsia-deep placeholder:text-fuchsia-deep/45 focus:border-ink focus:outline-none'

  return (
    <>
      {/* Hero: the search form is written as a sentence. */}
      <section className="border-b border-sand">
        <div className="container-page grid gap-12 py-14 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:py-24">
          <form onSubmit={submit} aria-label="Find a stylist">
            <p className="mb-6 text-stone">Braids, locs, silk presses and more. Booked in minutes.</p>
            <h1 className="text-[2.1rem] leading-[1.35] sm:text-5xl sm:leading-[1.3] lg:text-[3.4rem]">
              <span>I&rsquo;d like </span>
              <label className="sr-only" htmlFor="hero-style">
                Hairstyle
              </label>
              <input
                id="hero-style"
                list="hero-style-list"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder="knotless braids"
                style={{ width: `${Math.max(style.length, 15) + 2}ch` }}
                className={fieldClass}
              />
              <datalist id="hero-style-list">
                {services.data?.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              <span> near </span>
              <label className="sr-only" htmlFor="hero-city">
                City
              </label>
              <input
                id="hero-city"
                list="hero-city-list"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Fredericton"
                style={{ width: `${Math.max(city.length, 11) + 3}ch` }}
                className={fieldClass}
              />
              <datalist id="hero-city-list">
                {CITIES.map((c) => (
                  <option key={c.name} value={c.name} />
                ))}
              </datalist>
              <span>, </span>
              <label className="sr-only" htmlFor="hero-mode">
                Where
              </label>
              <select id="hero-mode" value={mode} onChange={(e) => setMode(e.target.value)} className={`${fieldClass} cursor-pointer appearance-none`}>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span>.</span>
            </h1>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button type="submit" size="lg">
                Show stylists
              </Button>
              <Link to="/explore" className="link">
                Browse everyone instead
              </Link>
            </div>
          </form>

          <div className="relative hidden lg:block" aria-hidden="true">
            <img src="/images/hero.svg" alt="" className="w-full rounded-[var(--radius-media)] border border-sand" />
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="container-page py-16">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="text-3xl">Browse by style</h2>
          <Link to="/categories" className="link text-sm">
            All styles
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {categories.data?.map((c) => (
            <Link key={c.id} to={`/categories/${c.slug}`} className="group">
              <div className="aspect-square overflow-hidden rounded-[var(--radius-media)] border border-sand bg-sand-soft">
                {c.image_url && <img src={c.image_url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />}
              </div>
              <p className="mt-2 font-medium group-hover:text-brown">{c.name}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured stylists */}
      {featured.data?.length > 0 && (
        <section className="container-page pb-16">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h2 className="text-3xl">Stylists clients keep rebooking</h2>
            <Link to="/explore?sort=rating" className="link text-sm">
              See more
            </Link>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.data.slice(0, 6).map((s) => (
              <StylistCard key={s.stylist_id} s={s} />
            ))}
          </div>
        </section>
      )}

      {/* How it works — a real sequence, so numbered */}
      <section className="border-y border-sand bg-paper">
        <div className="container-page grid gap-10 py-16 lg:grid-cols-[1fr_2fr]">
          <h2 className="text-3xl">How booking works</h2>
          <ol className="grid gap-8 sm:grid-cols-3">
            {[
              ['Pick a stylist', 'Compare portfolios, prices and reviews. Filter by style, distance and whether they come to you.'],
              ['Choose a time', 'See real free times. Your price, including any travel fee, is shown before you confirm.'],
              ['Get your hair done', 'Message your stylist, get reminders, and leave a review afterwards.'],
            ].map(([title, text], i) => (
              <li key={title}>
                <span className="font-display text-4xl text-fuchsia">{i + 1}</span>
                <h3 className="mt-2 font-sans text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-stone">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Stylist call to action */}
      <section className="container-page py-16">
        <div className="grid gap-8 rounded-[var(--radius-media)] bg-green-deep px-6 py-12 text-cream sm:px-12 lg:grid-cols-[2fr_1fr] lg:items-center">
          <div>
            <h2 className="text-3xl text-cream sm:text-4xl">Do hair? Fill your calendar on your terms.</h2>
            <p className="mt-3 max-w-xl text-cream/75">
              Set your own prices, hours and travel area. {brand.name} handles booking requests, reminders and payments, so
              you can focus on the chair.
            </p>
          </div>
          <div className="lg:text-right">
            <Button to="/sign-up?role=stylist" variant="accent" size="lg">
              Create a stylist profile
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
