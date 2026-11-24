-- ============================================================================
-- BeautyExpress — COMPLETE DATABASE SETUP for a hosted Supabase project
--
-- Paste this whole file into Supabase Dashboard > SQL Editor > New query > Run.
-- Run it ONCE on a NEW, empty project. It is all 7 files from
-- supabase/migrations/ joined together in the correct order.
-- ============================================================================

-- >>>>> 20261012000001_schema.sql
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

-- >>>>> 20261012000002_helpers_and_triggers.sql
-- ============================================================================
-- BeautyExpress — Migration 2: helper functions, signup handling and safety triggers
--
-- SECURITY DEFINER functions run with the privileges of their owner, so they
-- can read tables the caller cannot. Every one of them sets an empty
-- search_path and fully qualifies table names to prevent search_path attacks.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, description, is_public) values
  ('currency', '"cad"', 'Three-letter currency code used for all prices.', true),
  ('commission_percent', '15', 'Percentage of the service price kept by the platform (deducted from the stylist).', true),
  ('service_fee_percent', '5', 'Booking fee charged to the client, as a percentage.', true),
  ('tax_percent', '0', 'Sales tax percentage added at checkout. Set this only after getting tax advice.', true),
  ('free_cancellation_hours', '24', 'Clients can cancel for a full refund up to this many hours before the appointment.', true),
  ('late_cancellation_fee_percent', '50', 'Percentage of the amount paid kept when a client cancels late.', true),
  ('payment_hold_minutes', '15', 'How long a time slot is held while the client completes online payment.', false),
  ('payout_hold_hours', '24', 'Hours after completion before the stylist is paid (allows time to raise a dispute).', true),
  ('require_stylist_approval', 'false', 'If true, an admin must approve a stylist before they appear in search.', false),
  ('online_payments_enabled', 'false', 'Turn on after Stripe is configured and tested.', true),
  ('manual_etransfer_enabled', 'false', 'Allow manual Interac e-Transfer payments verified by an admin.', true),
  ('etransfer_recipient_email', '""', 'Email address clients send Interac e-Transfers to (shown at checkout).', true),
  ('pay_in_person_enabled', 'true', 'Allow paying the stylist directly at the appointment.', true),
  ('review_window_days', '30', 'Days after completion during which the client can leave a review.', true),
  ('max_bookings_per_hour', '5', 'Rate limit: new bookings a client can create per hour.', false),
  ('max_messages_per_minute', '20', 'Rate limit: messages a user can send per minute.', false),
  ('support_email', '"support@example.com"', 'Public support email address.', true),
  ('stripe_connect_country', '"CA"', 'Country used when creating Stripe connected accounts.', false)
on conflict (key) do nothing;

create or replace function public.get_setting(p_key text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.platform_settings where key = p_key
$$;

create or replace function public.setting_int(p_key text, p_default int)
returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::int from public.platform_settings where key = p_key), p_default)
$$;

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::numeric from public.platform_settings where key = p_key), p_default)
$$;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from public.platform_settings where key = p_key), p_default)
$$;

create or replace function public.setting_text(p_key text, p_default text)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select value #>> '{}' from public.platform_settings where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------------
-- Identity helpers used by RLS policies
-- ---------------------------------------------------------------------------
create or replace function public.has_role(p_role public.app_role)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = p_role and p.status = 'active'
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin')
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;

-- True for trusted server code (service role, migrations, SECURITY DEFINER
-- functions) and for admins. Not SECURITY DEFINER on purpose: it must see the
-- *calling* database role.
create or replace function public.is_privileged()
returns boolean
language sql stable set search_path = '' as $$
  select current_user not in ('authenticated', 'anon') or public.is_admin()
$$;

-- Is this stylist visible to the public?
create or replace function public.stylist_is_public(p_stylist_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.stylist_profiles s
    join public.profiles p on p.id = s.id
    where s.id = p_stylist_id
      and s.onboarding_completed
      and p.status = 'active'
      and (s.approval_status = 'approved' or not public.setting_bool('require_stylist_approval', false))
  )
$$;

create or replace function public.is_booking_party(p_booking_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and auth.uid() in (b.client_id, b.stylist_id)
  )
$$;

create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = auth.uid()
  )
$$;

-- Two users "know each other" if they share a booking or a conversation.
-- Used so a stylist can see the name of a client who booked them.
create or replace function public.shares_relationship_with(p_other uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    where (b.client_id = auth.uid() and b.stylist_id = p_other)
       or (b.stylist_id = auth.uid() and b.client_id = p_other)
  ) or exists (
    select 1 from public.conversations c
    where (c.client_id = auth.uid() and c.stylist_id = p_other)
       or (c.stylist_id = auth.uid() and c.client_id = p_other)
  )
$$;

-- Simple per-user rate limiter. Raises an error when the limit is exceeded.
create or replace function public.check_rate_limit(p_action text, p_max int, p_window interval)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    return;
  end if;
  select count(*) into v_count from public.rate_limit_events
   where user_id = auth.uid() and action = p_action and created_at > now() - p_window;
  if v_count >= p_max then
    raise exception 'Too many requests. Please wait a moment and try again.' using errcode = 'P0429';
  end if;
  insert into public.rate_limit_events (user_id, action) values (auth.uid(), p_action);
  -- Housekeeping: drop old rows for this user/action.
  delete from public.rate_limit_events
   where user_id = auth.uid() and action = p_action and created_at < now() - interval '1 day';
end $$;

-- Distance in kilometres between two points (haversine formula).
create or replace function public.distance_km(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision)
returns double precision
language sql immutable set search_path = '' as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
  else 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )) end
$$;

create or replace function public.write_audit(p_action text, p_table text, p_record text,
                                              p_old jsonb, p_new jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), p_action, p_table, p_record, p_old, p_new)
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'addresses', 'service_categories', 'services', 'salons',
    'stylist_profiles', 'stylist_private', 'stylist_services', 'bookings',
    'payments', 'refunds', 'payouts', 'reviews', 'reports', 'disputes'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Audit trail for sensitive tables.
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id text;
begin
  v_id := coalesce(
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'key',
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'user_id'
  );
  insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'platform_settings', 'user_roles', 'service_categories', 'services',
    'promo_codes', 'disputes', 'refunds', 'payouts'
  ] loop
    execute format('create trigger audit_changes after insert or update or delete on public.%I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- New user signup: create a profile and roles.
-- The role requested at signup may only be "client" or "stylist" — never admin.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text := coalesce(new.raw_user_meta_data ->> 'role', 'client');
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), new.email);

  insert into public.user_roles (user_id, role) values (new.id, 'client');

  if v_role = 'stylist' then
    insert into public.user_roles (user_id, role) values (new.id, 'stylist');
    insert into public.stylist_profiles (id, display_name)
    values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120));
    insert into public.stylist_private (stylist_id) values (new.id);
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in sync when a user changes their email address.
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Column protection: block ordinary users from changing admin-only fields.
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_privileged() then
    if new.id is distinct from old.id
       or new.status is distinct from old.status
       or new.status_reason is distinct from old.status_reason
       or new.email is distinct from old.email then
      raise exception 'You cannot change these account fields.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger protect_profile_columns before update on public.profiles
  for each row execute function public.protect_profile_columns();

create or replace function public.protect_stylist_profile_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_privileged() then
    if new.id is distinct from old.id
       or new.verification_status is distinct from old.verification_status
       or new.approval_status is distinct from old.approval_status
       or new.is_featured is distinct from old.is_featured
       or new.rating_avg is distinct from old.rating_avg
       or new.rating_count is distinct from old.rating_count then
      raise exception 'Only administrators can change verification, approval, featured or rating fields.'
        using errcode = '42501';
    end if;
  end if;
  -- Always round the public location to ~1 km for privacy.
  new.approx_lat := round(new.approx_lat::numeric, 2)::double precision;
  new.approx_lng := round(new.approx_lng::numeric, 2)::double precision;
  return new;
end $$;
create trigger protect_stylist_profile_columns before insert or update on public.stylist_profiles
  for each row execute function public.protect_stylist_profile_columns();

create or replace function public.protect_stylist_private_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_privileged() then
    if new.stylist_id is distinct from old.stylist_id
       or new.stripe_account_id is distinct from old.stripe_account_id
       or new.stripe_details_submitted is distinct from old.stripe_details_submitted
       or new.stripe_charges_enabled is distinct from old.stripe_charges_enabled
       or new.stripe_payouts_enabled is distinct from old.stripe_payouts_enabled then
      raise exception 'Payout account fields are managed by the server.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger protect_stylist_private_columns before update on public.stylist_private
  for each row execute function public.protect_stylist_private_columns();

-- Only one default address per user.
create or replace function public.single_default_address()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_default then
    update public.addresses set is_default = false
     where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end $$;
create trigger single_default_address after insert or update of is_default on public.addresses
  for each row when (new.is_default) execute function public.single_default_address();

-- Notifications: users may only mark them read.
create or replace function public.protect_notification_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_privileged() then
    if new.user_id is distinct from old.user_id or new.type is distinct from old.type
       or new.title is distinct from old.title or new.body is distinct from old.body
       or new.link is distinct from old.link or new.data is distinct from old.data
       or new.email_status is distinct from old.email_status
       or new.sms_status is distinct from old.sms_status then
      raise exception 'Only read status can be changed.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger protect_notification_columns before update on public.notifications
  for each row execute function public.protect_notification_columns();

-- Reviews: clients may edit rating/comment only; replies and moderation go
-- through dedicated functions.
create or replace function public.protect_review_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_privileged() then
    if new.booking_id is distinct from old.booking_id or new.client_id is distinct from old.client_id
       or new.stylist_id is distinct from old.stylist_id
       or new.stylist_reply is distinct from old.stylist_reply
       or new.replied_at is distinct from old.replied_at
       or new.is_hidden is distinct from old.is_hidden then
      raise exception 'You cannot change these review fields.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger protect_review_columns before update on public.reviews
  for each row execute function public.protect_review_columns();

-- Keep stylist rating averages up to date.
create or replace function public.refresh_stylist_rating()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_stylist uuid := coalesce(new.stylist_id, old.stylist_id);
begin
  update public.stylist_profiles s set
    rating_avg = coalesce((select round(avg(rating)::numeric, 2) from public.reviews
                            where stylist_id = v_stylist and not is_hidden), 0),
    rating_count = (select count(*) from public.reviews where stylist_id = v_stylist and not is_hidden)
  where s.id = v_stylist;
  return null;
end $$;
create trigger refresh_stylist_rating after insert or update or delete on public.reviews
  for each row execute function public.refresh_stylist_rating();

-- ---------------------------------------------------------------------------
-- Review eligibility (used by RLS policies on public.reviews)
-- A client may review a booking once, after it is completed, within the
-- review window, and only if they were the client on that booking.
-- ---------------------------------------------------------------------------
create or replace function public.can_review_booking(p_booking_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and b.client_id = auth.uid()
      and b.status = 'completed'
      and b.completed_at > now() - make_interval(days => public.setting_int('review_window_days', 30))
      and not exists (select 1 from public.reviews r where r.booking_id = b.id)
  )
$$;

create or replace function public.can_edit_review(p_review_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.reviews r
    where r.id = p_review_id and r.client_id = auth.uid()
      and r.created_at > now() - make_interval(days => public.setting_int('review_window_days', 30))
  )
$$;

-- The review's stylist always comes from the booking, never from the client.
create or replace function public.set_review_stylist()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select b.stylist_id into new.stylist_id from public.bookings b where b.id = new.booking_id;
  return new;
end $$;
create trigger set_review_stylist before insert on public.reviews
  for each row execute function public.set_review_stylist();

-- A stylist can only publish their profile (onboarding_completed = true) once
-- it is bookable: a city, at least one way of working, one active service
-- and some working hours.
-- (Not SECURITY DEFINER: it must see the calling role, and stylists can read
-- their own services and hours through RLS.)
create or replace function public.check_stylist_listing_ready()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.onboarding_completed and (tg_op = 'INSERT' or not old.onboarding_completed)
     and current_user in ('authenticated', 'anon') then
    if btrim(new.display_name) = '' or btrim(new.city) = '' then
      raise exception 'Add your name and city before publishing your profile.' using errcode = 'P0422';
    end if;
    if not (new.offers_mobile or new.offers_studio or new.offers_salon) then
      raise exception 'Choose at least one place where you work.' using errcode = 'P0422';
    end if;
    if not exists (select 1 from public.stylist_services where stylist_id = new.id and is_active) then
      raise exception 'Add at least one service before publishing your profile.' using errcode = 'P0422';
    end if;
    if not exists (select 1 from public.stylist_availability where stylist_id = new.id) then
      raise exception 'Set your working hours before publishing your profile.' using errcode = 'P0422';
    end if;
  end if;
  return new;
end $$;
create trigger check_stylist_listing_ready before insert or update of onboarding_completed on public.stylist_profiles
  for each row execute function public.check_stylist_listing_ready();

-- >>>>> 20261012000003_row_level_security.sql
-- ============================================================================
-- BeautyExpress — Migration 3: Row Level Security (RLS)
--
-- RLS is the database's own permission system. Even if someone calls the API
-- directly with the public "anon" key, these rules decide which rows they can
-- read or change. Tables holding money or booking state cannot be written
-- directly at all; changes go through checked functions (migration 4).
-- ============================================================================

-- Turn RLS on for every table in the public schema.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Defence in depth: remove write privileges on tables that must only be
-- changed through SECURITY DEFINER functions or by the service role.
revoke insert, update, delete, truncate on
  public.user_roles, public.bookings, public.booking_line_items,
  public.booking_status_history, public.booking_private_details,
  public.payments, public.refunds, public.payouts, public.stripe_events,
  public.audit_logs, public.rate_limit_events, public.conversations,
  public.conversation_participants, public.disputes
from anon, authenticated;

-- Internal tables are not readable by API users at all.
revoke all on public.stripe_events, public.rate_limit_events from anon, authenticated;

-- Anonymous visitors never write anything.
revoke insert, update, delete, truncate on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles: read own, counterparts, admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.shares_relationship_with(id));

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- Inserts happen only through the signup trigger; deletes cascade from auth.users.

-- ---------------------------------------------------------------------------
-- user_roles: read own roles; admins read all. Writes only via admin functions.
-- ---------------------------------------------------------------------------
create policy "user_roles: read own or admin" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- addresses: completely private to the owner
-- ---------------------------------------------------------------------------
create policy "addresses: owner read" on public.addresses
  for select to authenticated using (user_id = auth.uid());
create policy "addresses: owner insert" on public.addresses
  for insert to authenticated with check (user_id = auth.uid() and public.is_active_user());
create policy "addresses: owner update" on public.addresses
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "addresses: owner delete" on public.addresses
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- platform_settings: public keys readable by everyone; admins manage
-- ---------------------------------------------------------------------------
create policy "settings: read public" on public.platform_settings
  for select to anon, authenticated using (is_public or public.is_admin());
create policy "settings: admin update" on public.platform_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create policy "categories: public read" on public.service_categories
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "categories: admin insert" on public.service_categories
  for insert to authenticated with check (public.is_admin());
create policy "categories: admin update" on public.service_categories
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "categories: admin delete" on public.service_categories
  for delete to authenticated using (public.is_admin());

create policy "services: public read" on public.services
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "services: admin insert" on public.services
  for insert to authenticated with check (public.is_admin());
create policy "services: admin update" on public.services
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "services: admin delete" on public.services
  for delete to authenticated using (public.is_admin());

create policy "promo: admin read" on public.promo_codes
  for select to authenticated using (public.is_admin());
create policy "promo: admin insert" on public.promo_codes
  for insert to authenticated with check (public.is_admin());
create policy "promo: admin update" on public.promo_codes
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "promo: admin delete" on public.promo_codes
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Salons (public business information)
-- ---------------------------------------------------------------------------
create policy "salons: public read" on public.salons
  for select to anon, authenticated using (true);
create policy "salons: stylists create" on public.salons
  for insert to authenticated
  with check (public.has_role('stylist') and created_by = auth.uid());
create policy "salons: owner or admin update" on public.salons
  for update to authenticated
  using (public.is_admin() or exists (
    select 1 from public.salon_memberships m
    where m.salon_id = salons.id and m.stylist_id = auth.uid() and m.member_role = 'owner'))
  with check (public.is_admin() or exists (
    select 1 from public.salon_memberships m
    where m.salon_id = salons.id and m.stylist_id = auth.uid() and m.member_role = 'owner'));
create policy "salons: admin delete" on public.salons
  for delete to authenticated using (public.is_admin());

create policy "memberships: public read" on public.salon_memberships
  for select to anon, authenticated using (true);
create policy "memberships: stylist joins" on public.salon_memberships
  for insert to authenticated
  with check (
    stylist_id = auth.uid() and public.has_role('stylist')
    and (
      member_role = 'stylist'
      -- you may be the owner only of a salon you created yourself
      or exists (select 1 from public.salons s where s.id = salon_id and s.created_by = auth.uid())
    )
  );
create policy "memberships: leave or admin" on public.salon_memberships
  for delete to authenticated using (stylist_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Stylist profiles and listings
-- ---------------------------------------------------------------------------
create policy "stylist_profiles: public read listed" on public.stylist_profiles
  for select to anon, authenticated
  using (public.stylist_is_public(id) or id = auth.uid() or public.is_admin());
create policy "stylist_profiles: owner update" on public.stylist_profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy "stylist_private: owner or admin read" on public.stylist_private
  for select to authenticated using (stylist_id = auth.uid() or public.is_admin());
create policy "stylist_private: owner update" on public.stylist_private
  for update to authenticated using (stylist_id = auth.uid()) with check (stylist_id = auth.uid());

create policy "stylist_services: public read" on public.stylist_services
  for select to anon, authenticated
  using ((is_active and public.stylist_is_public(stylist_id)) or stylist_id = auth.uid() or public.is_admin());
create policy "stylist_services: owner insert" on public.stylist_services
  for insert to authenticated
  with check (stylist_id = auth.uid() and public.has_role('stylist'));
create policy "stylist_services: owner update" on public.stylist_services
  for update to authenticated
  using (stylist_id = auth.uid() or public.is_admin())
  with check (stylist_id = auth.uid() or public.is_admin());
create policy "stylist_services: owner delete" on public.stylist_services
  for delete to authenticated using (stylist_id = auth.uid());

create policy "service_options: public read" on public.service_options
  for select to anon, authenticated
  using (exists (
    select 1 from public.stylist_services ss where ss.id = stylist_service_id
      and ((ss.is_active and public.stylist_is_public(ss.stylist_id)) or ss.stylist_id = auth.uid() or public.is_admin())));
create policy "service_options: owner insert" on public.service_options
  for insert to authenticated
  with check (exists (select 1 from public.stylist_services ss
                      where ss.id = stylist_service_id and ss.stylist_id = auth.uid()));
create policy "service_options: owner update" on public.service_options
  for update to authenticated
  using (exists (select 1 from public.stylist_services ss
                 where ss.id = stylist_service_id and ss.stylist_id = auth.uid()))
  with check (exists (select 1 from public.stylist_services ss
                      where ss.id = stylist_service_id and ss.stylist_id = auth.uid()));
create policy "service_options: owner delete" on public.service_options
  for delete to authenticated
  using (exists (select 1 from public.stylist_services ss
                 where ss.id = stylist_service_id and ss.stylist_id = auth.uid()));

-- Portfolio, service areas and weekly hours: public when the stylist is public.
create policy "portfolio: public read" on public.stylist_portfolio
  for select to anon, authenticated
  using (public.stylist_is_public(stylist_id) or stylist_id = auth.uid() or public.is_admin());
create policy "portfolio: owner insert" on public.stylist_portfolio
  for insert to authenticated with check (stylist_id = auth.uid() and public.has_role('stylist'));
create policy "portfolio: owner update" on public.stylist_portfolio
  for update to authenticated using (stylist_id = auth.uid()) with check (stylist_id = auth.uid());
create policy "portfolio: owner or admin delete" on public.stylist_portfolio
  for delete to authenticated using (stylist_id = auth.uid() or public.is_admin());

create policy "service_areas: public read" on public.service_areas
  for select to anon, authenticated
  using (public.stylist_is_public(stylist_id) or stylist_id = auth.uid() or public.is_admin());
create policy "service_areas: owner insert" on public.service_areas
  for insert to authenticated with check (stylist_id = auth.uid() and public.has_role('stylist'));
create policy "service_areas: owner update" on public.service_areas
  for update to authenticated using (stylist_id = auth.uid()) with check (stylist_id = auth.uid());
create policy "service_areas: owner delete" on public.service_areas
  for delete to authenticated using (stylist_id = auth.uid());

create policy "availability: public read" on public.stylist_availability
  for select to anon, authenticated
  using (public.stylist_is_public(stylist_id) or stylist_id = auth.uid() or public.is_admin());
create policy "availability: owner insert" on public.stylist_availability
  for insert to authenticated with check (stylist_id = auth.uid() and public.has_role('stylist'));
create policy "availability: owner update" on public.stylist_availability
  for update to authenticated using (stylist_id = auth.uid()) with check (stylist_id = auth.uid());
create policy "availability: owner delete" on public.stylist_availability
  for delete to authenticated using (stylist_id = auth.uid());

-- Exceptions may contain private reasons ("doctor appointment"): owner only.
create policy "exceptions: owner read" on public.availability_exceptions
  for select to authenticated using (stylist_id = auth.uid() or public.is_admin());
create policy "exceptions: owner insert" on public.availability_exceptions
  for insert to authenticated with check (stylist_id = auth.uid() and public.has_role('stylist'));
create policy "exceptions: owner update" on public.availability_exceptions
  for update to authenticated using (stylist_id = auth.uid()) with check (stylist_id = auth.uid());
create policy "exceptions: owner delete" on public.availability_exceptions
  for delete to authenticated using (stylist_id = auth.uid());

create policy "favorites: owner read" on public.favorites
  for select to authenticated using (client_id = auth.uid());
create policy "favorites: owner insert" on public.favorites
  for insert to authenticated with check (client_id = auth.uid());
create policy "favorites: owner delete" on public.favorites
  for delete to authenticated using (client_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Bookings and money: read-only for the parties involved
-- ---------------------------------------------------------------------------
create policy "bookings: parties and admin read" on public.bookings
  for select to authenticated
  using (client_id = auth.uid() or stylist_id = auth.uid() or public.is_admin());

create policy "line_items: parties read" on public.booking_line_items
  for select to authenticated using (public.is_booking_party(booking_id) or public.is_admin());

create policy "status_history: parties read" on public.booking_status_history
  for select to authenticated using (public.is_booking_party(booking_id) or public.is_admin());

-- The stylist sees the service address only once the booking is confirmed.
create policy "private_details: client, confirmed stylist, admin" on public.booking_private_details
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.bookings b where b.id = booking_id and (
      b.client_id = auth.uid()
      or (b.stylist_id = auth.uid() and b.status in ('confirmed', 'in_progress', 'completed'))
    ))
  );

create policy "payments: parties read" on public.payments
  for select to authenticated
  using (client_id = auth.uid() or stylist_id = auth.uid() or public.is_admin());

create policy "refunds: parties read" on public.refunds
  for select to authenticated using (public.is_booking_party(booking_id) or public.is_admin());

create policy "payouts: stylist read" on public.payouts
  for select to authenticated using (stylist_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
create policy "reviews: public read visible" on public.reviews
  for select to anon, authenticated
  using (not is_hidden or client_id = auth.uid() or stylist_id = auth.uid() or public.is_admin());
create policy "reviews: eligible client insert" on public.reviews
  for insert to authenticated
  with check (client_id = auth.uid() and public.can_review_booking(booking_id));
create policy "reviews: author update within window" on public.reviews
  for update to authenticated
  using ((client_id = auth.uid() and public.can_edit_review(id)) or public.is_admin())
  with check (client_id = auth.uid() or public.is_admin());
create policy "reviews: admin delete" on public.reviews
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Messaging: participants only
-- ---------------------------------------------------------------------------
create policy "conversations: participants read" on public.conversations
  for select to authenticated using (public.is_conversation_participant(id) or public.is_admin());

create policy "participants: participants read" on public.conversation_participants
  for select to authenticated using (public.is_conversation_participant(conversation_id));

create policy "messages: participants read" on public.messages
  for select to authenticated using (public.is_conversation_participant(conversation_id));
create policy "messages: participants send" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_active_user()
              and public.is_conversation_participant(conversation_id));

-- ---------------------------------------------------------------------------
-- Notifications: own only
-- ---------------------------------------------------------------------------
create policy "notifications: own read" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications: own mark read" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications: own delete" on public.notifications
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reports and disputes
-- ---------------------------------------------------------------------------
create policy "reports: reporter or admin read" on public.reports
  for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
create policy "reports: create own" on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'open' and admin_response is null
              and resolved_by is null and public.is_active_user()
              and (booking_id is null or public.is_booking_party(booking_id)));
create policy "reports: admin update" on public.reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "disputes: parties and admin read" on public.disputes
  for select to authenticated using (public.is_booking_party(booking_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- Audit log: admins only (read)
-- ---------------------------------------------------------------------------
create policy "audit: admin read" on public.audit_logs
  for select to authenticated using (public.is_admin());

-- >>>>> 20261012000004_pricing_availability_bookings.sql
-- ============================================================================
-- BeautyExpress — Migration 4: pricing, availability and the booking workflow
--
-- The browser never decides prices, availability or booking statuses. It
-- calls these functions, which read the current database records and enforce
-- every rule inside a single transaction.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Duration of a service including selected options
-- ---------------------------------------------------------------------------
create or replace function public.service_duration(p_stylist_service_id uuid, p_option_ids uuid[])
returns int
language sql stable security definer set search_path = '' as $$
  select greatest(15,
    (select duration_minutes from public.stylist_services where id = p_stylist_service_id)
    + coalesce((select sum(duration_delta_minutes)::int from public.service_options
                where stylist_service_id = p_stylist_service_id and is_active
                  and id = any(coalesce(p_option_ids, '{}'))), 0))
$$;

-- ---------------------------------------------------------------------------
-- quote_booking: the single source of truth for prices.
--
--   subtotal      = base price + selected options
--   discount      = promo code (percent rounded down, or fixed amount)
--   travel fee    = base travel fee + per-km fee x distance (mobile only)
--   service fee   = service_fee_percent of (subtotal - discount + travel)
--   tax           = tax_percent of (subtotal - discount + travel + service fee)
--   total         = subtotal - discount + travel + service fee + tax
--   commission    = commission_percent of (subtotal - discount)   [kept by platform]
--   stylist earns = total - commission - service fee - tax
--
-- The JavaScript mirror lives in src/lib/pricing.js and a test checks both agree.
-- ---------------------------------------------------------------------------
create or replace function public.quote_booking(
  p_stylist_service_id uuid,
  p_option_ids uuid[] default '{}',
  p_location_type public.location_type default 'stylist_studio',
  p_client_lat double precision default null,
  p_client_lng double precision default null,
  p_promo_code text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ss public.stylist_services;
  v_sp public.stylist_profiles;
  v_opts uuid[] := array(select distinct unnest(coalesce(p_option_ids, '{}')));
  v_items jsonb := '[]'::jsonb;
  v_subtotal int;
  v_duration int;
  v_opt record;
  v_group record;
  v_km numeric;
  v_in_area boolean := true;
  v_travel int := 0;
  v_discount int := 0;
  v_promo public.promo_codes;
  v_service_fee int;
  v_tax int;
  v_total int;
  v_commission int;
  v_deposit int;
  v_requires_approval boolean := false;
  v_fee_pct numeric := public.setting_numeric('service_fee_percent', 0);
  v_tax_pct numeric := public.setting_numeric('tax_percent', 0);
  v_comm_pct numeric := public.setting_numeric('commission_percent', 0);
begin
  select * into v_ss from public.stylist_services where id = p_stylist_service_id and is_active;
  if not found or not public.stylist_is_public(v_ss.stylist_id) then
    raise exception 'This service is not available.' using errcode = 'P0404';
  end if;
  select * into v_sp from public.stylist_profiles where id = v_ss.stylist_id;

  -- Location type must be offered by both the service and the stylist.
  if not (p_location_type = any(v_ss.location_types))
     or (p_location_type = 'client_location' and not v_sp.offers_mobile)
     or (p_location_type = 'stylist_studio' and not v_sp.offers_studio)
     or (p_location_type = 'salon' and (not v_sp.offers_salon or v_sp.salon_id is null)) then
    raise exception 'This stylist does not offer that appointment location for this service.' using errcode = 'P0422';
  end if;

  -- Options must belong to this service and be active.
  if (select count(*) from public.service_options
      where id = any(v_opts) and stylist_service_id = v_ss.id and is_active) <> cardinality(v_opts) then
    raise exception 'One of the selected options is not available.' using errcode = 'P0422';
  end if;

  -- Exactly one choice is required in each "choose one" group (e.g. Length).
  for v_group in
    select group_name, count(*) filter (where id = any(v_opts)) as picked
    from public.service_options
    where stylist_service_id = v_ss.id and is_active and group_type = 'choose_one'
    group by group_name
  loop
    if v_group.picked <> 1 then
      raise exception 'Please choose one option for "%".', v_group.group_name using errcode = 'P0422';
    end if;
  end loop;

  v_subtotal := v_ss.base_price_cents;
  v_items := v_items || jsonb_build_object('kind', 'service', 'description', v_ss.title,
    'amount_cents', v_ss.base_price_cents, 'duration_minutes', v_ss.duration_minutes, 'ref_id', v_ss.id);

  for v_opt in
    select * from public.service_options where id = any(v_opts) order by group_type, sort_order, name
  loop
    v_subtotal := v_subtotal + v_opt.price_delta_cents;
    v_items := v_items || jsonb_build_object('kind', 'option',
      'description', v_opt.group_name || ': ' || v_opt.name,
      'amount_cents', v_opt.price_delta_cents, 'duration_minutes', v_opt.duration_delta_minutes,
      'ref_id', v_opt.id);
  end loop;
  v_subtotal := greatest(v_subtotal, 0);
  v_duration := public.service_duration(v_ss.id, v_opts);

  -- Promo code
  if nullif(btrim(coalesce(p_promo_code, '')), '') is not null then
    select * into v_promo from public.promo_codes
     where code = btrim(p_promo_code)::extensions.citext and is_active
       and (starts_at is null or starts_at <= now())
       and (expires_at is null or expires_at > now())
       and (max_redemptions is null or redemptions < max_redemptions);
    if not found or v_subtotal < v_promo.min_subtotal_cents then
      raise exception 'This promo code is not valid.' using errcode = 'P0422';
    end if;
    if v_promo.percent_off is not null then
      v_discount := floor(v_subtotal * v_promo.percent_off / 100.0)::int;
    else
      v_discount := least(v_promo.amount_off_cents, v_subtotal);
    end if;
    v_items := v_items || jsonb_build_object('kind', 'discount', 'description', 'Promo ' || v_promo.code::text,
      'amount_cents', -v_discount, 'duration_minutes', 0, 'ref_id', v_promo.id);
  end if;

  -- Travel fee for mobile appointments
  if p_location_type = 'client_location' then
    v_km := round(public.distance_km(v_sp.approx_lat, v_sp.approx_lng, p_client_lat, p_client_lng)::numeric, 1);
    if v_km is null then
      -- Distance unknown (no map coordinates): charge only the base fee and
      -- let the stylist confirm they can travel there.
      v_travel := v_sp.travel_fee_base_cents;
      v_requires_approval := true;
    else
      v_in_area := v_km <= v_sp.max_travel_km or exists (
        select 1 from public.service_areas a where a.stylist_id = v_sp.id
          and public.distance_km(a.lat, a.lng, p_client_lat, p_client_lng) <= a.radius_km);
      if not v_in_area then
        raise exception 'This address is outside the stylist''s travel area (% km away).', v_km
          using errcode = 'P0422';
      end if;
      v_travel := v_sp.travel_fee_base_cents + round(v_sp.travel_fee_per_km_cents * v_km)::int;
    end if;
    if v_travel > 0 then
      v_items := v_items || jsonb_build_object('kind', 'travel',
        'description', case when v_km is null then 'Travel fee' else 'Travel fee (' || v_km || ' km)' end,
        'amount_cents', v_travel, 'duration_minutes', 0, 'ref_id', null);
    end if;
  end if;

  v_service_fee := round((v_subtotal - v_discount + v_travel) * v_fee_pct / 100)::int;
  v_tax := round((v_subtotal - v_discount + v_travel + v_service_fee) * v_tax_pct / 100)::int;
  v_total := v_subtotal - v_discount + v_travel + v_service_fee + v_tax;
  v_commission := round((v_subtotal - v_discount) * v_comm_pct / 100)::int;

  if v_service_fee > 0 then
    v_items := v_items || jsonb_build_object('kind', 'service_fee', 'description', 'Booking fee',
      'amount_cents', v_service_fee, 'duration_minutes', 0, 'ref_id', null);
  end if;
  if v_tax > 0 then
    v_items := v_items || jsonb_build_object('kind', 'tax', 'description', 'Tax',
      'amount_cents', v_tax, 'duration_minutes', 0, 'ref_id', null);
  end if;

  v_deposit := case v_ss.deposit_type
    when 'percent' then round(v_total * v_ss.deposit_value / 100.0)::int
    when 'fixed' then least(v_ss.deposit_value, v_total)
    else v_total end;

  return jsonb_build_object(
    'stylist_service_id', v_ss.id,
    'stylist_id', v_ss.stylist_id,
    'currency', public.setting_text('currency', 'cad'),
    'line_items', v_items,
    'subtotal_cents', v_subtotal,
    'discount_cents', v_discount,
    'travel_fee_cents', v_travel,
    'service_fee_cents', v_service_fee,
    'tax_cents', v_tax,
    'total_cents', v_total,
    'platform_commission_cents', v_commission,
    'stylist_earnings_cents', v_total - v_commission - v_service_fee - v_tax,
    'deposit_type', v_ss.deposit_type,
    'deposit_cents', v_deposit,
    'balance_cents', v_total - v_deposit,
    'duration_minutes', v_duration,
    'distance_km', v_km,
    'requires_approval', v_requires_approval
      or coalesce(v_ss.booking_mode, v_sp.booking_mode) = 'approval',
    'promo_code_id', v_promo.id,
    'payment_options', jsonb_build_object(
      'stripe', public.setting_bool('online_payments_enabled', false),
      'manual_etransfer', public.setting_bool('manual_etransfer_enabled', false),
      'pay_in_person', public.setting_bool('pay_in_person_enabled', true))
  );
end $$;

-- ---------------------------------------------------------------------------
-- Availability
-- ---------------------------------------------------------------------------

-- Free slots for a stylist service on one calendar day (in the stylist's time
-- zone). A slot is offered only if the whole appointment plus the stylist's
-- buffer fits without touching another active booking or a time-off period.
create or replace function public.get_available_slots(
  p_stylist_service_id uuid,
  p_date date,
  p_option_ids uuid[] default '{}',
  p_exclude_booking_id uuid default null
) returns table (slot_start timestamptz, slot_end timestamptz)
language sql stable security definer set search_path = '' as $$
  with ss as (
    select s.id, s.stylist_id, sp.timezone as tz, sp.buffer_minutes, sp.slot_interval_minutes,
           sp.min_notice_hours, sp.max_advance_days
    from public.stylist_services s
    join public.stylist_profiles sp on sp.id = s.stylist_id
    where s.id = p_stylist_service_id and s.is_active and sp.is_accepting_bookings
      and public.stylist_is_public(s.stylist_id)
  ),
  dur as (select public.service_duration(p_stylist_service_id, p_option_ids) as minutes),
  windows as (
    select ss.*, ((p_date + a.start_time) at time zone ss.tz) as w_start,
                 ((p_date + a.end_time) at time zone ss.tz) as w_end
    from ss
    join public.stylist_availability a
      on a.stylist_id = ss.stylist_id and a.weekday = extract(dow from p_date)
  ),
  candidates as (
    select gs as slot_start, gs + make_interval(mins => dur.minutes) as slot_end, w.*
    from windows w cross join dur
    cross join lateral generate_series(
      w.w_start, w.w_end - make_interval(mins => dur.minutes),
      make_interval(mins => w.slot_interval_minutes)) gs
  )
  select distinct c.slot_start, c.slot_end
  from candidates c
  where c.slot_start >= now() + make_interval(hours => c.min_notice_hours)
    and c.slot_start <= now() + make_interval(days => c.max_advance_days)
    and not exists (
      select 1 from public.bookings b
      where b.stylist_id = c.stylist_id
        and b.status in ('pending_payment', 'requested', 'confirmed', 'in_progress')
        and not (b.status = 'pending_payment' and b.hold_expires_at < now())
        and b.id is distinct from p_exclude_booking_id
        and b.time_range && tstzrange(c.slot_start,
                                      c.slot_end + make_interval(mins => c.buffer_minutes), '[)'))
    and not exists (
      select 1 from public.availability_exceptions e
      where e.stylist_id = c.stylist_id
        and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(c.slot_start, c.slot_end, '[)'))
  order by 1
$$;

-- ---------------------------------------------------------------------------
-- Booking status helpers
-- ---------------------------------------------------------------------------
create or replace function public.log_booking_status(p_booking_id uuid, p_from public.booking_status,
                                                     p_to public.booking_status, p_reason text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.booking_status_history (booking_id, from_status, to_status, changed_by, reason)
  values (p_booking_id, p_from, p_to, auth.uid(), p_reason)
$$;

-- Release slots whose online payment was never completed.
create or replace function public.expire_stale_holds()
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    update public.bookings set status = 'expired', hold_expires_at = null
     where status = 'pending_payment' and hold_expires_at < now()
    returning id
  loop
    insert into public.booking_status_history (booking_id, from_status, to_status, reason)
    values (v_row.id, 'pending_payment', 'expired', 'Payment was not completed in time');
    update public.payments set status = 'canceled'
     where booking_id = v_row.id and status in ('requires_payment', 'processing') and provider = 'stripe';
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Create refund records (status "pending") spread across a booking's paid
-- online payments. Stripe refunds are then executed by an Edge Function.
create or replace function public.queue_refunds(p_booking_id uuid, p_amount_cents int, p_reason text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_left int := greatest(coalesce(p_amount_cents, 0), 0);
  v_pay record;
  v_avail int;
  v_take int;
  v_total int := 0;
begin
  for v_pay in
    select p.id, p.amount_cents - p.amount_refunded_cents
           - coalesce((select sum(r.amount_cents) from public.refunds r
                       where r.payment_id = p.id and r.status in ('pending', 'processing')), 0) as refundable
    from public.payments p
    where p.booking_id = p_booking_id and p.status in ('succeeded', 'partially_refunded')
      and p.provider in ('stripe', 'manual_etransfer')
    order by p.created_at desc
  loop
    exit when v_left <= 0;
    v_avail := greatest(v_pay.refundable, 0);
    continue when v_avail = 0;
    v_take := least(v_avail, v_left);
    insert into public.refunds (payment_id, booking_id, amount_cents, reason, initiated_by)
    values (v_pay.id, p_booking_id, v_take, coalesce(p_reason, ''), auth.uid());
    v_left := v_left - v_take;
    v_total := v_total + v_take;
  end loop;
  return v_total;
end $$;

-- Money actually collected through the platform for a booking (net of refunds).
create or replace function public.booking_net_paid(p_booking_id uuid)
returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_cents - amount_refunded_cents), 0)::int
  from public.payments
  where booking_id = p_booking_id and status in ('succeeded', 'partially_refunded')
    and provider in ('stripe', 'manual_etransfer')
$$;

create or replace function public.ensure_conversation(p_client uuid, p_stylist uuid, p_booking uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.conversations (client_id, stylist_id, booking_id)
  values (p_client, p_stylist, p_booking)
  on conflict (client_id, stylist_id) do update set booking_id = coalesce(excluded.booking_id, public.conversations.booking_id)
  returning id into v_id;
  insert into public.conversation_participants (conversation_id, user_id)
  values (v_id, p_client), (v_id, p_stylist)
  on conflict do nothing;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- create_booking: the atomic booking transaction
-- ---------------------------------------------------------------------------
create or replace function public.create_booking(
  p_stylist_service_id uuid,
  p_option_ids uuid[],
  p_starts_at timestamptz,
  p_location_type public.location_type,
  p_address_id uuid default null,
  p_client_notes text default null,
  p_promo_code text default null,
  p_payment_provider public.payment_provider default null,
  p_contact_phone text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ss public.stylist_services;
  v_sp public.stylist_profiles;
  v_addr public.addresses;
  v_quote jsonb;
  v_status public.booking_status;
  v_mode public.booking_mode;
  v_provider public.payment_provider;
  v_booking public.bookings;
  v_duration int;
  v_due int;
  v_total int;
  v_needs_online boolean;
  v_item jsonb;
  v_i int := 0;
begin
  if v_uid is null then
    raise exception 'Please sign in to book an appointment.' using errcode = '28000';
  end if;
  if not public.is_active_user() then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if p_client_notes is not null and char_length(p_client_notes) > 1000 then
    raise exception 'Notes must be 1000 characters or fewer.' using errcode = 'P0422';
  end if;

  perform public.check_rate_limit('create_booking', public.setting_int('max_bookings_per_hour', 5), interval '1 hour');
  perform public.expire_stale_holds();

  select * into v_ss from public.stylist_services where id = p_stylist_service_id;
  select * into v_sp from public.stylist_profiles where id = v_ss.stylist_id;
  if v_sp.id = v_uid then
    raise exception 'You cannot book your own service.' using errcode = 'P0422';
  end if;
  if v_sp.id is not null and not v_sp.is_accepting_bookings then
    raise exception 'This stylist is not accepting bookings right now.' using errcode = 'P0422';
  end if;

  if p_location_type = 'client_location' then
    select * into v_addr from public.addresses where id = p_address_id and user_id = v_uid;
    if not found then
      raise exception 'Please choose one of your saved addresses for a mobile appointment.' using errcode = 'P0422';
    end if;
  end if;

  -- Authoritative price (raises if the service, options or location are invalid).
  v_quote := public.quote_booking(p_stylist_service_id, p_option_ids, p_location_type,
                                  v_addr.lat, v_addr.lng, p_promo_code);
  v_duration := (v_quote ->> 'duration_minutes')::int;
  v_total := (v_quote ->> 'total_cents')::int;

  -- The requested start must be one of the currently free slots.
  if not exists (
    select 1 from public.get_available_slots(p_stylist_service_id,
      (p_starts_at at time zone v_sp.timezone)::date, p_option_ids) s
    where s.slot_start = p_starts_at
  ) then
    raise exception 'That time is no longer available. Please choose another time.' using errcode = 'P0409';
  end if;

  -- Payment method
  v_provider := coalesce(p_payment_provider,
    case when public.setting_bool('online_payments_enabled', false) then 'stripe'::public.payment_provider
         else 'pay_in_person'::public.payment_provider end);
  if (v_provider = 'stripe' and not public.setting_bool('online_payments_enabled', false))
     or (v_provider = 'manual_etransfer' and not public.setting_bool('manual_etransfer_enabled', false))
     or (v_provider = 'pay_in_person' and not public.setting_bool('pay_in_person_enabled', true)) then
    raise exception 'That payment method is not available.' using errcode = 'P0422';
  end if;

  v_due := case when v_provider = 'pay_in_person' then 0 else (v_quote ->> 'deposit_cents')::int end;
  v_needs_online := v_provider = 'stripe' and v_due > 0;

  v_mode := case when (v_quote ->> 'requires_approval')::boolean then 'approval'::public.booking_mode
                 else 'instant'::public.booking_mode end;
  v_status := case when v_needs_online then 'pending_payment'::public.booking_status
                   when v_mode = 'instant' then 'confirmed'::public.booking_status
                   else 'requested'::public.booking_status end;

  begin
    insert into public.bookings (
      client_id, stylist_id, stylist_service_id, status, booking_mode, location_type, salon_id,
      starts_at, ends_at, blocked_until, duration_minutes, distance_km, currency,
      subtotal_cents, discount_cents, travel_fee_cents, service_fee_cents, tax_cents, total_cents,
      platform_commission_cents, stylist_earnings_cents, deposit_cents, payment_provider,
      promo_code_id, client_notes, hold_expires_at, confirmed_at)
    values (
      v_uid, v_sp.id, v_ss.id, v_status, v_mode, p_location_type,
      case when p_location_type = 'salon' then v_sp.salon_id end,
      p_starts_at, p_starts_at + make_interval(mins => v_duration),
      p_starts_at + make_interval(mins => v_duration + v_sp.buffer_minutes),
      v_duration, (v_quote ->> 'distance_km')::numeric, v_quote ->> 'currency',
      (v_quote ->> 'subtotal_cents')::int, (v_quote ->> 'discount_cents')::int,
      (v_quote ->> 'travel_fee_cents')::int, (v_quote ->> 'service_fee_cents')::int,
      (v_quote ->> 'tax_cents')::int, v_total,
      (v_quote ->> 'platform_commission_cents')::int, (v_quote ->> 'stylist_earnings_cents')::int,
      v_due, v_provider, (v_quote ->> 'promo_code_id')::uuid, nullif(btrim(p_client_notes), ''),
      case when v_needs_online then now() + make_interval(mins => public.setting_int('payment_hold_minutes', 15)) end,
      case when v_status = 'confirmed' then now() end)
    returning * into v_booking;
  exception when exclusion_violation then
    raise exception 'That time was just booked by someone else. Please choose another time.' using errcode = 'P0409';
  end;

  for v_item in select * from jsonb_array_elements(v_quote -> 'line_items') loop
    insert into public.booking_line_items (booking_id, kind, description, amount_cents, duration_minutes, ref_id, sort_order)
    values (v_booking.id, v_item ->> 'kind', v_item ->> 'description', (v_item ->> 'amount_cents')::int,
            coalesce((v_item ->> 'duration_minutes')::int, 0), (v_item ->> 'ref_id')::uuid, v_i);
    v_i := v_i + 1;
  end loop;

  if p_location_type = 'client_location' then
    insert into public.booking_private_details (booking_id, address_text, lat, lng, access_notes, contact_phone)
    values (v_booking.id,
            concat_ws(', ', v_addr.line1, nullif(v_addr.line2, ''), v_addr.city, nullif(v_addr.province, ''),
                      nullif(v_addr.postal_code, '')),
            v_addr.lat, v_addr.lng, v_addr.access_notes, nullif(btrim(p_contact_phone), ''));
  elsif nullif(btrim(p_contact_phone), '') is not null then
    insert into public.booking_private_details (booking_id, contact_phone) values (v_booking.id, btrim(p_contact_phone));
  end if;

  -- Offline payment records (Stripe records are created when checkout starts).
  if v_provider = 'manual_etransfer' and v_due > 0 then
    insert into public.payments (booking_id, client_id, stylist_id, provider, kind, amount_cents, currency, status, reference_code)
    values (v_booking.id, v_uid, v_sp.id, 'manual_etransfer',
            case when v_due < v_total then 'deposit'::public.payment_kind else 'full'::public.payment_kind end,
            v_due, v_booking.currency, 'requires_payment', 'HN-' || v_booking.reference);
  elsif v_provider = 'pay_in_person' and v_total > 0 then
    insert into public.payments (booking_id, client_id, stylist_id, provider, kind, amount_cents, currency, status)
    values (v_booking.id, v_uid, v_sp.id, 'pay_in_person', 'full', v_total, v_booking.currency, 'requires_payment');
  end if;

  if v_booking.promo_code_id is not null then
    update public.promo_codes set redemptions = redemptions + 1 where id = v_booking.promo_code_id;
  end if;

  perform public.ensure_conversation(v_uid, v_sp.id, v_booking.id);
  perform public.log_booking_status(v_booking.id, null, v_status, 'Booking created');

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'reference', v_booking.reference,
    'status', v_booking.status,
    'total_cents', v_booking.total_cents,
    'amount_due_now_cents', case when v_needs_online then v_due else 0 end,
    'requires_online_payment', v_needs_online,
    'payment_provider', v_provider,
    'hold_expires_at', v_booking.hold_expires_at
  );
end $$;

-- ---------------------------------------------------------------------------
-- transition_booking: the only way to move a booking forward.
--
--   requested   -> confirmed | declined           (stylist or admin)
--   confirmed   -> in_progress                    (stylist, from 1 hour before start)
--   confirmed   -> no_show                        (stylist, 15+ minutes after start)
--   in_progress -> completed                      (stylist or admin)
-- Cancellations use cancel_booking(); payment-driven changes are made by the
-- payment functions. src/lib/bookingStatus.js mirrors this table for the UI.
-- ---------------------------------------------------------------------------
create or replace function public.transition_booking(p_booking_id uuid, p_to public.booking_status,
                                                     p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_is_stylist boolean;
  v_is_admin boolean := public.is_admin();
  v_refund int := 0;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0404';
  end if;
  v_is_stylist := v_b.stylist_id = auth.uid() and public.is_active_user();
  if not (v_is_stylist or v_is_admin) then
    if v_b.client_id = auth.uid() then
      raise exception 'Only the stylist can update this booking. To cancel, use Cancel booking.' using errcode = '42501';
    end if;
    raise exception 'Booking not found.' using errcode = 'P0404';
  end if;

  if v_b.status = 'requested' and p_to in ('confirmed', 'declined') then
    null;
  elsif v_b.status = 'confirmed' and p_to = 'in_progress' then
    if now() < v_b.starts_at - interval '1 hour' and not v_is_admin then
      raise exception 'You can start the appointment from one hour before its start time.' using errcode = 'P0422';
    end if;
  elsif v_b.status = 'confirmed' and p_to = 'no_show' then
    if now() < v_b.starts_at + interval '15 minutes' and not v_is_admin then
      raise exception 'You can mark a no-show 15 minutes after the start time.' using errcode = 'P0422';
    end if;
  elsif v_b.status = 'in_progress' and p_to = 'completed' then
    null;
  else
    raise exception 'A booking cannot change from % to %.', v_b.status, p_to using errcode = 'P0422';
  end if;

  update public.bookings set
    status = p_to,
    confirmed_at = case when p_to = 'confirmed' then now() else confirmed_at end,
    started_at = case when p_to = 'in_progress' then now() else started_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    cancellation_reason = case when p_to = 'declined' then nullif(btrim(p_reason), '') else cancellation_reason end,
    cancelled_by = case when p_to = 'declined' then auth.uid() else cancelled_by end,
    cancelled_at = case when p_to in ('declined', 'no_show') then now() else cancelled_at end,
    -- A no-show forfeits what was paid online (the stylist is paid from it).
    cancellation_fee_cents = case when p_to = 'no_show' then public.booking_net_paid(v_b.id) else cancellation_fee_cents end
  where id = v_b.id;

  if p_to = 'declined' then
    v_refund := public.queue_refunds(v_b.id, public.booking_net_paid(v_b.id), 'Stylist declined the booking');
    update public.payments set status = 'canceled'
     where booking_id = v_b.id and status in ('requires_payment', 'processing', 'awaiting_verification');
  end if;

  perform public.log_booking_status(v_b.id, v_b.status, p_to, nullif(btrim(p_reason), ''));
  return jsonb_build_object('booking_id', v_b.id, 'status', p_to, 'refund_queued_cents', v_refund);
end $$;

-- ---------------------------------------------------------------------------
-- cancel_booking: client, stylist or admin cancellation with refund rules.
--   * Stylist or admin cancels: full refund of everything paid online.
--   * Client cancels an unconfirmed request: full refund.
--   * Client cancels a confirmed booking more than free_cancellation_hours
--     before the start: full refund. Later than that: the late cancellation
--     fee percentage of the amount paid is kept.
-- ---------------------------------------------------------------------------
create or replace function public.cancellation_preview(p_booking_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_paid int;
  v_fee int := 0;
  v_is_client boolean;
  v_late boolean;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or not (auth.uid() in (v_b.client_id, v_b.stylist_id) or public.is_admin()) then
    raise exception 'Booking not found.' using errcode = 'P0404';
  end if;
  v_paid := public.booking_net_paid(v_b.id);
  v_is_client := v_b.client_id = auth.uid();
  v_late := v_b.starts_at - now() < make_interval(hours => public.setting_int('free_cancellation_hours', 24));
  if v_is_client and v_b.status = 'confirmed' and v_late then
    v_fee := round(v_paid * public.setting_int('late_cancellation_fee_percent', 0) / 100.0)::int;
  end if;
  return jsonb_build_object(
    'can_cancel', v_b.status in ('pending_payment', 'requested', 'confirmed'),
    'amount_paid_cents', v_paid,
    'fee_cents', v_fee,
    'refund_cents', v_paid - v_fee,
    'is_late', v_late,
    'free_cancellation_hours', public.setting_int('free_cancellation_hours', 24),
    'late_cancellation_fee_percent', public.setting_int('late_cancellation_fee_percent', 0));
end $$;

create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_preview jsonb;
  v_to public.booking_status;
  v_refund int;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or not (auth.uid() in (v_b.client_id, v_b.stylist_id) or public.is_admin()) then
    raise exception 'Booking not found.' using errcode = 'P0404';
  end if;
  if v_b.status not in ('pending_payment', 'requested', 'confirmed') then
    raise exception 'This booking can no longer be cancelled (status: %).', v_b.status using errcode = 'P0422';
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then
    raise exception 'Reason must be 500 characters or fewer.' using errcode = 'P0422';
  end if;

  v_preview := public.cancellation_preview(p_booking_id);
  v_to := case when v_b.client_id = auth.uid() then 'cancelled_by_client'
               when v_b.stylist_id = auth.uid() then 'cancelled_by_stylist'
               else 'cancelled_by_admin' end;

  update public.bookings set
    status = v_to,
    cancellation_reason = nullif(btrim(p_reason), ''),
    cancelled_by = auth.uid(),
    cancelled_at = now(),
    hold_expires_at = null,
    cancellation_fee_cents = (v_preview ->> 'fee_cents')::int
  where id = v_b.id;

  v_refund := public.queue_refunds(v_b.id, (v_preview ->> 'refund_cents')::int,
                                   'Cancellation: ' || coalesce(nullif(btrim(p_reason), ''), 'no reason given'));
  update public.payments set status = 'canceled'
   where booking_id = v_b.id and status in ('requires_payment', 'processing', 'awaiting_verification');

  perform public.log_booking_status(v_b.id, v_b.status, v_to, nullif(btrim(p_reason), ''));
  return jsonb_build_object('booking_id', v_b.id, 'status', v_to,
    'refund_queued_cents', v_refund, 'fee_cents', (v_preview ->> 'fee_cents')::int);
end $$;

-- ---------------------------------------------------------------------------
-- reschedule_booking: move a requested/confirmed booking to a new free slot.
-- Clients may reschedule only outside the free-cancellation window. If the
-- stylist approves bookings manually, a client reschedule needs re-approval.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_booking(p_booking_id uuid, p_new_start timestamptz,
                                                     p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_sp public.stylist_profiles;
  v_option_ids uuid[];
  v_is_client boolean;
  v_new_status public.booking_status;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or not (auth.uid() in (v_b.client_id, v_b.stylist_id) or public.is_admin()) then
    raise exception 'Booking not found.' using errcode = 'P0404';
  end if;
  if v_b.status not in ('requested', 'confirmed') then
    raise exception 'Only requested or confirmed bookings can be rescheduled.' using errcode = 'P0422';
  end if;
  v_is_client := v_b.client_id = auth.uid();
  if v_is_client and v_b.starts_at - now() < make_interval(hours => public.setting_int('free_cancellation_hours', 24)) then
    raise exception 'It is too close to the appointment to reschedule online. Please message your stylist.'
      using errcode = 'P0422';
  end if;

  select * into v_sp from public.stylist_profiles where id = v_b.stylist_id;
  select coalesce(array_agg(ref_id), '{}') into v_option_ids
    from public.booking_line_items where booking_id = v_b.id and kind = 'option';

  if not exists (
    select 1 from public.get_available_slots(v_b.stylist_service_id,
      (p_new_start at time zone v_sp.timezone)::date, v_option_ids, v_b.id) s
    where s.slot_start = p_new_start
  ) then
    raise exception 'That time is not available. Please choose another time.' using errcode = 'P0409';
  end if;

  v_new_status := case when v_is_client and v_b.booking_mode = 'approval' then 'requested'::public.booking_status
                       else v_b.status end;
  begin
    update public.bookings set
      starts_at = p_new_start,
      ends_at = p_new_start + make_interval(mins => v_b.duration_minutes),
      blocked_until = p_new_start + make_interval(mins => v_b.duration_minutes + v_sp.buffer_minutes),
      status = v_new_status,
      reminder_sent_at = null
    where id = v_b.id;
  exception when exclusion_violation then
    raise exception 'That time was just booked by someone else. Please choose another time.' using errcode = 'P0409';
  end;

  perform public.log_booking_status(v_b.id, v_b.status, v_new_status,
    'Rescheduled from ' || to_char(v_b.starts_at at time zone v_sp.timezone, 'YYYY-MM-DD HH24:MI')
    || coalesce(' — ' || nullif(btrim(p_reason), ''), ''));
  return jsonb_build_object('booking_id', v_b.id, 'status', v_new_status, 'starts_at', p_new_start);
end $$;

-- Location shown to an authorised party once the booking allows it.
create or replace function public.get_booking_location(p_booking_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_salon public.salons;
  v_priv public.stylist_private;
  v_details public.booking_private_details;
  v_is_client boolean;
  v_revealed boolean;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or not (auth.uid() in (v_b.client_id, v_b.stylist_id) or public.is_admin()) then
    raise exception 'Booking not found.' using errcode = 'P0404';
  end if;
  v_is_client := v_b.client_id = auth.uid();
  v_revealed := v_b.status in ('confirmed', 'in_progress', 'completed') or public.is_admin();

  if v_b.location_type = 'salon' then
    select * into v_salon from public.salons where id = v_b.salon_id;
    return jsonb_build_object('type', 'salon', 'revealed', true, 'name', v_salon.name,
      'address', concat_ws(', ', v_salon.address_line, v_salon.city, v_salon.province, v_salon.postal_code));
  elsif v_b.location_type = 'stylist_studio' then
    select * into v_priv from public.stylist_private where stylist_id = v_b.stylist_id;
    return jsonb_build_object('type', 'stylist_studio',
      'revealed', v_revealed or not v_is_client,
      'address', case when v_revealed or not v_is_client then v_priv.studio_address end);
  else
    select * into v_details from public.booking_private_details where booking_id = v_b.id;
    return jsonb_build_object('type', 'client_location',
      'revealed', v_revealed or v_is_client,
      'address', case when v_revealed or v_is_client then v_details.address_text end,
      'access_notes', case when v_revealed or v_is_client then v_details.access_notes end,
      'contact_phone', case when v_revealed or v_is_client then v_details.contact_phone end);
  end if;
end $$;

-- >>>>> 20261012000005_payments.sql
-- ============================================================================
-- BeautyExpress — Migration 5: payments, refunds and payouts
--
-- Functions whose name starts with "svc_" may only be called by trusted server
-- code (Edge Functions using the service-role key). They are revoked from the
-- public API roles at the end of migration 7.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- prepare_payment: called by the client before Stripe checkout. Works out the
-- amount to charge from the booking (never from the browser) and creates or
-- re-uses a payment record.
-- ---------------------------------------------------------------------------
create or replace function public.prepare_payment(p_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_kind public.payment_kind;
  v_amount int;
  v_pay public.payments;
  v_collected int;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or v_b.client_id is distinct from auth.uid() then
    raise exception 'Booking not found.' using errcode = 'P0404';
  end if;
  if v_b.payment_provider <> 'stripe' then
    raise exception 'This booking is not paid online.' using errcode = 'P0422';
  end if;
  if not public.setting_bool('online_payments_enabled', false) then
    raise exception 'Online payments are not available right now.' using errcode = 'P0422';
  end if;

  select coalesce(sum(amount_cents), 0)::int into v_collected from public.payments
   where booking_id = v_b.id and provider = 'stripe' and status in ('succeeded', 'partially_refunded', 'refunded');

  if v_b.status = 'pending_payment' then
    if v_b.hold_expires_at < now() then
      raise exception 'The time slot hold has expired. Please book again.' using errcode = 'P0410';
    end if;
    v_amount := v_b.deposit_cents;
    v_kind := case when v_b.deposit_cents < v_b.total_cents then 'deposit' else 'full' end;
  elsif v_b.status in ('requested', 'confirmed', 'in_progress', 'completed') and v_collected > 0
        and v_collected < v_b.total_cents then
    v_amount := v_b.total_cents - v_collected;
    v_kind := 'balance';
  else
    raise exception 'There is nothing to pay for this booking right now.' using errcode = 'P0422';
  end if;

  if v_amount <= 0 then
    raise exception 'There is nothing to pay for this booking right now.' using errcode = 'P0422';
  end if;

  -- Re-use an unfinished payment for the same amount (prevents duplicate charges).
  select * into v_pay from public.payments
   where booking_id = v_b.id and provider = 'stripe' and kind = v_kind and amount_cents = v_amount
     and status in ('requires_payment', 'processing')
   order by created_at desc limit 1;

  if not found then
    insert into public.payments (booking_id, client_id, stylist_id, provider, kind, amount_cents, currency, status)
    values (v_b.id, v_b.client_id, v_b.stylist_id, 'stripe', v_kind, v_amount, v_b.currency, 'requires_payment')
    returning * into v_pay;
  end if;

  return jsonb_build_object(
    'payment_id', v_pay.id,
    'booking_id', v_b.id,
    'booking_reference', v_b.reference,
    'amount_cents', v_pay.amount_cents,
    'currency', v_pay.currency,
    'kind', v_pay.kind,
    'idempotency_key', v_pay.idempotency_key,
    'stripe_payment_intent_id', v_pay.stripe_payment_intent_id,
    'client_id', v_b.client_id);
end $$;

-- ---------------------------------------------------------------------------
-- Server-only functions used by Edge Functions / Stripe webhooks
-- ---------------------------------------------------------------------------
create or replace function public.svc_attach_payment_intent(p_payment_id uuid, p_intent_id text)
returns void
language sql security definer set search_path = '' as $$
  update public.payments set stripe_payment_intent_id = p_intent_id
  where id = p_payment_id and (stripe_payment_intent_id is null or stripe_payment_intent_id = p_intent_id)
$$;

-- A payment succeeded. Idempotent: a second call for the same intent does nothing.
create or replace function public.svc_record_payment_succeeded(p_intent_id text, p_charge_id text,
                                                               p_amount_cents int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
  v_b public.bookings;
  v_to public.booking_status;
begin
  select * into v_pay from public.payments where stripe_payment_intent_id = p_intent_id for update;
  if not found then
    return jsonb_build_object('action', 'unknown_payment');
  end if;
  if v_pay.status in ('succeeded', 'partially_refunded', 'refunded') then
    return jsonb_build_object('action', 'already_recorded', 'payment_id', v_pay.id);
  end if;
  if p_amount_cents <> v_pay.amount_cents then
    -- Should never happen because the server set the amount. Record and flag.
    update public.payments set failure_reason = 'Amount mismatch: Stripe reported ' || p_amount_cents
     where id = v_pay.id;
  end if;

  update public.payments set status = 'succeeded', stripe_charge_id = p_charge_id, failure_reason = null
   where id = v_pay.id;

  select * into v_b from public.bookings where id = v_pay.booking_id for update;
  update public.bookings set amount_paid_cents = amount_paid_cents + v_pay.amount_cents where id = v_b.id;

  if v_b.status = 'pending_payment' or (v_b.status = 'expired' and v_pay.kind <> 'balance') then
    v_to := case when v_b.booking_mode = 'instant' then 'confirmed'::public.booking_status
                 else 'requested'::public.booking_status end;
    begin
      update public.bookings set status = v_to, hold_expires_at = null,
        confirmed_at = case when v_to = 'confirmed' then now() else confirmed_at end
      where id = v_b.id;
      insert into public.booking_status_history (booking_id, from_status, to_status, reason)
      values (v_b.id, v_b.status, v_to, 'Payment received');
      return jsonb_build_object('action', 'booking_' || v_to, 'payment_id', v_pay.id, 'booking_id', v_b.id);
    exception when exclusion_violation then
      -- The hold expired and someone else took the slot: refund in full.
      perform public.queue_refunds(v_b.id, v_pay.amount_cents, 'Payment arrived after the time slot was released');
      return jsonb_build_object('action', 'refund_queued', 'payment_id', v_pay.id, 'booking_id', v_b.id);
    end;
  elsif v_b.status in ('cancelled_by_client', 'cancelled_by_stylist', 'cancelled_by_admin', 'declined', 'expired') then
    perform public.queue_refunds(v_b.id, v_pay.amount_cents, 'Payment received for a booking that is no longer active');
    return jsonb_build_object('action', 'refund_queued', 'payment_id', v_pay.id, 'booking_id', v_b.id);
  end if;

  return jsonb_build_object('action', 'recorded', 'payment_id', v_pay.id, 'booking_id', v_b.id);
end $$;

create or replace function public.svc_record_payment_failed(p_intent_id text, p_status public.payment_status,
                                                            p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
begin
  select * into v_pay from public.payments where stripe_payment_intent_id = p_intent_id for update;
  if not found then
    return jsonb_build_object('action', 'unknown_payment');
  end if;
  if v_pay.status in ('succeeded', 'partially_refunded', 'refunded') then
    return jsonb_build_object('action', 'ignored_already_succeeded');
  end if;
  if p_status not in ('failed', 'canceled', 'processing') then
    raise exception 'Invalid status for svc_record_payment_failed';
  end if;
  update public.payments set status = p_status, failure_reason = left(p_reason, 500) where id = v_pay.id;
  return jsonb_build_object('action', 'recorded', 'payment_id', v_pay.id, 'booking_id', v_pay.booking_id);
end $$;

-- Refunds waiting to be sent to Stripe (optionally for one booking).
create or replace function public.svc_pending_stripe_refunds(p_booking_id uuid default null, p_limit int default 25)
returns table (refund_id uuid, booking_id uuid, amount_cents int, payment_intent_id text, reason text)
language sql security definer set search_path = '' as $$
  select r.id, r.booking_id, r.amount_cents, p.stripe_payment_intent_id, r.reason
  from public.refunds r
  join public.payments p on p.id = r.payment_id
  where (r.status = 'pending'
         -- recover refunds stuck "processing" before Stripe ever answered
         or (r.status = 'processing' and r.stripe_refund_id is null and r.updated_at < now() - interval '10 minutes'))
    and p.provider = 'stripe' and p.stripe_payment_intent_id is not null
    and (p_booking_id is null or r.booking_id = p_booking_id)
  order by r.created_at
  limit p_limit
$$;

-- Apply the money effects of a refund exactly once.
create or replace function public.apply_refund_success(p_refund_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.refunds;
begin
  select * into v_r from public.refunds where id = p_refund_id for update;
  if v_r.status = 'succeeded' then
    return;
  end if;
  update public.refunds set status = 'succeeded', failure_reason = null where id = v_r.id;
  update public.payments set
    amount_refunded_cents = amount_refunded_cents + v_r.amount_cents,
    status = case when amount_refunded_cents + v_r.amount_cents >= amount_cents
                  then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end
  where id = v_r.payment_id;
  update public.bookings set amount_refunded_cents = amount_refunded_cents + v_r.amount_cents
   where id = v_r.booking_id;
end $$;

-- Record what Stripe said about a refund (by our refund id or Stripe's id).
create or replace function public.svc_record_refund(p_refund_id uuid, p_stripe_refund_id text,
                                                    p_status text, p_failure text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.refunds;
begin
  if p_refund_id is not null then
    select * into v_r from public.refunds where id = p_refund_id for update;
  else
    select * into v_r from public.refunds where stripe_refund_id = p_stripe_refund_id for update;
  end if;
  if not found then
    return jsonb_build_object('action', 'unknown_refund');
  end if;
  if v_r.status = 'succeeded' then
    return jsonb_build_object('action', 'already_succeeded', 'refund_id', v_r.id);
  end if;

  update public.refunds set stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id) where id = v_r.id;

  if p_status = 'succeeded' then
    perform public.apply_refund_success(v_r.id);
  elsif p_status in ('failed', 'canceled') then
    update public.refunds set status = p_status::public.refund_status, failure_reason = left(p_failure, 500)
     where id = v_r.id;
  else
    update public.refunds set status = 'processing' where id = v_r.id;
  end if;
  return jsonb_build_object('action', 'recorded', 'refund_id', v_r.id, 'status', p_status, 'booking_id', v_r.booking_id);
end $$;

-- ---------------------------------------------------------------------------
-- Stripe Connect accounts
-- ---------------------------------------------------------------------------
create or replace function public.svc_set_stripe_account(p_stylist_id uuid, p_account_id text)
returns void
language sql security definer set search_path = '' as $$
  update public.stylist_private set stripe_account_id = p_account_id
  where stylist_id = p_stylist_id and stripe_account_id is null
$$;

create or replace function public.svc_update_connect_account(p_account_id text, p_details_submitted boolean,
                                                             p_charges_enabled boolean, p_payouts_enabled boolean)
returns void
language sql security definer set search_path = '' as $$
  update public.stylist_private set
    stripe_details_submitted = p_details_submitted,
    stripe_charges_enabled = p_charges_enabled,
    stripe_payouts_enabled = p_payouts_enabled
  where stripe_account_id = p_account_id
$$;

-- ---------------------------------------------------------------------------
-- Payouts
--
-- payout = money collected online for the booking (net of refunds)
--          minus the platform's share (commission + booking fee + tax).
-- For late cancellations and no-shows the platform keeps commission_percent
-- of the retained amount and the stylist receives the rest.
-- ---------------------------------------------------------------------------
create or replace function public.compute_payout_amount(p_booking_id uuid)
returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_net int;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  select coalesce(sum(amount_cents - amount_refunded_cents), 0)::int into v_net
    from public.payments where booking_id = p_booking_id and provider = 'stripe'
     and status in ('succeeded', 'partially_refunded');
  if v_b.status = 'completed' then
    return greatest(v_net - v_b.platform_commission_cents - v_b.service_fee_cents - v_b.tax_cents, 0);
  elsif v_b.status in ('cancelled_by_client', 'no_show') then
    return greatest(v_net - round(v_net * public.setting_numeric('commission_percent', 0) / 100)::int, 0);
  end if;
  return 0;
end $$;

-- Creates payout records for bookings that are ready and returns everything
-- waiting to be transferred. Safe to run repeatedly (one payout per booking).
create or replace function public.svc_claim_payouts(p_limit int default 25)
returns table (payout_id uuid, booking_id uuid, stylist_id uuid, amount_cents int, currency text,
               stripe_account_id text, source_charge_id text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_hold interval := make_interval(hours => public.setting_int('payout_hold_hours', 24));
begin
  insert into public.payouts (booking_id, stylist_id, amount_cents, currency)
  select b.id, b.stylist_id, public.compute_payout_amount(b.id), b.currency
  from public.bookings b
  join public.stylist_private sp on sp.stylist_id = b.stylist_id
  where (
      (b.status = 'completed' and b.completed_at < now() - v_hold)
      or (b.status in ('cancelled_by_client', 'no_show') and b.cancellation_fee_cents > 0
          and b.cancelled_at < now() - v_hold)
    )
    and sp.stripe_account_id is not null and sp.stripe_payouts_enabled
    and not exists (select 1 from public.payouts p where p.booking_id = b.id)
    and not exists (select 1 from public.disputes d where d.booking_id = b.id and d.status in ('open', 'under_review'))
    and not exists (select 1 from public.refunds r where r.booking_id = b.id and r.status in ('pending', 'processing'))
    and public.compute_payout_amount(b.id) > 0
  limit p_limit
  on conflict (booking_id) do nothing;

  return query
  select p.id, p.booking_id, p.stylist_id, p.amount_cents, p.currency, sp.stripe_account_id,
         (select pay.stripe_charge_id from public.payments pay
           where pay.booking_id = p.booking_id and pay.provider = 'stripe'
             and pay.status in ('succeeded', 'partially_refunded') and pay.stripe_charge_id is not null
             and pay.amount_cents - pay.amount_refunded_cents >= p.amount_cents
           order by pay.created_at limit 1)
  from public.payouts p
  join public.stylist_private sp on sp.stylist_id = p.stylist_id
  where p.status = 'pending' and p.stripe_transfer_id is null and sp.stripe_account_id is not null
  order by p.created_at
  limit p_limit;
end $$;

create or replace function public.svc_record_payout(p_payout_id uuid, p_transfer_id text,
                                                    p_status public.payout_status, p_failure text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.payouts set
    stripe_transfer_id = coalesce(p_transfer_id, stripe_transfer_id),
    status = p_status,
    failure_reason = left(p_failure, 500)
  where id = p_payout_id
$$;

create or replace function public.svc_record_transfer_reversed(p_transfer_id text)
returns void
language sql security definer set search_path = '' as $$
  update public.payouts set status = 'reversed' where stripe_transfer_id = p_transfer_id
$$;

-- ---------------------------------------------------------------------------
-- Offline payments (Interac e-Transfer, pay in person)
-- ---------------------------------------------------------------------------

-- Client says "I've sent the e-Transfer". An admin must still verify it.
create or replace function public.mark_etransfer_sent(p_payment_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.payments set status = 'awaiting_verification'
   where id = p_payment_id and client_id = auth.uid() and provider = 'manual_etransfer'
     and status in ('requires_payment', 'failed');
  if not found then
    raise exception 'Payment not found or already submitted.' using errcode = 'P0404';
  end if;
end $$;

-- Stylist confirms they were paid directly at the appointment.
create or replace function public.stylist_mark_paid_in_person(p_payment_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found or v_pay.stylist_id <> auth.uid() or v_pay.provider <> 'pay_in_person'
     or v_pay.status <> 'requires_payment' then
    raise exception 'Payment not found.' using errcode = 'P0404';
  end if;
  if not exists (select 1 from public.bookings where id = v_pay.booking_id
                 and status in ('confirmed', 'in_progress', 'completed')) then
    raise exception 'The booking must be confirmed first.' using errcode = 'P0422';
  end if;
  update public.payments set status = 'succeeded', verified_by = auth.uid(), verified_at = now()
   where id = v_pay.id;
end $$;

-- >>>>> 20261012000006_social_admin_search.sql
-- ============================================================================
-- BeautyExpress — Migration 6: notifications, messaging, reviews, disputes,
-- administration and stylist search
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Public names for review authors (first name + last initial only)
-- This view intentionally runs with the owner's rights so it can expose just
-- these three safe columns without opening the private profiles table.
-- ---------------------------------------------------------------------------
create view public.public_profiles with (security_barrier = true) as
select p.id,
       case when sp.id is not null and sp.display_name <> '' then sp.display_name
            else split_part(btrim(p.full_name), ' ', 1)
                 || coalesce(' ' || left(nullif(split_part(btrim(p.full_name), ' ', 2), ''), 1) || '.', '')
       end as display_name,
       coalesce(sp.avatar_url, p.avatar_url) as avatar_url
from public.profiles p
left join public.stylist_profiles sp on sp.id = p.id and public.stylist_is_public(sp.id)
where p.status = 'active'
  and (sp.id is not null or exists (select 1 from public.reviews r where r.client_id = p.id and not r.is_hidden));

grant select on public.public_profiles to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create or replace function public.notify(p_user uuid, p_type text, p_title text, p_body text,
                                         p_link text default null, p_data jsonb default '{}'::jsonb,
                                         p_email boolean default true, p_sms boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_user;
  if not found then
    return;
  end if;
  insert into public.notifications (user_id, type, title, body, link, data, email_status, sms_status)
  values (p_user, p_type, p_title, coalesce(p_body, ''), p_link, coalesce(p_data, '{}'::jsonb),
          case when p_email and v_p.email_opt_in and v_p.email is not null then 'pending' else 'skipped' end,
          case when p_sms and v_p.sms_opt_in and v_p.phone is not null then 'pending' else 'skipped' end);
end $$;

create or replace function public.format_for_user(p_ts timestamptz, p_user uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select to_char(p_ts at time zone coalesce((select timezone from public.profiles where id = p_user), 'UTC'),
                 'Dy Mon FMDD at FMHH12:MI AM')
$$;

-- Booking status changes -> notifications for the right people.
create or replace function public.on_booking_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_title text;
  v_link text;
  v_rescheduled boolean := coalesce(new.reason, '') like 'Rescheduled from%';
begin
  select * into v_b from public.bookings where id = new.booking_id;
  select title into v_title from public.stylist_services where id = v_b.stylist_service_id;
  v_link := '/bookings/' || v_b.id;

  if v_rescheduled then
    perform public.notify(case when new.changed_by = v_b.client_id then v_b.stylist_id else v_b.client_id end,
      'booking_rescheduled', 'Appointment rescheduled',
      v_title || ' moved to ' || public.format_for_user(v_b.starts_at,
        case when new.changed_by = v_b.client_id then v_b.stylist_id else v_b.client_id end)
      || case when new.to_status = 'requested' then '. Waiting for stylist approval.' else '.' end,
      v_link, jsonb_build_object('booking_id', v_b.id), true, true);
    return new;
  end if;

  case new.to_status
    when 'requested' then
      perform public.notify(v_b.stylist_id, 'booking_requested', 'New booking request',
        v_title || ' on ' || public.format_for_user(v_b.starts_at, v_b.stylist_id) || '. Please accept or decline.',
        v_link, jsonb_build_object('booking_id', v_b.id), true, true);
      perform public.notify(v_b.client_id, 'booking_request_sent', 'Booking request sent',
        'Your request for ' || v_title || ' has been sent. We''ll let you know when the stylist responds.',
        v_link, jsonb_build_object('booking_id', v_b.id), true, false);
    when 'confirmed' then
      perform public.notify(v_b.client_id, 'booking_confirmed', 'Booking confirmed',
        v_title || ' is confirmed for ' || public.format_for_user(v_b.starts_at, v_b.client_id) || '.',
        v_link, jsonb_build_object('booking_id', v_b.id), true, true);
      if new.from_status is distinct from 'requested' then
        perform public.notify(v_b.stylist_id, 'booking_new', 'New booking',
          v_title || ' on ' || public.format_for_user(v_b.starts_at, v_b.stylist_id) || '.',
          v_link, jsonb_build_object('booking_id', v_b.id), true, true);
      end if;
    when 'declined' then
      perform public.notify(v_b.client_id, 'booking_declined', 'Booking request declined',
        'The stylist could not take your ' || v_title || ' request. Any payment will be refunded in full.',
        v_link, jsonb_build_object('booking_id', v_b.id), true, true);
    when 'cancelled_by_client' then
      perform public.notify(v_b.stylist_id, 'booking_cancelled', 'Booking cancelled by client',
        v_title || ' on ' || public.format_for_user(v_b.starts_at, v_b.stylist_id) || ' was cancelled.',
        v_link, jsonb_build_object('booking_id', v_b.id), true, true);
      perform public.notify(v_b.client_id, 'booking_cancelled', 'Booking cancelled',
        'Your ' || v_title || ' booking was cancelled.', v_link, jsonb_build_object('booking_id', v_b.id), true, false);
    when 'cancelled_by_stylist' then
      perform public.notify(v_b.client_id, 'booking_cancelled', 'Stylist cancelled your booking',
        v_title || ' on ' || public.format_for_user(v_b.starts_at, v_b.client_id)
        || ' was cancelled. Any payment will be refunded in full.',
        v_link, jsonb_build_object('booking_id', v_b.id), true, true);
    when 'cancelled_by_admin' then
      perform public.notify(v_b.client_id, 'booking_cancelled', 'Booking cancelled by BeautyExpress',
        v_title || ' was cancelled by our support team.', v_link, jsonb_build_object('booking_id', v_b.id), true, true);
      perform public.notify(v_b.stylist_id, 'booking_cancelled', 'Booking cancelled by BeautyExpress',
        v_title || ' was cancelled by our support team.', v_link, jsonb_build_object('booking_id', v_b.id), true, true);
    when 'expired' then
      perform public.notify(v_b.client_id, 'booking_expired', 'Booking hold expired',
        'Payment for ' || v_title || ' was not completed in time, so the slot was released.',
        v_link, jsonb_build_object('booking_id', v_b.id), false, false);
    when 'in_progress' then
      perform public.notify(v_b.client_id, 'booking_started', 'Your appointment has started',
        v_title || ' is in progress.', v_link, jsonb_build_object('booking_id', v_b.id), false, false);
    when 'completed' then
      perform public.notify(v_b.client_id, 'booking_completed', 'Appointment completed',
        'Thanks for booking ' || v_title || '. How did it go? Leave a review.',
        v_link, jsonb_build_object('booking_id', v_b.id), true, false);
    when 'no_show' then
      perform public.notify(v_b.client_id, 'booking_no_show', 'Marked as no-show',
        'Your stylist marked ' || v_title || ' as a no-show. If this is wrong, open a dispute from the booking page.',
        v_link, jsonb_build_object('booking_id', v_b.id), true, false);
    else
      null;
  end case;
  return new;
end $$;

create trigger on_booking_status_change after insert on public.booking_status_history
  for each row execute function public.on_booking_status_change();

-- Payment and refund updates -> notifications.
create or replace function public.on_payment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_amount text := to_char(new.amount_cents / 100.0, 'FM999999990.00') || ' ' || upper(new.currency);
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'succeeded' and new.provider <> 'pay_in_person' then
    perform public.notify(new.client_id, 'payment_succeeded', 'Payment received',
      'We received your payment of ' || v_amount || '.', '/client/payments',
      jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id), true, false);
    perform public.notify(new.stylist_id, 'payment_succeeded', 'Client payment received',
      'A payment of ' || v_amount || ' was received for a booking.', '/bookings/' || new.booking_id,
      jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id), false, false);
  elsif new.status = 'failed' then
    perform public.notify(new.client_id, 'payment_failed', 'Payment failed',
      'Your payment of ' || v_amount || ' did not go through. ' || coalesce(new.failure_reason, ''),
      '/bookings/' || new.booking_id, jsonb_build_object('payment_id', new.id), true, false);
  end if;
  return new;
end $$;
create trigger on_payment_change after update of status on public.payments
  for each row execute function public.on_payment_change();

create or replace function public.on_refund_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' then
    select client_id into v_client from public.bookings where id = new.booking_id;
    perform public.notify(v_client, 'refund_succeeded', 'Refund issued',
      'A refund of ' || to_char(new.amount_cents / 100.0, 'FM999999990.00') || ' was issued. '
      || 'Card refunds usually take 5–10 business days to appear.',
      '/client/payments', jsonb_build_object('refund_id', new.id), true, false);
  end if;
  return new;
end $$;
create trigger on_refund_change after update of status on public.refunds
  for each row execute function public.on_refund_change();

-- Reminders (24 h before) and review reminders. Run by the
-- send-notification Edge Function on a schedule.
create or replace function public.enqueue_due_reminders()
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_b record;
  v_count int := 0;
begin
  for v_b in
    update public.bookings set reminder_sent_at = now()
     where status = 'confirmed' and reminder_sent_at is null
       and starts_at between now() and now() + interval '24 hours'
    returning id, client_id, stylist_id, starts_at, stylist_service_id
  loop
    perform public.notify(v_b.client_id, 'booking_reminder', 'Appointment reminder',
      'Your appointment is on ' || public.format_for_user(v_b.starts_at, v_b.client_id) || '.',
      '/bookings/' || v_b.id, jsonb_build_object('booking_id', v_b.id), true, true);
    perform public.notify(v_b.stylist_id, 'booking_reminder', 'Upcoming appointment',
      'You have an appointment on ' || public.format_for_user(v_b.starts_at, v_b.stylist_id) || '.',
      '/bookings/' || v_b.id, jsonb_build_object('booking_id', v_b.id), true, false);
    v_count := v_count + 1;
  end loop;

  for v_b in
    update public.bookings b set review_reminder_sent_at = now()
     where b.status = 'completed' and b.review_reminder_sent_at is null
       and b.completed_at < now() - interval '2 hours'
       and b.completed_at > now() - make_interval(days => public.setting_int('review_window_days', 30))
       and not exists (select 1 from public.reviews r where r.booking_id = b.id)
    returning b.id, b.client_id
  loop
    perform public.notify(v_b.client_id, 'review_reminder', 'Rate your appointment',
      'Your review helps other clients find great stylists.', '/bookings/' || v_b.id,
      jsonb_build_object('booking_id', v_b.id), true, false);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_conversation(p_other_user uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Please sign in to send messages.' using errcode = '28000';
  end if;
  if p_other_user = v_uid then
    raise exception 'You cannot message yourself.' using errcode = 'P0422';
  end if;
  -- Clients can message any public stylist.
  if public.stylist_is_public(p_other_user) then
    return public.ensure_conversation(v_uid, p_other_user, null);
  end if;
  -- Stylists can message clients who have booked them.
  if exists (select 1 from public.bookings where stylist_id = v_uid and client_id = p_other_user) then
    return public.ensure_conversation(p_other_user, v_uid, null);
  end if;
  -- An existing conversation can always be reopened by its participants.
  return (select c.id from public.conversations c
          where (c.client_id = v_uid and c.stylist_id = p_other_user)
             or (c.stylist_id = v_uid and c.client_id = p_other_user));
end $$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql security definer set search_path = '' as $$
  update public.conversation_participants set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid()
$$;

create or replace function public.my_unread_counts()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'notifications', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null),
    'messages', (select count(*) from public.messages m
                 join public.conversation_participants cp
                   on cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
                 where m.sender_id <> auth.uid() and (cp.last_read_at is null or m.created_at > cp.last_read_at)))
$$;

create or replace function public.on_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_other uuid;
  v_recent boolean;
begin
  perform public.check_rate_limit('send_message', public.setting_int('max_messages_per_minute', 20), interval '1 minute');
  new.body := btrim(new.body);
  update public.conversations set last_message_at = now() where id = new.conversation_id;
  update public.conversation_participants set last_read_at = now()
   where conversation_id = new.conversation_id and user_id = new.sender_id;

  for v_other in
    select user_id from public.conversation_participants
    where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    -- Email at most one "new message" notice per hour per conversation.
    select exists (select 1 from public.notifications n where n.user_id = v_other and n.type = 'message'
                   and n.data ->> 'conversation_id' = new.conversation_id::text
                   and n.created_at > now() - interval '1 hour') into v_recent;
    perform public.notify(v_other, 'message', 'New message',
      left(new.body, 140), '/messages/' || new.conversation_id,
      jsonb_build_object('conversation_id', new.conversation_id), not v_recent, false);
  end loop;
  return new;
end $$;
create trigger on_message_insert before insert on public.messages
  for each row execute function public.on_message_insert();

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
create or replace function public.reply_to_review(p_review_id uuid, p_reply text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_reply, ''))) not between 1 and 1000 then
    raise exception 'Reply must be between 1 and 1000 characters.' using errcode = 'P0422';
  end if;
  update public.reviews set stylist_reply = btrim(p_reply), replied_at = now()
   where id = p_review_id and stylist_id = auth.uid();
  if not found then
    raise exception 'Review not found.' using errcode = 'P0404';
  end if;
end $$;

create or replace function public.on_review_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify(new.stylist_id, 'review_received', 'New review',
    'You received a ' || new.rating || '-star review.', '/stylist/dashboard',
    jsonb_build_object('review_id', new.id), true, false);
  return new;
end $$;
create trigger on_review_insert after insert on public.reviews
  for each row execute function public.on_review_insert();

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------
create or replace function public.open_dispute(p_booking_id uuid, p_reason text, p_description text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
  v_id uuid;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or auth.uid() not in (v_b.client_id, v_b.stylist_id) then
    raise exception 'Booking not found.' using errcode = 'P0404';
  end if;
  if v_b.status in ('pending_payment', 'expired') then
    raise exception 'A dispute cannot be opened for this booking.' using errcode = 'P0422';
  end if;
  if v_b.starts_at < now() - interval '30 days' then
    raise exception 'Disputes must be opened within 30 days of the appointment.' using errcode = 'P0422';
  end if;
  perform public.check_rate_limit('open_dispute', 5, interval '1 day');
  begin
    insert into public.disputes (booking_id, opened_by, reason, description)
    values (v_b.id, auth.uid(), btrim(p_reason), btrim(p_description))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already an open dispute for this booking.' using errcode = 'P0409';
  end;
  perform public.notify(case when auth.uid() = v_b.client_id then v_b.stylist_id else v_b.client_id end,
    'dispute_opened', 'A dispute was opened', 'A dispute was opened about a booking. Our team will review it.',
    '/bookings/' || v_b.id, jsonb_build_object('dispute_id', v_id), true, false);
  return v_id;
end $$;

create or replace function public.respond_to_dispute(p_dispute_id uuid, p_response text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_response, ''))) not between 1 and 4000 then
    raise exception 'Response must be between 1 and 4000 characters.' using errcode = 'P0422';
  end if;
  update public.disputes d set stylist_response = btrim(p_response)
   where d.id = p_dispute_id and d.status in ('open', 'under_review') and d.opened_by <> auth.uid()
     and public.is_booking_party(d.booking_id);
  if not found then
    raise exception 'Dispute not found.' using errcode = 'P0404';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Administration (every function checks is_admin() and writes the audit log)
-- ---------------------------------------------------------------------------
create or replace function public.assert_admin()
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
end $$;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status public.account_status,
                                                        p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own account status.' using errcode = 'P0422';
  end if;
  update public.profiles set status = p_status, status_reason = nullif(btrim(p_reason), '') where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'P0404';
  end if;
  perform public.write_audit('admin_set_user_status', 'profiles', p_user_id::text, null,
    jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role, p_grant boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if p_user_id = auth.uid() and p_role = 'admin' and not p_grant then
    raise exception 'You cannot remove your own administrator role.' using errcode = 'P0422';
  end if;
  if p_grant then
    insert into public.user_roles (user_id, role, granted_by) values (p_user_id, p_role, auth.uid())
    on conflict do nothing;
    if p_role = 'stylist' then
      insert into public.stylist_profiles (id) values (p_user_id) on conflict do nothing;
      insert into public.stylist_private (stylist_id) values (p_user_id) on conflict do nothing;
    end if;
  else
    delete from public.user_roles where user_id = p_user_id and role = p_role;
  end if;
  perform public.write_audit(case when p_grant then 'admin_grant_role' else 'admin_revoke_role' end,
    'user_roles', p_user_id::text, null, jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_update_stylist(p_stylist_id uuid,
  p_verification public.verification_status default null,
  p_approval public.approval_status default null,
  p_featured boolean default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
begin
  perform public.assert_admin();
  select to_jsonb(s) into v_old from public.stylist_profiles s where id = p_stylist_id;
  if v_old is null then
    raise exception 'Stylist not found.' using errcode = 'P0404';
  end if;
  update public.stylist_profiles set
    verification_status = coalesce(p_verification, verification_status),
    approval_status = coalesce(p_approval, approval_status),
    is_featured = coalesce(p_featured, is_featured)
  where id = p_stylist_id;
  perform public.write_audit('admin_update_stylist', 'stylist_profiles', p_stylist_id::text,
    jsonb_build_object('verification_status', v_old ->> 'verification_status',
                       'approval_status', v_old ->> 'approval_status', 'is_featured', v_old ->> 'is_featured'),
    jsonb_build_object('verification_status', p_verification, 'approval_status', p_approval, 'is_featured', p_featured));
  if p_approval is not null and p_approval::text is distinct from v_old ->> 'approval_status' then
    perform public.notify(p_stylist_id, 'stylist_approval', 'Profile review update',
      case when p_approval = 'approved' then 'Your stylist profile has been approved and is now visible.'
           else 'Your stylist profile status is now: ' || p_approval || '.' end,
      '/stylist/dashboard', '{}'::jsonb, true, false);
  end if;
end $$;

-- Validated settings update. Unknown keys and out-of-range values are rejected.
create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_num numeric;
begin
  perform public.assert_admin();
  if not exists (select 1 from public.platform_settings where key = p_key) then
    raise exception 'Unknown setting %', p_key using errcode = 'P0422';
  end if;
  if p_key in ('commission_percent', 'service_fee_percent', 'tax_percent', 'late_cancellation_fee_percent') then
    v_num := (p_value #>> '{}')::numeric;
    if v_num is null or v_num < 0 or v_num > 100 then
      raise exception '% must be between 0 and 100.', p_key using errcode = 'P0422';
    end if;
  elsif p_key in ('free_cancellation_hours', 'payment_hold_minutes', 'payout_hold_hours',
                  'review_window_days', 'max_bookings_per_hour', 'max_messages_per_minute') then
    v_num := (p_value #>> '{}')::numeric;
    if v_num is null or v_num <> trunc(v_num) or v_num < 0 or v_num > 10000 then
      raise exception '% must be a whole number between 0 and 10000.', p_key using errcode = 'P0422';
    end if;
  elsif p_key in ('require_stylist_approval', 'online_payments_enabled', 'manual_etransfer_enabled',
                  'pay_in_person_enabled') then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception '% must be true or false.', p_key using errcode = 'P0422';
    end if;
  elsif p_key = 'currency' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^[a-z]{3}$' then
      raise exception 'Currency must be a three-letter lowercase code such as "cad".' using errcode = 'P0422';
    end if;
  elsif jsonb_typeof(p_value) <> 'string' then
    raise exception '% must be text.', p_key using errcode = 'P0422';
  end if;
  update public.platform_settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
end $$;

create or replace function public.admin_update_dispute(p_dispute_id uuid, p_status public.dispute_status,
                                                       p_notes text default null, p_refund_cents int default 0)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.disputes;
  v_b public.bookings;
  v_queued int := 0;
begin
  perform public.assert_admin();
  select * into v_d from public.disputes where id = p_dispute_id for update;
  if not found then
    raise exception 'Dispute not found.' using errcode = 'P0404';
  end if;
  select * into v_b from public.bookings where id = v_d.booking_id;
  if p_status = 'resolved_refund' then
    if coalesce(p_refund_cents, 0) <= 0 then
      raise exception 'Enter a refund amount greater than zero.' using errcode = 'P0422';
    end if;
    if p_refund_cents > public.booking_net_paid(v_b.id) then
      raise exception 'The refund cannot be more than the amount paid online.' using errcode = 'P0422';
    end if;
    if exists (select 1 from public.payouts where booking_id = v_b.id and status = 'transferred') then
      raise exception 'The stylist has already been paid for this booking. Reverse the transfer in Stripe first.'
        using errcode = 'P0422';
    end if;
    v_queued := public.queue_refunds(v_b.id, p_refund_cents, 'Dispute resolution');
  end if;
  update public.disputes set status = p_status, resolution_notes = nullif(btrim(p_notes), ''),
    refund_amount_cents = case when p_status = 'resolved_refund' then p_refund_cents else refund_amount_cents end,
    resolved_by = case when p_status in ('resolved_refund', 'resolved_no_refund', 'closed') then auth.uid() end
  where id = v_d.id;
  perform public.notify(v_b.client_id, 'dispute_updated', 'Dispute update',
    'Your dispute status is now: ' || replace(p_status::text, '_', ' ') || '.', '/bookings/' || v_b.id,
    jsonb_build_object('dispute_id', v_d.id), true, false);
  perform public.notify(v_b.stylist_id, 'dispute_updated', 'Dispute update',
    'A dispute about your booking is now: ' || replace(p_status::text, '_', ' ') || '.', '/bookings/' || v_b.id,
    jsonb_build_object('dispute_id', v_d.id), true, false);
  return jsonb_build_object('dispute_id', v_d.id, 'status', p_status, 'refund_queued_cents', v_queued);
end $$;

create or replace function public.admin_respond_report(p_report_id uuid, p_status public.report_status,
                                                       p_response text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.reports;
begin
  perform public.assert_admin();
  update public.reports set status = p_status, admin_response = coalesce(nullif(btrim(p_response), ''), admin_response),
    resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() end
  where id = p_report_id returning * into v_r;
  if not found then
    raise exception 'Report not found.' using errcode = 'P0404';
  end if;
  perform public.write_audit('admin_respond_report', 'reports', p_report_id::text, null,
    jsonb_build_object('status', p_status, 'response', p_response));
  perform public.notify(v_r.reporter_id, 'report_updated', 'Support request update',
    coalesce(nullif(btrim(p_response), ''), 'Status: ' || p_status), '/client/support',
    jsonb_build_object('report_id', v_r.id), true, false);
end $$;

create or replace function public.admin_verify_manual_payment(p_payment_id uuid, p_approved boolean,
                                                              p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
begin
  perform public.assert_admin();
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found or v_pay.provider <> 'manual_etransfer'
     or v_pay.status not in ('awaiting_verification', 'requires_payment') then
    raise exception 'This payment is not waiting for verification.' using errcode = 'P0422';
  end if;
  if p_approved then
    update public.payments set status = 'succeeded', verified_by = auth.uid(), verified_at = now(),
      failure_reason = null where id = v_pay.id;
    update public.bookings set amount_paid_cents = amount_paid_cents + v_pay.amount_cents where id = v_pay.booking_id;
  else
    update public.payments set status = 'failed', failure_reason = coalesce(nullif(btrim(p_note), ''),
      'The e-Transfer could not be verified.') where id = v_pay.id;
  end if;
  perform public.write_audit(case when p_approved then 'admin_verify_payment' else 'admin_reject_payment' end,
    'payments', v_pay.id::text, null, jsonb_build_object('note', p_note));
end $$;

-- For refunds that are not processed by Stripe (e.g. e-Transfer refunds sent by hand).
create or replace function public.admin_mark_refund_completed(p_refund_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if not exists (select 1 from public.refunds r join public.payments p on p.id = r.payment_id
                 where r.id = p_refund_id and r.status in ('pending', 'failed') and p.provider = 'manual_etransfer') then
    raise exception 'Only pending manual refunds can be marked as completed here.' using errcode = 'P0422';
  end if;
  perform public.apply_refund_success(p_refund_id);
  perform public.write_audit('admin_mark_refund_completed', 'refunds', p_refund_id::text, null,
    jsonb_build_object('note', p_note));
end $$;

create or replace function public.admin_retry_failed_refund(p_refund_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  update public.refunds set status = 'pending', failure_reason = null where id = p_refund_id and status = 'failed';
  if not found then
    raise exception 'Refund is not in a failed state.' using errcode = 'P0422';
  end if;
end $$;

create or replace function public.admin_retry_payout(p_payout_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  update public.payouts set status = 'pending', failure_reason = null
   where id = p_payout_id and status = 'failed' and stripe_transfer_id is null;
  if not found then
    raise exception 'Only failed payouts without a transfer can be retried.' using errcode = 'P0422';
  end if;
end $$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_suspended', (select count(*) from public.profiles where status = 'suspended'),
    'stylists_total', (select count(*) from public.user_roles where role = 'stylist'),
    'stylists_listed', (select count(*) from public.stylist_profiles s where public.stylist_is_public(s.id)),
    'stylists_pending_approval', (select count(*) from public.stylist_profiles
                                  where onboarding_completed and approval_status = 'pending'),
    'bookings_total', (select count(*) from public.bookings),
    'bookings_last_30_days', (select count(*) from public.bookings where created_at > now() - interval '30 days'),
    'bookings_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                           from (select status, count(*) n from public.bookings group by status) s),
    'gross_collected_cents', (select coalesce(sum(amount_cents), 0) from public.payments
                              where status in ('succeeded', 'partially_refunded', 'refunded')
                                and provider in ('stripe', 'manual_etransfer')),
    'refunded_cents', (select coalesce(sum(amount_cents), 0) from public.refunds where status = 'succeeded'),
    'platform_revenue_completed_cents', (select coalesce(sum(platform_commission_cents + service_fee_cents), 0)
                                         from public.bookings where status = 'completed'),
    'payouts_transferred_cents', (select coalesce(sum(amount_cents), 0) from public.payouts where status = 'transferred'),
    'open_disputes', (select count(*) from public.disputes where status in ('open', 'under_review')),
    'open_reports', (select count(*) from public.reports where status in ('open', 'investigating')),
    'payments_awaiting_verification', (select count(*) from public.payments where status = 'awaiting_verification'),
    'refunds_pending_or_failed', (select count(*) from public.refunds where status in ('pending', 'failed')),
    'payouts_failed', (select count(*) from public.payouts where status = 'failed')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Stylist search
-- ---------------------------------------------------------------------------
create or replace function public.search_stylists(
  p_query text default null,
  p_category_slug text default null,
  p_service_slug text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km int default 50,
  p_min_price_cents int default null,
  p_max_price_cents int default null,
  p_min_rating numeric default null,
  p_location_mode text default 'any',      -- any | mobile | studio | salon
  p_stylist_type public.stylist_type default null,
  p_available_on date default null,
  p_featured_only boolean default false,
  p_sort text default 'recommended',       -- recommended | distance | price_low | price_high | rating
  p_limit int default 24,
  p_offset int default 0
) returns table (
  stylist_id uuid, display_name text, business_name text, headline text, avatar_url text,
  cover_image_url text, city text, province text, stylist_type public.stylist_type, salon_name text,
  offers_mobile boolean, offers_studio boolean, offers_salon boolean, rating_avg numeric, rating_count int,
  is_featured boolean, is_verified boolean, distance_km numeric, from_price_cents int,
  matching_services text[], total_count bigint
)
language sql stable security definer set search_path = '' as $$
  with params as (
    select nullif(btrim(coalesce(p_query, '')), '') as q,
           coalesce(nullif(p_location_mode, ''), 'any') as mode,
           least(greatest(coalesce(p_limit, 24), 1), 100) as lim,
           greatest(coalesce(p_offset, 0), 0) as off
  ),
  matches as (
    select ss.stylist_id, ss.base_price_cents, ss.title, s.name as service_name
    from public.stylist_services ss
    join public.services s on s.id = ss.service_id and s.is_active
    join public.service_categories c on c.id = s.category_id and c.is_active
    cross join params pr
    where ss.is_active
      and (p_category_slug is null or c.slug = p_category_slug)
      and (p_service_slug is null or s.slug = p_service_slug)
      and (p_min_price_cents is null or ss.base_price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or ss.base_price_cents <= p_max_price_cents)
      and (pr.mode = 'any'
           or (pr.mode = 'mobile' and 'client_location' = any(ss.location_types))
           or (pr.mode = 'studio' and 'stylist_studio' = any(ss.location_types))
           or (pr.mode = 'salon' and 'salon' = any(ss.location_types)))
  ),
  grouped as (
    select stylist_id, min(base_price_cents)::int as from_price,
           array_agg(distinct title) as titles,
           string_agg(title || ' ' || service_name, ' ') as search_text
    from matches group by stylist_id
  ),
  base as (
    select sp.*, sal.name as salon_name, g.from_price, g.titles,
           round(public.distance_km(sp.approx_lat, sp.approx_lng, p_lat, p_lng)::numeric, 1) as dist
    from public.stylist_profiles sp
    join grouped g on g.stylist_id = sp.id
    left join public.salons sal on sal.id = sp.salon_id
    cross join params pr
    where public.stylist_is_public(sp.id) and sp.is_accepting_bookings
      and (p_stylist_type is null or sp.stylist_type = p_stylist_type)
      and (p_min_rating is null or sp.rating_avg >= p_min_rating)
      and (not coalesce(p_featured_only, false) or sp.is_featured)
      and (pr.mode <> 'mobile' or sp.offers_mobile)
      and (pr.mode <> 'studio' or sp.offers_studio)
      and (pr.mode <> 'salon' or sp.offers_salon)
      and (pr.q is null
           or sp.display_name ilike '%' || pr.q || '%' or sp.business_name ilike '%' || pr.q || '%'
           or sp.headline ilike '%' || pr.q || '%' or sp.city ilike '%' || pr.q || '%'
           or coalesce(sal.name, '') ilike '%' || pr.q || '%' or g.search_text ilike '%' || pr.q || '%')
  ),
  filtered as (
    select b.* from base b cross join params pr
    where (p_lat is null or p_lng is null
           or (pr.mode = 'mobile' and (b.dist <= b.max_travel_km or exists (
                 select 1 from public.service_areas a where a.stylist_id = b.id
                   and public.distance_km(a.lat, a.lng, p_lat, p_lng) <= a.radius_km)))
           or (pr.mode <> 'mobile' and (b.dist <= coalesce(p_radius_km, 50)
                                        or (b.offers_mobile and b.dist <= b.max_travel_km))))
      and (p_available_on is null or (
            exists (select 1 from public.stylist_availability a
                    where a.stylist_id = b.id and a.weekday = extract(dow from p_available_on))
            and not exists (select 1 from public.availability_exceptions e
                            where e.stylist_id = b.id
                              and e.starts_at <= (p_available_on::timestamp at time zone b.timezone)
                              and e.ends_at >= ((p_available_on + 1)::timestamp at time zone b.timezone))))
  )
  select f.id, f.display_name, f.business_name, f.headline, f.avatar_url,
         (select image_url from public.stylist_portfolio pf where pf.stylist_id = f.id
           order by pf.sort_order, pf.created_at limit 1),
         f.city, f.province, f.stylist_type, f.salon_name, f.offers_mobile, f.offers_studio, f.offers_salon,
         f.rating_avg, f.rating_count, f.is_featured, f.verification_status = 'verified',
         f.dist, f.from_price, f.titles, count(*) over ()
  from filtered f
  order by
    case when p_sort = 'distance' then f.dist end asc nulls last,
    case when p_sort = 'price_low' then f.from_price end asc,
    case when p_sort = 'price_high' then f.from_price end desc,
    case when p_sort = 'rating' then f.rating_avg end desc,
    f.is_featured desc, f.rating_avg desc, f.rating_count desc, f.id
  limit (select lim from params) offset (select off from params)
$$;

-- ---------------------------------------------------------------------------
-- A signed-in client can add the stylist role to their own account.
-- (They still have to complete their profile before appearing in search.)
-- ---------------------------------------------------------------------------
create or replace function public.become_stylist()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Please sign in with an active account.' using errcode = '28000';
  end if;
  insert into public.user_roles (user_id, role) values (v_uid, 'stylist') on conflict do nothing;
  insert into public.stylist_profiles (id, display_name)
  select v_uid, p.full_name from public.profiles p where p.id = v_uid
  on conflict do nothing;
  insert into public.stylist_private (stylist_id) values (v_uid) on conflict do nothing;
end $$;

-- Rate limit support requests / reports (prevents spam).
create or replace function public.on_report_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.check_rate_limit('create_report', 10, interval '1 hour');
  return new;
end $$;
create trigger on_report_insert before insert on public.reports
  for each row execute function public.on_report_insert();

-- >>>>> 20261012000007_storage_realtime_permissions.sql
-- ============================================================================
-- BeautyExpress — Migration 7: storage buckets, realtime and function permissions
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage buckets (only on a real Supabase project, where the storage schema exists)
-- Files must be uploaded into a folder named after the user's id:
--   avatars/<user-id>/photo.jpg   portfolio/<user-id>/braids-1.webp
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
      ('portfolio', 'portfolio', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy "beautyexpress images: public read" on storage.objects
      for select to anon, authenticated using (bucket_id in ('avatars', 'portfolio'))$p$;
    execute $p$create policy "beautyexpress images: owner upload" on storage.objects
      for insert to authenticated with check (
        bucket_id in ('avatars', 'portfolio')
        and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "beautyexpress images: owner update" on storage.objects
      for update to authenticated using (
        bucket_id in ('avatars', 'portfolio') and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "beautyexpress images: owner delete" on storage.objects
      for delete to authenticated using (
        bucket_id in ('avatars', 'portfolio') and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime: live messages, notifications and booking status updates.
-- Realtime respects RLS, so users only receive rows they may read.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'notifications', 'bookings'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Function permissions
--
-- PostgreSQL lets everyone execute new functions by default. We remove that
-- and grant each function only to the roles that need it.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

-- Helpers that RLS policies and triggers call while running as the user.
grant execute on function
  public.has_role(public.app_role), public.is_admin(), public.is_active_user(), public.is_privileged(),
  public.stylist_is_public(uuid), public.is_booking_party(uuid), public.is_conversation_participant(uuid),
  public.shares_relationship_with(uuid), public.can_review_booking(uuid), public.can_edit_review(uuid),
  public.distance_km(double precision, double precision, double precision, double precision)
to anon, authenticated;

-- Public (signed-out visitors can browse and see prices).
grant execute on function
  public.quote_booking(uuid, uuid[], public.location_type, double precision, double precision, text),
  public.get_available_slots(uuid, date, uuid[], uuid),
  public.search_stylists(text, text, text, double precision, double precision, int, int, int, numeric,
                         text, public.stylist_type, date, boolean, text, int, int)
to anon, authenticated;

-- Signed-in users. Each function checks who is calling.
grant execute on function
  public.create_booking(uuid, uuid[], timestamptz, public.location_type, uuid, text, text,
                        public.payment_provider, text),
  public.transition_booking(uuid, public.booking_status, text),
  public.cancellation_preview(uuid),
  public.cancel_booking(uuid, text),
  public.reschedule_booking(uuid, timestamptz, text),
  public.get_booking_location(uuid),
  public.prepare_payment(uuid),
  public.mark_etransfer_sent(uuid),
  public.stylist_mark_paid_in_person(uuid),
  public.get_or_create_conversation(uuid),
  public.mark_conversation_read(uuid),
  public.my_unread_counts(),
  public.become_stylist(),
  public.reply_to_review(uuid, text),
  public.open_dispute(uuid, text, text),
  public.respond_to_dispute(uuid, text),
  public.admin_set_user_status(uuid, public.account_status, text),
  public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_update_stylist(uuid, public.verification_status, public.approval_status, boolean),
  public.admin_update_setting(text, jsonb),
  public.admin_update_dispute(uuid, public.dispute_status, text, int),
  public.admin_respond_report(uuid, public.report_status, text),
  public.admin_verify_manual_payment(uuid, boolean, text),
  public.admin_mark_refund_completed(uuid, text),
  public.admin_retry_failed_refund(uuid),
  public.admin_retry_payout(uuid),
  public.admin_stats()
to authenticated;

-- Trusted server code only (Edge Functions with the service-role key).
grant execute on all functions in schema public to service_role;

-- Trigger functions need no grants: PostgreSQL runs them automatically.
