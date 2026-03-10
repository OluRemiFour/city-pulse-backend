// ============================================================
// db/supabase.ts
// Two clients:
//   supabase      — anon key  (read-only routes)
//   supabaseAdmin — service_role key (writes: seed, analyze, scrape)
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL              = process.env.SUPABASE_URL              ?? '';
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY         ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL)              console.error('[supabase] Missing SUPABASE_URL');
if (!SUPABASE_ANON_KEY)         console.error('[supabase] Missing SUPABASE_ANON_KEY');
if (!SUPABASE_SERVICE_ROLE_KEY) console.error('[supabase] Missing SUPABASE_SERVICE_ROLE_KEY');

// Read-only client — used in all GET routes
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// Write client — used by seed scripts, analyze, and scraper
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
