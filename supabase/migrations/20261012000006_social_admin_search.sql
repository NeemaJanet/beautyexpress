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
