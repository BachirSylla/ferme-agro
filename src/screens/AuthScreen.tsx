import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

type Mode = 'login' | 'signup';

// Mappe les messages d'erreur Supabase en français pour ne pas exposer
// les libellés techniques bruts à l'utilisateur final.
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
      // Pas de navigation manuelle : SessionContext écoute onAuthStateChange
      // et bascule sur AppShell dès qu'une session valide est ouverte.
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full grid place-items-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6 flex flex-col gap-4 border border-neutral-200"
      >
        <div className="flex flex-col items-center gap-2 mb-2">
          <div className="h-12 w-12 rounded-xl bg-brand text-brand-fg grid place-items-center font-bold text-xl">
            F
          </div>
          <h1 className="text-xl font-semibold">
            {mode === 'login' ? 'Connexion' : 'Créer un compte'}
          </h1>
          <p className="text-sm text-neutral-500 text-center">
            {mode === 'login'
              ? 'Entre tes identifiants pour accéder à ta ferme.'
              : 'Un compte = une ferme. Tu pourras la renommer ensuite.'}
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-neutral-700">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-neutral-700">Mot de passe</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
        </label>

        {error && (
          <div
            role="alert"
            className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="bg-brand text-brand-fg rounded-lg px-4 py-2 font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? 'Veuillez patienter…'
            : mode === 'login'
              ? 'Se connecter'
              : 'Créer mon compte'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError(null);
          }}
          className="text-sm text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
        >
          {mode === 'login'
            ? "Pas encore de compte ? Inscription"
            : 'Déjà un compte ? Connexion'}
        </button>
      </form>
    </main>
  );
}
