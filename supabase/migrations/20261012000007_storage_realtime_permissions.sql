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
