// Handing a studio to another account (Admin → Transfer to email, and the link she accepts).
// The owner trigger moves the studio's owner row in Team to her; bookings, clients and emails
// about new bookings follow the studio's owner_id from then on.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

export async function transferTo(admin: SupabaseClient, m: { id: string; owner_id: string | null }, uid: string): Promise<string | null> {
  // phones of the old owner that were never tied to an account (older sign-ins) stay hers:
  // pushes go to the owner's devices only, so the new owner's bookings never reach them
  if (m.owner_id) {
    const { error: pe } = await admin.from('push_subscriptions').update({ user_id: m.owner_id }).eq('master_id', m.id).is('user_id', null);
    if (pe) return pe.message;
  }
  const { error } = await admin.from('masters').update({ owner_id: uid }).eq('id', m.id);
  return error ? error.message : null;
}

export const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;
