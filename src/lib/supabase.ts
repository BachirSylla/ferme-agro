import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/db';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Échec explicite plutôt que comportement silencieux si la conf manque.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Configuration Supabase manquante. Copie .env.example vers .env.local et " +
      "renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.",
  );
}

// Client unique pour toute l'app. La anon key est publique : la sécurité repose
// sur le RLS (chaque ferme ne voit que ses lignes), jamais sur le secret de la clé.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true, // garde la session (PWA : survit au rechargement / hors-ligne)
    autoRefreshToken: true, // rafraîchit le token avant expiration
    detectSessionInUrl: true, // gère les retours de magic link / OAuth
  },
});
