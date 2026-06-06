import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Mail, Lock, Sprout } from 'lucide-react';

// Feature flag : permet de mettre l'inscription publique en sommeil sans rien
// supprimer du code (handlers, traductions d'erreur, etc. restent fonctionnels).
// Défaut = false. À passer à 'true' (string) côté .env.local ou Vercel pour
// rouvrir l'écran d'inscription instantanément.
const ALLOW_PUBLIC_SIGNUP = import.meta.env.VITE_ALLOW_PUBLIC_SIGNUP === 'true';

type Mode = 'login' | 'signup';

function translateAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Email ou mot de passe incorrect.';
  if (/user already registered/i.test(msg)) return 'Un compte existe déjà pour cet email.';
  if (/password should be at least/i.test(msg))
    return 'Le mot de passe doit faire au moins 6 caractères.';
  if (/email rate limit/i.test(msg))
    return 'Trop de tentatives. Réessaie dans une minute.';
  if (/database error saving new user/i.test(msg))
    return 'Erreur côté serveur lors de la création du compte. Contacte l\u2019administrateur.';
  return `Erreur : ${msg}`;
}

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: authError } =
        mode === 'login'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (authError) setError(translateAuthError(authError.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full grid place-items-center p-6 bg-gradient-to-b from-neutral-50 to-neutral-100">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-brand text-brand-fg grid place-items-center shadow-lg shadow-brand/20">
            <Sprout className="h-7 w-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Ferme</h1>
            <p className="text-sm text-neutral-500">Gestion quotidienne de votre exploitation</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6 flex flex-col gap-4"
        >
          {/* Onglets affichés seulement si l'inscription publique est ouverte.
              En sommeil, l'écran reste pure "Connexion" — le code signup
              ci-dessous est intact, juste inaccessible via l'UI. */}
          {ALLOW_PUBLIC_SIGNUP && (
            <div role="tablist" className="flex bg-neutral-100 rounded-xl p-1">
              <TabButton active={mode === 'login'} onClick={() => { setMode('login'); setError(null); }}>
                Connexion
              </TabButton>
              <TabButton active={mode === 'signup'} onClick={() => { setMode('signup'); setError(null); }}>
                Créer un compte
              </TabButton>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-700">Email</span>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-700">Mot de passe</span>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>
            {mode === 'signup' && (
              <span className="text-xs text-neutral-500">Au moins 6 caractères.</span>
            )}
          </label>

          {error && (
            <div
              role="alert"
              className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="bg-brand text-brand-fg rounded-lg px-4 py-2.5 font-medium shadow-sm hover:opacity-95 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>

          <p className="text-xs text-neutral-500 text-center">
            {mode === 'signup'
              ? 'Un compte = une ferme, créée automatiquement. Vous pourrez la renommer ensuite.'
              : 'Vos données restent isolées par ferme (RLS Postgres).'}
          </p>
        </form>
      </div>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ' +
        (active
          ? 'bg-white text-neutral-900 shadow-sm'
          : 'text-neutral-600 hover:text-neutral-900')
      }
    >
      {children}
    </button>
  );
}
