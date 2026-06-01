import { SessionProvider, useSession } from '@/context/SessionContext';
import { ToastProvider } from '@/context/ToastContext';
import { AuthScreen } from '@/screens/AuthScreen';
import { AppShell } from '@/screens/AppShell';
import { Loader2 } from 'lucide-react';

function Gate() {
  const session = useSession();
  if (session.status === 'loading') {
    return (
      <main className="min-h-full grid place-items-center text-neutral-500">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement…
        </div>
      </main>
    );
  }
  if (session.status === 'unauthenticated') return <AuthScreen />;
  return <AppShell />;
}

export default function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </ToastProvider>
  );
}
