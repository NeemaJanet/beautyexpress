-- ============================================================================
-- BeautyExpress — LOCAL DEVELOPMENT SEED DATA
--
-- !!! Every person, business, address, review and booking below is FICTIONAL.
-- !!! All accounts use @example.com addresses and the password  Password123!
-- !!! Never load this file into your production database.
--
-- `supabase db reset` loads this file automatically after the migrations.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Demo accounts (created in auth.users; the signup trigger creates profiles)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.seed_user(p_id uuid, p_email text, p_name text, p_role text)
returns void language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', p_name, 'role', p_role), now(), now(), '', '', '', '')
  on conflict (id) do nothing;

  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id::text, p_id,
          jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
          'email', now(), now(), now())
  on conflict do nothing;
end $$;

select pg_temp.seed_user('a0000000-0000-4000-8000-000000000001', 'admin@example.com',    'Demo Admin (fictional)', 'client');
select pg_temp.seed_user('c0000000-0000-4000-8000-000000000001', 'client1@example.com',  'Jordan Client (fictional)', 'client');
select pg_temp.seed_user('c0000000-0000-4000-8000-000000000002', 'client2@example.com',  'Riley Sample (fictional)', 'client');
select pg_temp.seed_user('50000000-0000-4000-8000-000000000001', 'stylist1@example.com', 'Amara Demo', 'stylist');
select pg_temp.seed_user('50000000-0000-4000-8000-000000000002', 'stylist2@example.com', 'Keisha Example', 'stylist');
select pg_temp.seed_user('50000000-0000-4000-8000-000000000003', 'stylist3@example.com', 'Nia Placeholder', 'stylist');
select pg_temp.seed_user('50000000-0000-4000-8000-000000000004', 'stylist4@example.com', 'Zuri Testcase', 'stylist');
select pg_temp.seed_user('50000000-0000-4000-8000-000000000005', 'stylist5@example.com', 'Imani Mockup', 'stylist');
select pg_temp.seed_user('50000000-0000-4000-8000-000000000006', 'stylist6@example.com', 'Dana Fixture', 'stylist');

-- Supabase's login service cannot read accounts whose token columns are NULL
-- ("Database error querying schema"). Set every token column that exists to ''.
do $$
declare c text;
begin
  foreach c in array array['confirmation_token','recovery_token','email_change','email_change_token_new',
                           'email_change_token_current','phone_change','phone_change_token','reauthentication_token'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'auth' and table_name = 'users' and column_name = c) then
      execute format('update auth.users set %I = coalesce(%I, %L) where email like %L', c, c, '', '%@example.com');
    end if;
  end loop;
end $$;

-- The demo admin. In production you promote a real account with the SQL in DEPLOYMENT.md.
insert into public.user_roles (user_id, role) values ('a0000000-0000-4000-8000-000000000001', 'admin')
on conflict do nothing;

update public.profiles set onboarding_completed = true, phone = '+1 506 555 0100', preferred_city = 'Fredericton',
  preferred_lat = 45.9636, preferred_lng = -66.6431
where id in ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
             'c0000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
insert into public.service_categories (id, slug, name, description, image_url, sort_order) values
  ('ca000000-0000-4000-8000-000000000001', 'braids', 'Braids', 'Box braids, knotless braids, cornrows and more.', '/images/seed/braids.svg', 1),
  ('ca000000-0000-4000-8000-000000000002', 'twists', 'Twists', 'Senegalese, passion and two-strand twists.', '/images/seed/twists.svg', 2),
  ('ca000000-0000-4000-8000-000000000003', 'locs', 'Locs', 'Starter locs, retwists and faux locs.', '/images/seed/locs.svg', 3),
  ('ca000000-0000-4000-8000-000000000004', 'wigs-extensions', 'Wigs & Extensions', 'Wig installs, sew-ins and quick weaves.', '/images/seed/wigs.svg', 4),
  ('ca000000-0000-4000-8000-000000000005', 'natural-hair', 'Natural Hair', 'Silk presses, wash-and-go and natural styling.', '/images/seed/natural.svg', 5),
  ('ca000000-0000-4000-8000-000000000006', 'cuts-colour', 'Cuts & Colour', 'Trims, cuts and colour services.', '/images/seed/cuts.svg', 6)
on conflict (id) do nothing;

insert into public.services (id, category_id, slug, name, description, typical_duration_minutes) values
  ('5e000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'knotless-braids', 'Knotless braids', 'Braids that start with your natural hair for a flat, light finish.', 300),
  ('5e000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'box-braids', 'Box braids', 'Classic individual braids with square parts.', 300),
  ('5e000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000001', 'cornrows', 'Cornrows', 'Braids close to the scalp in straight or curved lines.', 120),
  ('5e000000-0000-4000-8000-000000000004', 'ca000000-0000-4000-8000-000000000002', 'senegalese-twists', 'Senegalese twists', 'Sleek rope twists with extensions.', 300),
  ('5e000000-0000-4000-8000-000000000005', 'ca000000-0000-4000-8000-000000000002', 'two-strand-twists', 'Two-strand twists', 'Twists on natural hair, no extensions.', 150),
  ('5e000000-0000-4000-8000-000000000006', 'ca000000-0000-4000-8000-000000000003', 'loc-retwist', 'Loc retwist', 'Maintenance retwist for existing locs.', 120),
  ('5e000000-0000-4000-8000-000000000007', 'ca000000-0000-4000-8000-000000000003', 'starter-locs', 'Starter locs', 'Begin your loc journey with comb coils or two-strand twists.', 180),
  ('5e000000-0000-4000-8000-000000000008', 'ca000000-0000-4000-8000-000000000003', 'faux-locs', 'Faux locs', 'Temporary locs using extensions.', 300),
  ('5e000000-0000-4000-8000-000000000009', 'ca000000-0000-4000-8000-000000000004', 'wig-installation', 'Wig installation', 'Lace front or closure wig install and styling.', 120),
  ('5e000000-0000-4000-8000-000000000010', 'ca000000-0000-4000-8000-000000000004', 'sew-in', 'Sew-in weave', 'Tracks sewn onto a braided base.', 180),
  ('5e000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000005', 'silk-press', 'Silk press', 'Wash, deep condition and a smooth flat-iron finish.', 120),
  ('5e000000-0000-4000-8000-000000000012', 'ca000000-0000-4000-8000-000000000005', 'natural-styling', 'Natural hair styling', 'Wash and go, puffs, updos and defined curls.', 90),
  ('5e000000-0000-4000-8000-000000000013', 'ca000000-0000-4000-8000-000000000006', 'haircut', 'Haircut', 'Shape-up, trim or full cut.', 60)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A fictional salon
-- ---------------------------------------------------------------------------
insert into public.salons (id, name, address_line, city, province, postal_code, lat, lng, phone, created_by, is_verified)
values ('5a000000-0000-4000-8000-000000000001', 'Crown & Coil Studio (fictional)', '100 Example Street',
        'Fredericton', 'NB', 'E3B 0A1', 45.9620, -66.6470, '+1 506 555 0199',
        '50000000-0000-4000-8000-000000000002', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Stylist profiles (seed rows were created by the signup trigger)
-- ---------------------------------------------------------------------------
update public.stylist_profiles set
  display_name = 'Amara Demo', business_name = 'Amara Braids (sample)',
  headline = 'Knotless braids and cornrows — mobile across Fredericton',
  bio = 'SAMPLE PROFILE. Amara is a fictional freelance braider used for testing BeautyExpress. Gentle tension, neat parts and clean finishes.',
  stylist_type = 'freelance', years_experience = 8, city = 'Fredericton', province = 'NB',
  approx_lat = 45.9636, approx_lng = -66.6431, offers_mobile = true, offers_studio = true,
  max_travel_km = 25, travel_fee_base_cents = 1000, travel_fee_per_km_cents = 50,
  booking_mode = 'instant', min_notice_hours = 12, timezone = 'America/Moncton',
  onboarding_completed = true, approval_status = 'approved', verification_status = 'verified', is_featured = true,
  avatar_url = '/images/seed/avatar-1.svg'
where id = '50000000-0000-4000-8000-000000000001';

update public.stylist_profiles set
  display_name = 'Keisha Example', business_name = 'Crown & Coil Studio (sample)',
  headline = 'Silk presses, wig installs and sew-ins in a calm salon',
  bio = 'SAMPLE PROFILE. Keisha is a fictional salon stylist used for testing. Specialises in healthy heat styling.',
  stylist_type = 'salon', salon_id = '5a000000-0000-4000-8000-000000000001', years_experience = 12,
  city = 'Fredericton', province = 'NB', approx_lat = 45.9620, approx_lng = -66.6470,
  offers_salon = true, booking_mode = 'approval', timezone = 'America/Moncton',
  onboarding_completed = true, approval_status = 'approved', verification_status = 'verified',
  avatar_url = '/images/seed/avatar-2.svg'
where id = '50000000-0000-4000-8000-000000000002';

update public.stylist_profiles set
  display_name = 'Nia Placeholder', business_name = 'Loc Lab (sample)',
  headline = 'Loc specialist — starter locs, retwists and faux locs',
  bio = 'SAMPLE PROFILE. Nia is a fictional loctician used for testing BeautyExpress.',
  stylist_type = 'freelance', years_experience = 6, city = 'Moncton', province = 'NB',
  approx_lat = 46.0878, approx_lng = -64.7782, offers_studio = true, offers_mobile = true,
  max_travel_km = 20, travel_fee_base_cents = 1500, booking_mode = 'approval', timezone = 'America/Moncton',
  onboarding_completed = true, approval_status = 'approved', avatar_url = '/images/seed/avatar-3.svg'
where id = '50000000-0000-4000-8000-000000000003';

update public.stylist_profiles set
  display_name = 'Zuri Testcase', business_name = 'Twist & Shout Hair (sample)',
  headline = 'Senegalese and passion twists, Halifax',
  bio = 'SAMPLE PROFILE. Zuri is a fictional twist specialist used for testing.',
  stylist_type = 'freelance', years_experience = 4, city = 'Halifax', province = 'NS',
  approx_lat = 44.6488, approx_lng = -63.5752, offers_studio = true, offers_mobile = true,
  max_travel_km = 15, travel_fee_base_cents = 2000, booking_mode = 'instant', timezone = 'America/Halifax',
  onboarding_completed = true, approval_status = 'approved', avatar_url = '/images/seed/avatar-4.svg'
where id = '50000000-0000-4000-8000-000000000004';

update public.stylist_profiles set
  display_name = 'Imani Mockup', business_name = 'Imani Natural (sample)',
  headline = 'Natural hair care and styling for all textures',
  bio = 'SAMPLE PROFILE. Imani is a fictional natural-hair stylist used for testing.',
  stylist_type = 'freelance', years_experience = 10, city = 'Saint John', province = 'NB',
  approx_lat = 45.2733, approx_lng = -66.0633, offers_studio = true, booking_mode = 'instant',
  timezone = 'America/Moncton', onboarding_completed = true, approval_status = 'approved',
  avatar_url = '/images/seed/avatar-5.svg'
where id = '50000000-0000-4000-8000-000000000005';

-- Stylist 6 has NOT finished onboarding, so they do not appear in search.
update public.stylist_profiles set display_name = 'Dana Fixture', city = 'Toronto', province = 'ON',
  approx_lat = 43.6532, approx_lng = -79.3832, timezone = 'America/Toronto'
where id = '50000000-0000-4000-8000-000000000006';

update public.stylist_private set studio_address = '12 Sample Lane, Fredericton, NB (fictional)',
  studio_lat = 45.9641, studio_lng = -66.6420 where stylist_id = '50000000-0000-4000-8000-000000000001';
update public.stylist_private set studio_address = '7 Placeholder Ave, Moncton, NB (fictional)'
 where stylist_id = '50000000-0000-4000-8000-000000000003';
update public.stylist_private set studio_address = '55 Demo Road, Halifax, NS (fictional)'
 where stylist_id = '50000000-0000-4000-8000-000000000004';
update public.stylist_private set studio_address = '3 Example Court, Saint John, NB (fictional)'
 where stylist_id = '50000000-0000-4000-8000-000000000005';

insert into public.salon_memberships (salon_id, stylist_id, member_role)
values ('5a000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'owner')
on conflict do nothing;

insert into public.service_areas (stylist_id, label, lat, lng, radius_km) values
  ('50000000-0000-4000-8000-000000000001', 'Oromocto', 45.8488, -66.4787, 10),
  ('50000000-0000-4000-8000-000000000004', 'Dartmouth', 44.6713, -63.5772, 10);

-- ---------------------------------------------------------------------------
-- Services offered (prices in cents)
-- ---------------------------------------------------------------------------
insert into public.stylist_services (id, stylist_id, service_id, title, description, base_price_cents,
  duration_minutes, deposit_type, deposit_value, location_types) values
  ('55000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001',
   'Knotless braids', 'Medium knotless braids, hair included unless you choose otherwise.', 18000, 300, 'percent', 25,
   array['client_location', 'stylist_studio']::public.location_type[]),
  ('55000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000003',
   'Straight-back cornrows', '8–12 cornrows, no extensions.', 6000, 90, 'none', 0,
   array['client_location', 'stylist_studio']::public.location_type[]),
  ('55000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000011',
   'Silk press', 'Wash, deep condition, blow-dry and silk press.', 9500, 120, 'fixed', 2500,
   array['salon']::public.location_type[]),
  ('55000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000009',
   'Lace front wig install', 'Customise, install and style your lace front unit.', 15000, 150, 'fixed', 5000,
   array['salon']::public.location_type[]),
  ('55000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000003', '5e000000-0000-4000-8000-000000000006',
   'Loc retwist', 'Palm-roll retwist with style.', 8500, 120, 'none', 0,
   array['stylist_studio', 'client_location']::public.location_type[]),
  ('55000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000003', '5e000000-0000-4000-8000-000000000007',
   'Starter locs', 'Comb coils or two-strand twist starter locs.', 16000, 180, 'percent', 30,
   array['stylist_studio']::public.location_type[]),
  ('55000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000004', '5e000000-0000-4000-8000-000000000004',
   'Senegalese twists', 'Medium twists, mid-back length.', 17000, 300, 'percent', 20,
   array['stylist_studio', 'client_location']::public.location_type[]),
  ('55000000-0000-4000-8000-000000000008', '50000000-0000-4000-8000-000000000005', '5e000000-0000-4000-8000-000000000012',
   'Wash and go', 'Cleanse, condition and define your curls.', 7000, 90, 'none', 0,
   array['stylist_studio']::public.location_type[]),
  ('55000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000005', '5e000000-0000-4000-8000-000000000005',
   'Two-strand twists', 'Natural-hair twists, no extensions.', 9000, 150, 'none', 0,
   array['stylist_studio']::public.location_type[])
on conflict (id) do nothing;

insert into public.service_options (id, stylist_service_id, group_name, group_type, name, price_delta_cents,
  duration_delta_minutes, sort_order) values
  ('0b000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', 'Length', 'choose_one', 'Shoulder length', 0, 0, 1),
  ('0b000000-0000-4000-8000-000000000002', '55000000-0000-4000-8000-000000000001', 'Length', 'choose_one', 'Mid-back', 3000, 60, 2),
  ('0b000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000001', 'Length', 'choose_one', 'Waist length', 6000, 120, 3),
  ('0b000000-0000-4000-8000-000000000004', '55000000-0000-4000-8000-000000000001', 'Add-ons', 'add_on', 'Curly ends', 1500, 30, 1),
  ('0b000000-0000-4000-8000-000000000005', '55000000-0000-4000-8000-000000000001', 'Add-ons', 'add_on', 'I bring my own hair', -2000, 0, 2),
  ('0b000000-0000-4000-8000-000000000006', '55000000-0000-4000-8000-000000000003', 'Add-ons', 'add_on', 'Trim', 1500, 15, 1),
  ('0b000000-0000-4000-8000-000000000007', '55000000-0000-4000-8000-000000000003', 'Add-ons', 'add_on', 'Protein treatment', 2000, 20, 2),
  ('0b000000-0000-4000-8000-000000000008', '55000000-0000-4000-8000-000000000007', 'Size', 'choose_one', 'Medium', 0, 0, 1),
  ('0b000000-0000-4000-8000-000000000009', '55000000-0000-4000-8000-000000000007', 'Size', 'choose_one', 'Small', 4000, 90, 2)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Working hours, Monday–Saturday (0 = Sunday ... 6 = Saturday).
-- Braiders/twisters (stylists 1 and 4) work one long block because their
-- services take many hours; the others take a 12:30–13:00 lunch break.
-- ---------------------------------------------------------------------------
insert into public.stylist_availability (stylist_id, weekday, start_time, end_time)
select s.id, d.weekday, '09:00'::time, '19:00'::time
from (values ('50000000-0000-4000-8000-000000000001'::uuid), ('50000000-0000-4000-8000-000000000004'::uuid)) as s(id)
cross join (values (1), (2), (3), (4), (5), (6)) as d(weekday);

insert into public.stylist_availability (stylist_id, weekday, start_time, end_time)
select s.id, d.weekday, w.start_time, w.end_time
from (values ('50000000-0000-4000-8000-000000000002'::uuid), ('50000000-0000-4000-8000-000000000003'::uuid),
             ('50000000-0000-4000-8000-000000000005'::uuid)) as s(id)
cross join (values (1), (2), (3), (4), (5), (6)) as d(weekday)
cross join (values ('09:00'::time, '12:30'::time), ('13:00'::time, '19:00'::time)) as w(start_time, end_time);

insert into public.stylist_availability (stylist_id, weekday, start_time, end_time)
values ('50000000-0000-4000-8000-000000000004', 0, '12:00', '17:00');

-- ---------------------------------------------------------------------------
-- Portfolio (abstract illustrations — replace with real photos you own)
-- ---------------------------------------------------------------------------
insert into public.stylist_portfolio (stylist_id, image_url, caption, service_id, sort_order) values
  ('50000000-0000-4000-8000-000000000001', '/images/seed/braids.svg', 'Sample image: knotless braids', '5e000000-0000-4000-8000-000000000001', 1),
  ('50000000-0000-4000-8000-000000000001', '/images/seed/cornrows.svg', 'Sample image: cornrows', '5e000000-0000-4000-8000-000000000003', 2),
  ('50000000-0000-4000-8000-000000000002', '/images/seed/natural.svg', 'Sample image: silk press', '5e000000-0000-4000-8000-000000000011', 1),
  ('50000000-0000-4000-8000-000000000002', '/images/seed/wigs.svg', 'Sample image: wig install', '5e000000-0000-4000-8000-000000000009', 2),
  ('50000000-0000-4000-8000-000000000003', '/images/seed/locs.svg', 'Sample image: retwist', '5e000000-0000-4000-8000-000000000006', 1),
  ('50000000-0000-4000-8000-000000000004', '/images/seed/twists.svg', 'Sample image: Senegalese twists', '5e000000-0000-4000-8000-000000000004', 1),
  ('50000000-0000-4000-8000-000000000005', '/images/seed/cuts.svg', 'Sample image: wash and go', '5e000000-0000-4000-8000-000000000012', 1);

-- ---------------------------------------------------------------------------
-- Client address (fictional)
-- ---------------------------------------------------------------------------
insert into public.addresses (id, user_id, label, line1, city, province, postal_code, lat, lng, is_default)
values ('ad000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Home (sample)',
        '200 Fictional Road', 'Fredericton', 'NB', 'E3A 0A1', 45.9700, -66.6500, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Sample bookings (pay in person, so no fake payment records are created)
-- ---------------------------------------------------------------------------
insert into public.bookings (id, client_id, stylist_id, stylist_service_id, status, booking_mode, location_type,
  starts_at, ends_at, blocked_until, duration_minutes, subtotal_cents, service_fee_cents, total_cents,
  platform_commission_cents, stylist_earnings_cents, payment_provider, confirmed_at, started_at, completed_at,
  client_notes)
values
  -- completed 10 days ago
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000002', 'completed', 'instant',
   'stylist_studio', date_trunc('hour', now()) - interval '10 days',
   date_trunc('hour', now()) - interval '10 days' + interval '90 minutes',
   date_trunc('hour', now()) - interval '10 days' + interval '105 minutes', 90, 6000, 300, 6300, 900, 5100,
   'pay_in_person', now() - interval '12 days', now() - interval '10 days', now() - interval '10 days',
   'SAMPLE BOOKING'),
  -- confirmed, in 3 days at 10:00 stylist time
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000002', '55000000-0000-4000-8000-000000000003', 'confirmed', 'approval',
   'salon', ((current_date + 3) + time '10:00') at time zone 'America/Moncton',
   ((current_date + 3) + time '12:00') at time zone 'America/Moncton',
   ((current_date + 3) + time '12:15') at time zone 'America/Moncton', 120, 9500, 475, 9975, 1425, 8075,
   'pay_in_person', now(), null, null, 'SAMPLE BOOKING'),
  -- request waiting for the loc stylist, in 5 days at 13:00
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002',
   '50000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000005', 'requested', 'approval',
   'stylist_studio', ((current_date + 5) + time '13:00') at time zone 'America/Moncton',
   ((current_date + 5) + time '15:00') at time zone 'America/Moncton',
   ((current_date + 5) + time '15:15') at time zone 'America/Moncton', 120, 8500, 425, 8925, 1275, 7225,
   'pay_in_person', null, null, null, 'SAMPLE BOOKING')
on conflict (id) do nothing;

update public.bookings set salon_id = '5a000000-0000-4000-8000-000000000001'
 where id = 'b0000000-0000-4000-8000-000000000002';

insert into public.booking_line_items (booking_id, kind, description, amount_cents, duration_minutes, sort_order) values
  ('b0000000-0000-4000-8000-000000000001', 'service', 'Straight-back cornrows', 6000, 90, 0),
  ('b0000000-0000-4000-8000-000000000001', 'service_fee', 'Booking fee', 300, 0, 1),
  ('b0000000-0000-4000-8000-000000000002', 'service', 'Silk press', 9500, 120, 0),
  ('b0000000-0000-4000-8000-000000000002', 'service_fee', 'Booking fee', 475, 0, 1),
  ('b0000000-0000-4000-8000-000000000003', 'service', 'Loc retwist', 8500, 120, 0),
  ('b0000000-0000-4000-8000-000000000003', 'service_fee', 'Booking fee', 425, 0, 1);

insert into public.payments (booking_id, client_id, stylist_id, provider, kind, amount_cents, status, verified_at)
values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   'pay_in_person', 'full', 6300, 'succeeded', now() - interval '10 days'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002',
   'pay_in_person', 'full', 9975, 'requires_payment', null),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003',
   'pay_in_person', 'full', 8925, 'requires_payment', null);

insert into public.booking_status_history (booking_id, from_status, to_status, reason) values
  ('b0000000-0000-4000-8000-000000000001', null, 'confirmed', 'Seed data'),
  ('b0000000-0000-4000-8000-000000000001', 'confirmed', 'in_progress', 'Seed data'),
  ('b0000000-0000-4000-8000-000000000001', 'in_progress', 'completed', 'Seed data'),
  ('b0000000-0000-4000-8000-000000000002', null, 'confirmed', 'Seed data'),
  ('b0000000-0000-4000-8000-000000000003', null, 'requested', 'Seed data');

select public.ensure_conversation('c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
                                  'b0000000-0000-4000-8000-000000000001');

insert into public.reviews (booking_id, client_id, rating, comment) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 5,
   'SAMPLE REVIEW: Neat, quick and gentle. Would book again.')
on conflict do nothing;

insert into public.promo_codes (code, description, percent_off, max_redemptions)
values ('WELCOME10', 'Sample promo: 10% off the service price', 10, 100)
on conflict do nothing;
