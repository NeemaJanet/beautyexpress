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
