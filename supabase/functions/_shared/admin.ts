// Shared by the admin functions: CORS, JSON answers, "is the caller an admin?",
// temporary passwords. The service role key never leaves the function.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
export const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// The caller's JWT must belong to a user listed in public.admins
export async function requireAdmin(req: Request, admin: SupabaseClient) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return null;
  const { data: row } = await admin.from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  return row ? data.user : null;
}

// e.g. "k7Pm-9xQa-3Tbz": easy to read aloud, no 0/O or 1/l/I
export function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(bytes, b => abc[b % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
