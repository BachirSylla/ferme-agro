import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { applyBranding, resetBranding } from '@/lib/branding';
import type { Tables } from '@/types/db';

type Profile = Tables<'profiles'>;
type Organization = Tables<'organizations'>;

// État machine. Un seul écran s'affiche par statut → le rendu conditionnel
// dans App.tsx force le typage exhaustif côté consommateur.
type SessionState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | {
      status: 'authenticated';
      session: Session;
      profile: Profile;
      organization: Organization;
    };

type SessionContextValue = SessionState & {
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    async function loadFromSession(session: Session | null): Promise<void> {
      if (!session) {
        if (active) {
          resetBranding();
          setState({ status: 'unauthenticated' });
        }
        return;
      }

      // Profil — créé par le trigger handle_new_user au signup.
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .is('deleted_at', null)
        .single();

      if (!active) return;
      if (profileErr || !profile) {
        // Aucun profil → état incohérent (trigger manquant ? RLS bloqué ?).
        // On déconnecte pour repartir propre plutôt que de figer un état impossible.
        console.error('Profil introuvable pour la session active', profileErr);
        await supabase.auth.signOut();
        return;
      }

      const { data: organization, error: orgErr } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', profile.org_id)
        .is('deleted_at', null)
        .single();

      if (!active) return;
      if (orgErr || !organization) {
        console.error('Ferme introuvable pour le profil', orgErr);
        await supabase.auth.signOut();
        return;
      }

      applyBranding(organization);
      setState({ status: 'authenticated', session, profile, organization });
    }

    // onAuthStateChange émet INITIAL_SESSION au montage : un seul listener
    // suffit pour récupérer la session existante ET réagir aux signin/signout.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadFromSession(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      signOut: async () => {
        await supabase.auth.signOut();
        // onAuthStateChange repassera l'état à 'unauthenticated'.
      },
    }),
    [state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession doit être utilisé à l'intérieur de <SessionProvider>.");
  }
  return ctx;
}
