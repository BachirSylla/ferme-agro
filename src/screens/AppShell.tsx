import { useSession } from '@/context/SessionContext';

export function AppShell() {
  const session = useSession();
  // Gate parent garantit qu'on n'arrive ici qu'authentifié — narrow pour TS.
  if (session.status !== 'authenticated') return null;

  const { profile, organization, signOut } = session;
  const userLabel = profile.full_name ?? session.session.user.email ?? 'utilisateur';

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-brand text-brand-fg px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {organization.logo_url ? (
            <img
              src={organization.logo_url}
              alt=""
              className="h-10 w-10 rounded-lg object-cover bg-white/10"
            />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-white/15 grid place-items-center font-bold">
              {organization.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-semibold leading-tight truncate">{organization.name}</div>
            {organization.slogan && (
              <div className="text-xs opacity-80 leading-tight truncate">
                {organization.slogan}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg shrink-0"
        >
          Déconnexion
        </button>
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        <p className="text-sm text-neutral-500 mb-4">Connecté en tant que {userLabel}</p>
        <section className="rounded-2xl bg-white border border-neutral-200 p-6">
          <h2 className="text-lg font-semibold mb-2">Tableau de bord</h2>
          <p className="text-neutral-600">
            Bientôt : production du jour, stocks bas, ventes récentes, marge par lot.
          </p>
        </section>
      </main>
    </div>
  );
}
