import { useState } from 'react';
import { Loader2, Plus, User, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import type { Tables } from '@/types/db';

type Customer = Tables<'customers'>;

type Props = {
  orgId: string;
  customers: Customer[];
  value: string; // '' = comptoir (sans client)
  onChange: (id: string) => void;
  onCreated: (c: Customer) => void;
};

// Picker compact pour le formulaire vente : choisit un client existant OU permet
// d'en créer un à la volée sans quitter la vente.
export function CustomerPicker({ orgId, customers, value, onChange, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700">
          Client <span className="text-neutral-400 font-normal">(facultatif)</span>
        </span>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs text-brand hover:underline flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Nouveau client
          </button>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      >
        <option value="">— Sans client (comptoir)</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {open && (
        <InlineCustomerForm
          orgId={orgId}
          onCancel={() => setOpen(false)}
          onCreated={(c) => {
            onCreated(c);
            onChange(c.id);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function InlineCustomerForm({
  orgId,
  onCancel,
  onCreated,
}: {
  orgId: string;
  onCancel: () => void;
  onCreated: (c: Customer) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { data, error: dbError } = await supabase
      .from('customers')
      .insert({
        org_id: orgId,
        name: name.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
      })
      .select()
      .single();
    setBusy(false);
    if (dbError || !data) {
      setError(dbError?.message ?? 'erreur');
      return;
    }
    toast.push('success', `Client « ${data.name} » créé.`);
    onCreated(data);
  }

  // Note : `nested form` interdit en HTML → on rend un <div> et on déclenche
  // le save au clic du bouton (pas de <form> imbriqué dans le formulaire vente).
  return (
    <div className="mt-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
          <User className="h-4 w-4" />
          Nouveau client
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-neutral-500 hover:text-neutral-800 p-0.5"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        type="text"
        required
        placeholder="Nom"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border border-neutral-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
      <input
        type="tel"
        inputMode="tel"
        placeholder="Téléphone (facultatif)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="border border-neutral-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
      {error && (
        <div role="alert" className="text-xs bg-red-50 text-red-800 border border-red-200 rounded-md px-2 py-1">
          {error}
        </div>
      )}
      <button
        type="button"
        disabled={busy || name.trim() === ''}
        onClick={(e) => void save(e)}
        className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Créer le client
      </button>
    </div>
  );
}
