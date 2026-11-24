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
