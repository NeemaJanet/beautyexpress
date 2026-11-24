import { expect, test } from '@playwright/test'
import { mockSupabase, STYLIST } from './mockSupabase.js'

test.beforeEach(async ({ page }) => {
  await mockSupabase(page)
})

test('home page: the sentence search takes you to matching stylists', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('I’d like')
  await page.getByLabel('Hairstyle').fill('Cornrows')
  await page.getByLabel('City').fill('Fredericton')
  await page.getByLabel('Where').selectOption('mobile')
  await page.getByRole('button', { name: 'Show stylists' }).click()

  await expect(page).toHaveURL(/\/explore\?.*service=cornrows/)
  await expect(page).toHaveURL(/lat=45\.9636/)
  await expect(page).toHaveURL(/mode=mobile/)
  await expect(page.getByRole('link', { name: /Amara Demo/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('explore page sends filters to the search function', async ({ page }) => {
  const calls = await mockSupabase(page)
  await page.goto('/explore?category=braids&lat=45.9636&lng=-66.6431&place=Fredericton%2C%20NB')
  await expect(page.getByText('1 stylist')).toBeVisible()
  const last = calls.search.at(-1)
  expect(last.p_category_slug).toBe('braids')
  expect(last.p_lat).toBeCloseTo(45.9636)
  await expect(page.getByText(/1\.2 km/)).toBeVisible()
})

test('stylist profile shows services; booking while signed out asks you to sign in', async ({ page }) => {
  await page.goto(`/stylists/${STYLIST.id}`)
  await expect(page.getByRole('heading', { name: 'Amara Demo', level: 1 })).toBeVisible()
  await expect(page.getByText('Straight-back cornrows')).toBeVisible()
  await expect(page.getByText('SAMPLE REVIEW: lovely work')).toBeVisible()
  await page.getByRole('link', { name: 'Book', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fbook%2F/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('sign-in form validates before calling the server', async ({ page }) => {
  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Enter your email.')).toBeVisible()
  await expect(page.getByText('Enter your password.')).toBeVisible()
})

test('sign-up lets a stylist choose their role', async ({ page }) => {
  await page.goto('/sign-up?role=stylist')
  await expect(page.getByRole('heading', { name: 'Start taking bookings' })).toBeVisible()
  await expect(page.getByLabel('Offer my services')).toBeChecked()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Please accept the terms to continue.')).toBeVisible()
})

test('dashboards and admin pages require sign-in', async ({ page }) => {
  for (const path of ['/admin', '/stylist/dashboard', '/client/bookings', '/messages']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/sign-in\?next=/)
  }
})

test('category, legal and unknown pages render', async ({ page }) => {
  await page.goto('/categories/braids')
  await expect(page.getByRole('heading', { name: 'Braids', level: 1 })).toBeVisible()
  await page.goto('/cancellation-policy')
  await expect(page.getByText(/More than 24 hours before/)).toBeVisible()
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: 'Terms of service' })).toBeVisible()
  await page.goto('/this-does-not-exist')
  await expect(page.getByText('We couldn’t find that page')).toBeVisible()
})

test('mobile menu opens and navigates', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile only')
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.locator('#mobile-menu').getByRole('link', { name: 'Find a stylist' }).click()
  await expect(page).toHaveURL(/\/explore/)
})
