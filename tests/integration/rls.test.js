// Row Level Security and permission tests: run against a real PostgreSQL database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { as, createTestDatabase, expectError, hasDatabase, IDS } from './db/helpers.js'

describe.skipIf(!hasDatabase)('Row Level Security', () => {
  let db
  beforeAll(async () => {
    db = await createTestDatabase()
  }, 60_000)
  afterAll(async () => db?.drop())

  describe('anonymous visitors', () => {
    it('can browse public stylists, services and reviews', async () => {
      const rows = await as(db.pool, 'anon', async (c) => {
        const s = await c.query('select id from stylist_profiles')
        const sv = await c.query('select id from stylist_services')
        const r = await c.query('select id from reviews')
        return { s: s.rows.length, sv: sv.rows.length, r: r.rows.length }
      })
      expect(rows.s).toBe(5) // stylist 6 has not finished onboarding
      expect(rows.sv).toBeGreaterThan(0)
      expect(rows.r).toBe(1)
    })

    it('cannot read profiles, addresses, bookings, payments or private stylist data', async () => {
      const counts = await as(db.pool, 'anon', async (c) => {
        const out = {}
        for (const t of ['profiles', 'addresses', 'bookings', 'payments', 'stylist_private', 'messages', 'user_roles']) {
          out[t] = (await c.query(`select count(*)::int as n from ${t}`)).rows[0].n
        }
        return out
      })
      for (const n of Object.values(counts)) expect(n).toBe(0)
    })

    it('only sees public platform settings', async () => {
      const keys = await as(db.pool, 'anon', async (c) =>
        (await c.query('select key from platform_settings')).rows.map((r) => r.key),
      )
      expect(keys).toContain('service_fee_percent')
      expect(keys).not.toContain('payment_hold_minutes')
      expect(keys).not.toContain('max_bookings_per_hour')
    })

    it('cannot create bookings or call admin functions', async () => {
      await expectError(
        as(db.pool, 'anon', (c) =>
          c.query(`select create_booking($1, '{}', now(), 'stylist_studio')`, [IDS.cornrows]),
        ),
        /permission denied/,
      )
      await expectError(as(db.pool, 'anon', (c) => c.query('select admin_stats()')), /permission denied/)
    })

    it('cannot insert into any table', async () => {
      await expectError(
        as(db.pool, 'anon', (c) => c.query(`insert into service_categories (slug, name) values ('x-x', 'X')`)),
        /permission denied/,
      )
    })
  })

  describe('clients', () => {
    it('see only their own addresses and bookings', async () => {
      const r = await as(db.pool, IDS.client2, async (c) => ({
        addresses: (await c.query('select * from addresses')).rows.length,
        bookings: (await c.query('select client_id from bookings')).rows,
      }))
      expect(r.addresses).toBe(0) // the seeded address belongs to client1
      expect(r.bookings.every((b) => b.client_id === IDS.client2)).toBe(true)
      expect(r.bookings.length).toBe(1)
    })

    it('cannot read another user’s private profile', async () => {
      const rows = await as(db.pool, IDS.client2, (c) =>
        c.query('select * from profiles where id = $1', [IDS.client1]),
      )
      expect(rows.rows.length).toBe(0)
    })

    it('cannot make themselves an administrator', async () => {
      await expectError(
        as(db.pool, IDS.client1, (c) =>
          c.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [IDS.client1]),
        ),
        /permission denied/,
      )
      await expectError(
        as(db.pool, IDS.client1, (c) =>
          c.query(`update user_roles set role = 'admin' where user_id = $1`, [IDS.client1]),
        ),
        /permission denied/,
      )
      await expectError(
        as(db.pool, IDS.client1, (c) => c.query(`select admin_set_role($1, 'admin', true)`, [IDS.client1])),
        /Administrator access required/,
      )
    })

    it('cannot change their own account status or email directly', async () => {
      await expectError(
        as(db.pool, IDS.client1, (c) => c.query(`update profiles set status = 'suspended' where id = $1`, [IDS.client1])),
        /cannot change these account fields/,
      )
      await expectError(
        as(db.pool, IDS.client1, (c) =>
          c.query(`update profiles set email = 'x@example.com' where id = $1`, [IDS.client1]),
        ),
        /cannot change these account fields/,
      )
    })

    it('can update their own name', async () => {
      const r = await as(db.pool, IDS.client1, (c) =>
        c.query(`update profiles set full_name = 'New Name' where id = $1 returning full_name`, [IDS.client1]),
      )
      expect(r.rows[0].full_name).toBe('New Name')
    })

    it('cannot write bookings, payments or refunds directly', async () => {
      await expectError(
        as(db.pool, IDS.client1, (c) =>
          c.query(`update bookings set total_cents = 1 where id = $1`, [IDS.completedBooking]),
        ),
        /permission denied/,
      )
      await expectError(
        as(db.pool, IDS.client1, (c) => c.query(`update payments set status = 'succeeded'`)),
        /permission denied/,
      )
      await expectError(
        as(db.pool, IDS.client1, (c) =>
          c.query(
            `insert into refunds (payment_id, booking_id, amount_cents) select id, booking_id, 100 from payments limit 1`,
          ),
        ),
        /permission denied/,
      )
    })

    it('cannot call server-only payment functions', async () => {
      await expectError(
        as(db.pool, IDS.client1, (c) => c.query(`select svc_record_payment_succeeded('pi_x', 'ch_x', 100)`)),
        /permission denied/,
      )
      await expectError(
        as(db.pool, IDS.client1, (c) => c.query(`select * from svc_claim_payouts(10)`)),
        /permission denied/,
      )
      await expectError(
        as(db.pool, IDS.client1, (c) => c.query(`select write_audit('x','x','x',null,null)`)),
        /permission denied/,
      )
    })

    it('cannot read private settings through helper functions', async () => {
      await expectError(
        as(db.pool, IDS.client1, (c) => c.query(`select get_setting('commission_percent')`)),
        /permission denied/,
      )
    })
  })

  describe('stylists', () => {
    it('see bookings assigned to them only', async () => {
      const rows = await as(db.pool, IDS.stylist2, (c) => c.query('select stylist_id from bookings'))
      expect(rows.rows.length).toBe(1)
      expect(rows.rows[0].stylist_id).toBe(IDS.stylist2)
    })

    it('can see the name of a client who booked them, but not other clients', async () => {
      const r = await as(db.pool, IDS.stylist2, async (c) => ({
        own: (await c.query('select full_name from profiles where id = $1', [IDS.client1])).rows.length,
        other: (await c.query('select full_name from profiles where id = $1', [IDS.client2])).rows.length,
      }))
      expect(r.own).toBe(1)
      expect(r.other).toBe(0)
    })

    it('cannot feature or verify themselves', async () => {
      await expectError(
        as(db.pool, IDS.stylist3, (c) => c.query(`update stylist_profiles set is_featured = true where id = $1`, [IDS.stylist3])),
        /Only administrators/,
      )
      await expectError(
        as(db.pool, IDS.stylist3, (c) =>
          c.query(`update stylist_profiles set verification_status = 'verified' where id = $1`, [IDS.stylist3]),
        ),
        /Only administrators/,
      )
      await expectError(
        as(db.pool, IDS.stylist3, (c) => c.query(`update stylist_profiles set rating_avg = 5 where id = $1`, [IDS.stylist3])),
        /Only administrators/,
      )
    })

    it('cannot set their own Stripe account id', async () => {
      await expectError(
        as(db.pool, IDS.stylist1, (c) =>
          c.query(`update stylist_private set stripe_account_id = 'acct_fake' where stylist_id = $1`, [IDS.stylist1]),
        ),
        /managed by the server/,
      )
    })

    it('can edit only their own services', async () => {
      const own = await as(db.pool, IDS.stylist1, (c) =>
        c.query(`update stylist_services set base_price_cents = 6500 where id = $1 returning id`, [IDS.cornrows]),
      )
      expect(own.rows.length).toBe(1)
      const other = await as(db.pool, IDS.stylist1, (c) =>
        c.query(`update stylist_services set base_price_cents = 1 where id = $1 returning id`, [IDS.silkPress]),
      )
      expect(other.rows.length).toBe(0)
    })

    it('cannot create services for another stylist', async () => {
      await expectError(
        as(db.pool, IDS.stylist1, (c) =>
          c.query(
            `insert into stylist_services (stylist_id, service_id, title, base_price_cents, duration_minutes)
             values ($1, '5e000000-0000-4000-8000-000000000001', 'Hijack', 100, 60)`,
            [IDS.stylist2],
          ),
        ),
        /row-level security/,
      )
    })

    it('clients cannot create stylist services', async () => {
      await expectError(
        as(db.pool, IDS.client1, (c) =>
          c.query(
            `insert into stylist_services (stylist_id, service_id, title, base_price_cents, duration_minutes)
             values ($1, '5e000000-0000-4000-8000-000000000001', 'Nope', 100, 60)`,
            [IDS.client1],
          ),
        ),
        /row-level security|foreign key/,
      )
    })
  })

  describe('private service address', () => {
    it('is hidden from the stylist until the booking is confirmed', async () => {
      // Owner creates a requested mobile booking with an address snapshot.
      await db.pool.query(`
        insert into bookings (id, client_id, stylist_id, stylist_service_id, status, booking_mode, location_type,
          starts_at, ends_at, blocked_until, duration_minutes, subtotal_cents, total_cents, payment_provider)
        values ('b1000000-0000-4000-8000-000000000001', '${IDS.client2}', '${IDS.stylist1}', '${IDS.cornrows}',
          'requested', 'approval', 'client_location', now() + interval '20 days', now() + interval '20 days 90 minutes',
          now() + interval '20 days 105 minutes', 90, 6000, 6000, 'pay_in_person');
        insert into booking_private_details (booking_id, address_text) values
          ('b1000000-0000-4000-8000-000000000001', '1 Secret Street');`)
      const before = await as(db.pool, IDS.stylist1, (c) =>
        c.query(`select * from booking_private_details where booking_id = 'b1000000-0000-4000-8000-000000000001'`),
      )
      expect(before.rows.length).toBe(0)
      const loc = await as(db.pool, IDS.stylist1, (c) =>
        c.query(`select get_booking_location('b1000000-0000-4000-8000-000000000001') as l`),
      )
      expect(loc.rows[0].l.revealed).toBe(false)
      expect(loc.rows[0].l.address).toBeNull()

      await db.pool.query(`update bookings set status = 'confirmed' where id = 'b1000000-0000-4000-8000-000000000001'`)
      const after = await as(db.pool, IDS.stylist1, (c) =>
        c.query(`select address_text from booking_private_details where booking_id = 'b1000000-0000-4000-8000-000000000001'`),
      )
      expect(after.rows[0].address_text).toBe('1 Secret Street')

      // Another stylist never sees it.
      const other = await as(db.pool, IDS.stylist2, (c) =>
        c.query(`select * from booking_private_details where booking_id = 'b1000000-0000-4000-8000-000000000001'`),
      )
      expect(other.rows.length).toBe(0)
    })
  })

  describe('messaging', () => {
    it('only conversation participants can read and send messages', async () => {
      const convId = await as(
        db.pool,
        IDS.client1,
        async (c) => {
          const { rows } = await c.query(`select get_or_create_conversation($1) as id`, [IDS.stylist1])
          await c.query(`insert into messages (conversation_id, sender_id, body) values ($1, $2, 'Hello!')`, [
            rows[0].id,
            IDS.client1,
          ])
          return rows[0].id
        },
        { commit: true },
      )
      const stylistSees = await as(db.pool, IDS.stylist1, (c) =>
        c.query('select body from messages where conversation_id = $1', [convId]),
      )
      expect(stylistSees.rows.map((r) => r.body)).toContain('Hello!')

      const outsider = await as(db.pool, IDS.client2, (c) =>
        c.query('select body from messages where conversation_id = $1', [convId]),
      )
      expect(outsider.rows.length).toBe(0)

      await expectError(
        as(db.pool, IDS.client2, (c) =>
          c.query(`insert into messages (conversation_id, sender_id, body) values ($1, $2, 'sneaky')`, [
            convId,
            IDS.client2,
          ]),
        ),
        /row-level security/,
      )
      // Cannot impersonate another sender.
      await expectError(
        as(db.pool, IDS.client1, (c) =>
          c.query(`insert into messages (conversation_id, sender_id, body) values ($1, $2, 'fake')`, [
            convId,
            IDS.stylist1,
          ]),
        ),
        /row-level security/,
      )
    })

    it('a stylist cannot start a conversation with a client who never booked them', async () => {
      await expectError(
        as(db.pool, IDS.stylist3, async (c) => {
          const { rows } = await c.query(`select get_or_create_conversation($1) as id`, [IDS.client1])
          if (!rows[0].id) throw new Error('no conversation')
          return rows[0].id
        }),
        /no conversation/,
      )
    })

    it('notifications are private and only read status can change', async () => {
      const r = await as(db.pool, IDS.client1, async (c) => {
        const mine = await c.query('select user_id from notifications')
        return mine.rows
      })
      expect(r.every((n) => n.user_id === IDS.client1)).toBe(true)
      await expectError(
        as(db.pool, IDS.client1, (c) => c.query(`update notifications set title = 'hacked' where user_id = $1`, [IDS.client1])),
        /Only read status/,
      )
      const marked = await as(db.pool, IDS.client1, (c) =>
        c.query(`update notifications set read_at = now() where user_id = $1 returning id`, [IDS.client1]),
      )
      expect(marked.rows.length).toBeGreaterThan(0)
    })
  })

  describe('administrators', () => {
    it('non-admins are refused by every admin function', async () => {
      for (const sql of [
        `select admin_stats()`,
        `select admin_update_setting('commission_percent', '20')`,
        `select admin_set_user_status('${IDS.client2}', 'suspended', 'x')`,
        `select admin_update_stylist('${IDS.stylist3}', 'verified', null, null)`,
      ]) {
        await expectError(as(db.pool, IDS.stylist1, (c) => c.query(sql)), /Administrator access required/)
      }
    })

    it('admins can manage settings with validation, and actions are audited', async () => {
      await expectError(
        as(db.pool, IDS.admin, (c) => c.query(`select admin_update_setting('commission_percent', '150')`)),
        /between 0 and 100/,
      )
      await expectError(
        as(db.pool, IDS.admin, (c) => c.query(`select admin_update_setting('not_a_setting', '1')`)),
        /Unknown setting/,
      )
      const r = await as(db.pool, IDS.admin, async (c) => {
        await c.query(`select admin_update_setting('tax_percent', '15')`)
        const audit = await c.query(
          `select actor_id, table_name from audit_logs where table_name = 'platform_settings' order by id desc limit 1`,
        )
        return audit.rows[0]
      })
      expect(r.actor_id).toBe(IDS.admin)
    })

    it('a suspended admin loses admin rights', async () => {
      await db.pool.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [IDS.client2])
      await db.pool.query(`update profiles set status = 'suspended' where id = $1`, [IDS.client2])
      await expectError(as(db.pool, IDS.client2, (c) => c.query(`select admin_stats()`)), /Administrator access/)
      await db.pool.query(`delete from user_roles where user_id = $1 and role = 'admin'`, [IDS.client2])
      await db.pool.query(`update profiles set status = 'active' where id = $1`, [IDS.client2])
    })

    it('admins can suspend users, which hides suspended stylists from search', async () => {
      await as(db.pool, IDS.admin, (c) => c.query(`select admin_set_user_status($1, 'suspended', 'test')`, [IDS.stylist3]), {
        commit: true,
      })
      const found = await as(db.pool, 'anon', (c) => c.query(`select stylist_id from search_stylists()`))
      expect(found.rows.map((r) => r.stylist_id)).not.toContain(IDS.stylist3)
      await as(db.pool, IDS.admin, (c) => c.query(`select admin_set_user_status($1, 'active', null)`, [IDS.stylist3]), {
        commit: true,
      })
    })

    it('admins can read the audit log; others cannot', async () => {
      const others = await as(db.pool, IDS.client1, (c) => c.query('select count(*)::int n from audit_logs'))
      expect(others.rows[0].n).toBe(0)
      const admin = await as(db.pool, IDS.admin, (c) => c.query('select count(*)::int n from audit_logs'))
      expect(admin.rows[0].n).toBeGreaterThan(0)
    })
  })

  describe('signup', () => {
    it('never grants admin from signup metadata', async () => {
      await db.pool.query(
        `insert into auth.users (id, email, raw_user_meta_data) values
         ('e0000000-0000-4000-8000-000000000001', 'sneaky@example.com', '{"role":"admin","full_name":"Sneaky"}')`,
      )
      const roles = await db.pool.query(`select role from user_roles where user_id = 'e0000000-0000-4000-8000-000000000001'`)
      expect(roles.rows.map((r) => r.role)).toEqual(['client'])
    })

    it('creates stylist profile rows for stylist signups', async () => {
      await db.pool.query(
        `insert into auth.users (id, email, raw_user_meta_data) values
         ('e0000000-0000-4000-8000-000000000002', 'newstylist@example.com', '{"role":"stylist","full_name":"New Stylist"}')`,
      )
      const sp = await db.pool.query(
        `select display_name, onboarding_completed from stylist_profiles where id = 'e0000000-0000-4000-8000-000000000002'`,
      )
      expect(sp.rows[0]).toEqual({ display_name: 'New Stylist', onboarding_completed: false })
      const pub = await as(db.pool, 'anon', (c) =>
        c.query(`select id from stylist_profiles where id = 'e0000000-0000-4000-8000-000000000002'`),
      )
      expect(pub.rows.length).toBe(0) // not public until onboarding is completed
    })
  })

  describe('becoming a stylist', () => {
    it('a client can add the stylist role to their own account only', async () => {
      const roles = await as(db.pool, IDS.client2, async (c) => {
        await c.query(`select become_stylist()`)
        return (await c.query(`select role from user_roles where user_id = $1 order by role`, [IDS.client2])).rows
      })
      expect(roles.map((r) => r.role)).toEqual(['client', 'stylist'])
    })
  })

  describe('stylist publishing rules', () => {
    it('a stylist cannot publish an incomplete profile', async () => {
      await expectError(
        as(db.pool, IDS.stylist6, (c) =>
          c.query(`update stylist_profiles set onboarding_completed = true where id = $1`, [IDS.stylist6]),
        ),
        /Add your name and city|Choose at least one place|Add at least one service/,
      )
    })
  })
})
