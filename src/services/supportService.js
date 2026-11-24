import { supabase, unwrap } from '../lib/supabase.js'

export const listMyReports = async (userId) =>
  unwrap(await supabase.from('reports').select('*').eq('reporter_id', userId).order('created_at', { ascending: false }))

export const createReport = async (row) => unwrap(await supabase.from('reports').insert(row).select().single())

export const listMyDisputes = async () =>
  unwrap(
    await supabase
      .from('disputes')
      .select('*, bookings(id, reference, stylist_services(title))')
      .order('created_at', { ascending: false }),
  )
