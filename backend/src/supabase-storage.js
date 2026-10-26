import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

let client

function storageClient() {
  const url = String(process.env.SUPABASE_URL || '').trim()
  const secretKey = String(process.env.SUPABASE_SECRET_KEY || '').trim()
  if (!url || !secretKey) throw new Error('Supabase Storage is not configured')
  client ||= createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  return client
}

export async function uploadProductImage(hospitalId, image) {
  const bucket = 'product-images'
  const path = `${hospitalId}/${crypto.randomUUID()}.jpg`
  const storage = storageClient().storage.from(bucket)
  const { error } = await storage.upload(path, image, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  if (error) throw error
  const { data } = storage.getPublicUrl(path)
  return { imageUrl: data.publicUrl }
}
