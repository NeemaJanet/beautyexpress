import { supabase } from '../lib/supabase.js'

const LIMITS = { avatars: 5 * 1024 * 1024, portfolio: 8 * 1024 * 1024 }
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Upload into <bucket>/<userId>/... (the storage policy only allows your own folder). */
export async function uploadImage(bucket, userId, file) {
  if (!TYPES.includes(file.type)) throw new Error('Please choose a JPG, PNG or WebP image.')
  if (file.size > LIMITS[bucket]) throw new Error(`Images must be under ${LIMITS[bucket] / 1024 / 1024} MB.`)
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: '31536000', upsert: false })
  if (error) throw new Error(error.message || 'Upload failed')
  const url = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
  return { url, path }
}

export async function deleteImage(bucket, path) {
  if (!path) return
  const { error } = await supabase.storage.from(bucket).remove([path])
  if (error) throw error
}
