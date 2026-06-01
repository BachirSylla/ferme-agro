import { SessionProvider, useSession } from '@/context/SessionContext';
import { AuthScreen } from '@/screens/AuthScreen';
import { AppShell } from '@/screens/AppShell';

function Gate() {
  const session = useSession();
  if (session.status === 'loading') {
    return (
      <main className="min-h-full grid place-items-center">
        <div className="text-sm text-neutral-500">Chargement…</div>
      </main>
    );
  }
  if (session.status === 'unauthenticated') return <AuthScreen />;
  return <AppShell />;
}

export default function App() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
