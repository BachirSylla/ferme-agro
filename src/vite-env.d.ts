/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Typage strict des variables d'environnement du projet.
// Permet l'auto-complétion et empêche d'utiliser une variable non déclarée.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Feature flag : 'true' pour rouvrir l'inscription publique côté UI.
  // Optionnelle — absente ou ≠ 'true' = inscription en sommeil.
  readonly VITE_ALLOW_PUBLIC_SIGNUP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
