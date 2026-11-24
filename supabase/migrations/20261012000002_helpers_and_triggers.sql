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
