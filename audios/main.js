import { initializeCards } from './cards.js';

if (!window?.supabase?.createClient) {
  console.error('Supabase client is not available. Verify that the Supabase script is loaded before main.js.');
} else if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
  console.error('Supabase credentials are not defined. Check config.js for SUPABASE_URL and SUPABASE_ANON_KEY.');
} else {
  const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  const urlParams = new URLSearchParams(window.location.search);
  initializeCards({
    supabase,
    urlParams,
    userId: urlParams.get('id'),
    title: urlParams.get('title'),
    songIdParam: urlParams.get('songId')
  });
}
