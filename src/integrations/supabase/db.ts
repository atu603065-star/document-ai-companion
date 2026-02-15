// Typed helper to bypass empty auto-generated types until they sync with the actual database schema.
// Use `db` instead of `supabase` for database operations when the generated types are out of sync.
import { supabase } from './client';

type AnySupabase = ReturnType<typeof createUntypedClient>;

function createUntypedClient() {
  return supabase as any;
}

/**
 * Untyped Supabase client for database operations.
 * Use this when the auto-generated types.ts doesn't match the actual DB schema.
 */
export const db = supabase as any;
