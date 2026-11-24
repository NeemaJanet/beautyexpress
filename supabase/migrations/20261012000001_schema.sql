-- ============================================================================
-- BeautyExpress — Migration 1: extensions, types and tables
--
-- Money is always stored as INTEGER CENTS (e.g. $45.50 = 4550) to avoid
-- floating-point rounding errors. Times are stored as timestamptz (UTC).
-- ============================================================================

create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('client', 'stylist', 'admin');
create type public.account_status as enum ('active', 'suspended');
create type public.stylist_type as enum ('freelance', 'salon');
create type public.verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type public.approval_status as enum ('pending', 'approved', 'rejected');
create type public.booking_mode as enum ('instant', 'approval');
create type public.location_type as enum ('client_location', 'stylist_studio', 'salon');
create type public.deposit_type as enum ('none', 'percent', 'fixed');
create type public.option_group_type as enum ('choose_one', 'add_on');

create type public.booking_status as enum (
  'pending_payment',      -- slot held while the client pays online
  'requested',            -- waiting for the stylist to accept
  'confirmed',            -- appointment is booked
  'in_progress',          -- stylist has started the service
  'completed',            -- service finished
  'declined',             -- stylist declined the request
  'cancelled_by_client',
  'cancelled_by_stylist',
  'cancelled_by_admin',
  'expired',              -- online payment was not completed in time
  'no_show'               -- client did not attend
);

create type public.payment_provider as enum ('stripe', 'manual_etransfer', 'pay_in_person');
create type public.payment_kind as enum ('full', 'deposit', 'balance');
create type public.payment_status as enum (
  'requires_payment', 'processing', 'succeeded', 'failed', 'canceled',
  'partially_refunded', 'refunded', 'awaiting_verification'
);
create type public.refund_status as enum ('pending', 'processing', 'succeeded', 'failed', 'canceled');
create type public.payout_status as enum ('pending', 'transferred', 'failed', 'reversed');
create type public.report_status as enum ('open', 'investigating', 'resolved', 'dismissed');
create type public.report_category as enum ('support', 'payment', 'quality', 'safety', 'harassment', 'account', 'other');
create type public.dispute_status as enum ('open', 'under_review', 'resolved_refund', 'resolved_no_refund', 'closed');

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 1000),
  email text,
  phone text check (phone is null or phone ~ '^\+?[0-9 ()\-]{7,20}$'),
  sms_opt_in boolean not null default false,
  email_opt_in boolean not null default true,
  timezone text not null default 'America/Halifax',
  preferred_city text check (preferred_city is null or char_length(preferred_city) <= 120),
  preferred_lat double precision check (preferred_lat between -90 and 90),
  preferred_lng double precision check (preferred_lng between -180 and 180),
  status public.account_status not null default 'active',
  status_reason text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Roles live in their own table. Users can never write to it directly.
create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Home' check (char_length(label) between 1 and 60),
  line1 text not null check (char_length(line1) between 3 and 200),
  line2 text check (line2 is null or char_length(line2) <= 200),
  city text not null check (char_length(city) between 2 and 120),
  province text not null default '' check (char_length(province) <= 60),
  postal_code text not null default '' check (char_length(postal_code) <= 20),
  country text not null default 'CA' check (char_length(country) = 2),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  access_notes text check (access_notes is null or char_length(access_notes) <= 500),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses(user_id);

-- ---------------------------------------------------------------------------
-- Platform configuration (commission, fees, policies...)
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  is_public boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalogue: categories and hairstyles
-- ---------------------------------------------------------------------------
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '',
  image_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A hairstyle in the shared catalogue (e.g. "Knotless braids").
create table public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  name text not null check (char_length(name) between 2 and 100),
  description text not null default '',
  image_url text,
  typical_duration_minutes int not null default 120 check (typical_duration_minutes between 15 and 720),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index services_category_idx on public.services(category_id);

-- ---------------------------------------------------------------------------
-- Salons and stylists
-- ---------------------------------------------------------------------------
create table public.salons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  address_line text not null check (char_length(address_line) between 3 and 200),
  city text not null check (char_length(city) between 2 and 120),
  province text not null default '',
  postal_code text not null default '',
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  phone text,
  website text check (website is null or website ~ '^https?://'),
  created_by uuid references public.profiles(id) on delete set null,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Public, searchable part of a stylist's profile.
create table public.stylist_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 1000),
  business_name text not null default '' check (char_length(business_name) <= 120),
  headline text not null default '' check (char_length(headline) <= 160),
  bio text not null default '' check (char_length(bio) <= 3000),
  stylist_type public.stylist_type not null default 'freelance',
  salon_id uuid references public.salons(id) on delete set null,
  years_experience int not null default 0 check (years_experience between 0 and 80),
  city text not null default '',
  province text not null default '',
  -- Approximate public location, rounded to ~1 km so a home address is never exposed.
  approx_lat double precision check (approx_lat between -90 and 90),
  approx_lng double precision check (approx_lng between -180 and 180),
  offers_mobile boolean not null default false,
  offers_studio boolean not null default false,
  offers_salon boolean not null default false,
  max_travel_km int not null default 15 check (max_travel_km between 0 and 300),
  travel_fee_base_cents int not null default 0 check (travel_fee_base_cents between 0 and 100000),
  travel_fee_per_km_cents int not null default 0 check (travel_fee_per_km_cents between 0 and 10000),
  booking_mode public.booking_mode not null default 'approval',
  min_notice_hours int not null default 12 check (min_notice_hours between 0 and 720),
  max_advance_days int not null default 60 check (max_advance_days between 1 and 365),
  buffer_minutes int not null default 15 check (buffer_minutes between 0 and 240),
  slot_interval_minutes int not null default 30 check (slot_interval_minutes in (15, 30, 60)),
  timezone text not null default 'America/Halifax',
  is_accepting_bookings boolean not null default true,
  onboarding_completed boolean not null default false,
  -- Admin-controlled fields (protected by a trigger):
  verification_status public.verification_status not null default 'unverified',
  approval_status public.approval_status not null default 'pending',
  is_featured boolean not null default false,
  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stylist_profiles_geo_idx on public.stylist_profiles(approx_lat, approx_lng);
create index stylist_profiles_city_idx on public.stylist_profiles(lower(city));

-- Private stylist data: exact studio address and Stripe payout account.
create table public.stylist_private (
  stylist_id uuid primary key references public.stylist_profiles(id) on delete cascade,
  studio_address text check (studio_address is null or char_length(studio_address) <= 300),
  studio_lat double precision check (studio_lat between -90 and 90),
  studio_lng double precision check (studio_lng between -180 and 180),
  business_phone text,
  stripe_account_id text unique,
  stripe_details_submitted boolean not null default false,
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.salon_memberships (
  salon_id uuid not null references public.salons(id) on delete cascade,
  stylist_id uuid not null references public.stylist_profiles(id) on delete cascade,
  member_role text not null default 'stylist' check (member_role in ('owner', 'stylist')),
  created_at timestamptz not null default now(),
  primary key (salon_id, stylist_id)
);

-- A service a stylist offers, with their own price and duration.
create table public.stylist_services (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylist_profiles(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  title text not null check (char_length(title) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  base_price_cents int not null check (base_price_cents between 0 and 10000000),
  duration_minutes int not null check (duration_minutes between 15 and 720),
  deposit_type public.deposit_type not null default 'none',
  deposit_value int not null default 0 check (deposit_value >= 0),
  booking_mode public.booking_mode, -- null = use the stylist's default
  location_types public.location_type[] not null default array['stylist_studio']::public.location_type[]
    check (cardinality(location_types) between 1 and 3),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_percent_range check (deposit_type <> 'percent' or deposit_value between 1 and 100)
);
create index stylist_services_stylist_idx on public.stylist_services(stylist_id);
create index stylist_services_service_idx on public.stylist_services(service_id);

-- Variations (length, size...) and add-ons for a stylist service.
create table public.service_options (
  id uuid primary key default gen_random_uuid(),
  stylist_service_id uuid not null references public.stylist_services(id) on delete cascade,
  group_name text not null check (char_length(group_name) between 1 and 60),
  group_type public.option_group_type not null default 'add_on',
  name text not null check (char_length(name) between 1 and 80),
  price_delta_cents int not null default 0 check (price_delta_cents between -1000000 and 1000000),
  duration_delta_minutes int not null default 0 check (duration_delta_minutes between -240 and 480),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index service_options_service_idx on public.service_options(stylist_service_id);

create table public.stylist_portfolio (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylist_profiles(id) on delete cascade,
  image_url text not null check (char_length(image_url) <= 1000),
  storage_path text,
  caption text not null default '' check (char_length(caption) <= 300),
  service_id uuid references public.services(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index stylist_portfolio_stylist_idx on public.stylist_portfolio(stylist_id);

create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylist_profiles(id) on delete cascade,
  label text not null check (char_length(label) between 2 and 120),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_km int not null default 10 check (radius_km between 1 and 300),
  created_at timestamptz not null default now()
);
create index service_areas_stylist_idx on public.service_areas(stylist_id);

-- Weekly working hours, in the stylist's own time zone. Several windows per
-- day are allowed; a gap between two windows is a break.
create table public.stylist_availability (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylist_profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint availability_window_valid check (end_time > start_time)
);
create index stylist_availability_idx on public.stylist_availability(stylist_id, weekday);

-- Holidays, days off and other unavailable periods.
create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylist_profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  constraint exception_range_valid check (ends_at > starts_at)
);
create index availability_exceptions_idx on public.availability_exceptions(stylist_id, starts_at);

create table public.favorites (
  client_id uuid not null references public.profiles(id) on delete cascade,
  stylist_id uuid not null references public.stylist_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, stylist_id)
);

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code extensions.citext not null unique check (char_length(code::text) between 3 and 30),
  description text not null default '',
  percent_off int check (percent_off between 1 and 100),
  amount_off_cents int check (amount_off_cents > 0),
  min_subtotal_cents int not null default 0,
  max_redemptions int check (max_redemptions > 0),
  redemptions int not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint promo_one_discount check ((percent_off is null) <> (amount_off_cents is null))
);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  client_id uuid not null references public.profiles(id) on delete restrict,
  stylist_id uuid not null references public.stylist_profiles(id) on delete restrict,
  stylist_service_id uuid not null references public.stylist_services(id) on delete restrict,
  status public.booking_status not null,
  booking_mode public.booking_mode not null,
  location_type public.location_type not null,
  salon_id uuid references public.salons(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null, -- ends_at + the stylist's buffer time
  time_range tstzrange generated always as (tstzrange(starts_at, blocked_until, '[)')) stored,
  duration_minutes int not null check (duration_minutes > 0),
  distance_km numeric(7,1),
  currency text not null default 'cad',
  subtotal_cents int not null check (subtotal_cents >= 0),
  discount_cents int not null default 0 check (discount_cents >= 0),
  travel_fee_cents int not null default 0 check (travel_fee_cents >= 0),
  service_fee_cents int not null default 0 check (service_fee_cents >= 0),
  tax_cents int not null default 0 check (tax_cents >= 0),
  total_cents int not null check (total_cents >= 0),
  platform_commission_cents int not null default 0 check (platform_commission_cents >= 0),
  stylist_earnings_cents int not null default 0,
  deposit_cents int not null default 0 check (deposit_cents >= 0),
  amount_paid_cents int not null default 0 check (amount_paid_cents >= 0),
  amount_refunded_cents int not null default 0 check (amount_refunded_cents >= 0),
  cancellation_fee_cents int not null default 0 check (cancellation_fee_cents >= 0),
  payment_provider public.payment_provider not null,
  promo_code_id uuid references public.promo_codes(id) on delete set null,
  client_notes text check (client_notes is null or char_length(client_notes) <= 1000),
  cancellation_reason text check (cancellation_reason is null or char_length(cancellation_reason) <= 500),
  cancelled_by uuid references public.profiles(id) on delete set null,
  hold_expires_at timestamptz,
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  reminder_sent_at timestamptz,
  review_reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_times_valid check (ends_at > starts_at and blocked_until >= ends_at),
  constraint booking_not_self check (client_id <> stylist_id),
  -- THE double-booking guard: two active bookings for the same stylist can
  -- never overlap in time. PostgreSQL enforces this even under concurrency.
  constraint no_double_booking exclude using gist (
    stylist_id with =,
    time_range with &&
  ) where (status in ('pending_payment', 'requested', 'confirmed', 'in_progress'))
);
create index bookings_client_idx on public.bookings(client_id, starts_at desc);
create index bookings_stylist_idx on public.bookings(stylist_id, starts_at desc);
create index bookings_status_idx on public.bookings(status);

create table public.booking_line_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('service', 'option', 'travel', 'discount', 'service_fee', 'tax')),
  description text not null,
  amount_cents int not null,
  duration_minutes int not null default 0,
  ref_id uuid,
  sort_order int not null default 0
);
create index booking_line_items_booking_idx on public.booking_line_items(booking_id);

create table public.booking_status_history (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  from_status public.booking_status,
  to_status public.booking_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index booking_status_history_booking_idx on public.booking_status_history(booking_id, created_at);

-- The exact service address for a mobile appointment. Only the client, the
-- stylist (once the booking is confirmed) and admins can read it.
create table public.booking_private_details (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  address_text text,
  lat double precision,
  lng double precision,
  access_notes text,
  contact_phone text
);

-- ---------------------------------------------------------------------------
-- Payments, refunds, payouts
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  client_id uuid not null references public.profiles(id) on delete restrict,
  stylist_id uuid not null references public.stylist_profiles(id) on delete restrict,
  provider public.payment_provider not null,
  kind public.payment_kind not null,
  amount_cents int not null check (amount_cents > 0),
  amount_refunded_cents int not null default 0 check (amount_refunded_cents >= 0),
  currency text not null default 'cad',
  status public.payment_status not null default 'requires_payment',
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  idempotency_key text not null unique default gen_random_uuid()::text,
  reference_code text, -- e-Transfer message reference
  failure_reason text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_not_more_than_paid check (amount_refunded_cents <= amount_cents)
);
create index payments_booking_idx on public.payments(booking_id);
create index payments_client_idx on public.payments(client_id, created_at desc);
create index payments_stylist_idx on public.payments(stylist_id, created_at desc);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  amount_cents int not null check (amount_cents > 0),
  reason text not null default '',
  status public.refund_status not null default 'pending',
  stripe_refund_id text unique,
  failure_reason text,
  initiated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_booking_idx on public.refunds(booking_id);
create index refunds_status_idx on public.refunds(status);

-- One payout record per booking: money transferred from the platform to the
-- stylist's Stripe connected account.
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  stylist_id uuid not null references public.stylist_profiles(id) on delete restrict,
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'cad',
  status public.payout_status not null default 'pending',
  stripe_transfer_id text unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payouts_stylist_idx on public.payouts(stylist_id, created_at desc);

-- Every Stripe webhook event we have seen, so duplicates are ignored.
create table public.stripe_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

-- ---------------------------------------------------------------------------
-- Reviews, messaging, notifications
-- ---------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  stylist_id uuid not null references public.stylist_profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 2000),
  stylist_reply text check (stylist_reply is null or char_length(stylist_reply) <= 1000),
  replied_at timestamptz,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reviews_stylist_idx on public.reviews(stylist_id, created_at desc);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  stylist_id uuid not null references public.stylist_profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, stylist_id)
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_participants_user_idx on public.conversation_participants(user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages(conversation_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  link text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'skipped', 'failed')),
  sms_status text not null default 'skipped' check (sms_status in ('pending', 'sent', 'skipped', 'failed')),
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_email_pending_idx on public.notifications(created_at) where email_status = 'pending';

-- ---------------------------------------------------------------------------
-- Support, reports and disputes
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  category public.report_category not null default 'support',
  subject text not null check (char_length(subject) between 3 and 150),
  description text not null check (char_length(description) between 10 and 4000),
  reported_user_id uuid references public.profiles(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  review_id uuid references public.reviews(id) on delete set null,
  status public.report_status not null default 'open',
  admin_response text,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_status_idx on public.reports(status, created_at desc);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(reason) between 3 and 150),
  description text not null check (char_length(description) between 10 and 4000),
  status public.dispute_status not null default 'open',
  stylist_response text check (stylist_response is null or char_length(stylist_response) <= 4000),
  resolution_notes text,
  refund_amount_cents int not null default 0 check (refund_amount_cents >= 0),
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index disputes_one_open_per_booking on public.disputes(booking_id)
  where status in ('open', 'under_review');

-- ---------------------------------------------------------------------------
-- Internal: audit trail and rate limiting
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_idx on public.rate_limit_events(user_id, action, created_at);
