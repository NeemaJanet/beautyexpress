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
