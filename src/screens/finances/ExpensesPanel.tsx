import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Plus, Pencil, Archive, X, Receipt } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  PAYMENT_CLASS,
  PAYMENT_LABEL,
  dateShortFmt,
  todayIso,
  xofFmt,
} from '@/lib/format';
import type { Enums, Tables } from '@/types/db';

type Expense = Tables<'expenses'>;
type Lot = Tables<'lots'>;
type PaymentMethod = Enums<'payment_method'>;

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; expense: Expense };

// Quelques catégories suggérées pour datalist — l'utilisateur reste libre.
const SUGGESTED_CATEGORIES = [
  'aliment',
  'achat marchandise',
  'transport',
  'vétérinaire',
  'main d\u2019œuvre',
  'maintenance',
  'autre',
];

export function ExpensesPanel() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;

  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [lotsById, setLotsById] = useState<Map<string, Lot>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const refresh = useCallback(async () => {
    setLoadError(null);
    const [expRes, lotRes] = await Promise.all([
      supabase
        .from('expenses')
        .select('*')
        .is('deleted_at', null)
        .order('day', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('lots')
        .select('*')
        .is('deleted_at', null)
        .order('code', { ascending: true }),
    ]);
    if (expRes.error || lotRes.error) {
      setLoadError(expRes.error?.message ?? lotRes.error?.message ?? 'erreur');
      setExpenses([]);
      return;
    }
    setExpenses(expRes.data);
    setLotsById(new Map(lotRes.data.map((l) => [l.id, l])));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lots = useMemo(() => Array.from(lotsById.values()), [lotsById]);
  const totalSum = useMemo(
    () => (expenses ?? []).reduce((s, e) => s + e.amount, 0),
    [expenses],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600">
          {expenses === null
            ? 'Chargement…'
            : `${expenses.length} dépense${expenses.length > 1 ? 's' : ''} · total ${xofFmt.format(totalSum)} FCFA`}
        </div>
        {form.mode === 'closed' && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create' })}
            className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nouvelle dépense
          </button>
        )}
      </div>

      {form.mode !== 'closed' && (
        <ExpenseForm
          orgId={orgId}
          lots={lots}
          initial={form.mode === 'edit' ? form.expense : null}
          onClose={() => setForm({ mode: 'closed' })}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      )}

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les dépenses : {loadError}
        </div>
      )}

      {expenses === null ? (
        <ListSkeleton />
      ) : expenses.length === 0 ? (
        <EmptyState onCreate={() => setForm({ mode: 'create' })} />
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white border border-neutral-200 overflow-hidden shadow-sm">
          {expenses.map((e) => {
            const lot = e.lot_id ? lotsById.get(e.lot_id) : null;
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 p-3 hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
                    <Receipt className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">
                        {xofFmt.format(e.amount)} FCFA
                      </span>
                      <PaymentBadge method={e.payment_method} />
                    </div>
                    <div className="text-xs text-neutral-500 truncate flex items-center gap-1 flex-wrap mt-0.5">
                      <span className="rounded-md bg-neutral-100 px-1.5 py-0.5">
                        {e.category}
                      </span>
                      <span>·</span>
                      <span>{dateShortFmt.format(new Date(e.day))}</span>
                      {e.supplier && (
                        <>
                          <span>·</span>
                          <span className="truncate">{e.supplier}</span>
                        </>
                      )}
                      {lot ? (
                        <>
                          <span>·</span>
                          <span className="rounded-md bg-neutral-100 px-1.5 py-0.5">
                            {lot.code}
                          </span>
                        </>
                      ) : e.lot_id ? (
                        <>
                          <span>·</span>
                          <span className="italic">lot archivé</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setForm({ mode: 'edit', expense: e })}
                    className="text-sm text-neutral-700 hover:text-neutral-900 px-2 py-1.5 rounded-md hover:bg-neutral-100"
                    aria-label="Éditer"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <ArchiveExpense expense={e} onArchived={() => void refresh()} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ExpenseForm({
  orgId,
  lots,
  initial,
  onClose,
  onSaved,
}: {
  orgId: string;
  lots: Lot[];
  initial: Expense | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = initial !== null;

  const [day, setDay] = useState(initial?.day ?? todayIso());
  const [category, setCategory] = useState(initial?.category ?? '');
  const [amount, setAmount] = useState(String(initial?.amount ?? 0));
  const [supplier, setSupplier] = useState(initial?.supplier ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    initial?.payment_method ?? 'cash',
  );
  const [lotId, setLotId] = useState(initial?.lot_id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const amt = Number.parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Le montant doit être un entier positif (FCFA, sans décimales).');
      return;
    }
    if (category.trim() === '') {
      setError('La catégorie est requise.');
      return;
    }
    setBusy(true);
    const payload = {
      day,
      category: category.trim(),
      amount: amt,
      supplier: supplier.trim() === '' ? null : supplier.trim(),
      payment_method: paymentMethod,
      lot_id: lotId === '' ? null : lotId,
    };
    const { error: dbError } = initial
      ? await supabase.from('expenses').update(payload).eq('id', initial.id)
      : await supabase.from('expenses').insert({ ...payload, org_id: orgId });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    toast.push('success', isEdit ? 'Dépense mise à jour.' : 'Dépense enregistrée.');
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{isEdit ? 'Modifier la dépense' : 'Nouvelle dépense'}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-800 p-1 rounded-md hover:bg-neutral-100"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Date</span>
          <input
            type="date"
            required
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Mode de paiement</span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="cash">Espèces</option>
            <option value="wave">Wave</option>
            <option value="orange_money">Orange Money</option>
            <option value="autre">Autre</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Catégorie</span>
          <input
            type="text"
            required
            autoFocus
            list="expense-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="aliment, transport, achat marchandise…"
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <datalist id="expense-categories">
            {SUGGESTED_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Montant</span>
          <div className="relative">
            <input
              type="number"
              required
              min={0}
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 pr-14 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 font-medium">
              FCFA
            </span>
          </div>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Fournisseur <span className="text-neutral-400 font-normal">(facultatif)</span>
          </span>
          <input
            type="text"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Nom du fournisseur"
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Imputer à un lot <span className="text-neutral-400 font-normal">(facultatif)</span>
          </span>
          <select
            value={lotId}
            onChange={(e) => setLotId(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="">— Sans lot</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded-lg text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={busy}
          className="bg-brand text-brand-fg rounded-lg px-4 py-1.5 text-sm font-medium hover:opacity-95 disabled:opacity-60 flex items-center gap-2"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? 'Mettre à jour' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

function PaymentBadge({ method }: { method: PaymentMethod }) {
  return (
    <span
      className={
        'inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md border ' +
        PAYMENT_CLASS[method]
      }
    >
      {PAYMENT_LABEL[method]}
    </span>
  );
}

function ArchiveExpense({ expense, onArchived }: { expense: Expense; onArchived: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('expenses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', expense.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', 'Dépense archivée.');
    setOpen(false);
    onArchived();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-red-700 hover:text-red-900 px-2 py-1.5 rounded-md hover:bg-red-50"
        aria-label="Archiver"
      >
        <Archive className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={open}
        title="Archiver cette dépense ?"
        message="Elle n'apparaîtra plus dans la liste mais reste dans l'historique en base."
        confirmLabel="Archiver"
        busy={busy}
        onConfirm={() => void archive()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white border border-neutral-200 overflow-hidden">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 p-3">
          <div className="h-10 w-10 rounded-xl bg-neutral-200 animate-pulse" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="h-3 w-1/3 bg-neutral-200 rounded animate-pulse" />
            <div className="h-2 w-1/2 bg-neutral-100 rounded animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 flex flex-col items-center text-center gap-3">
      <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand grid place-items-center">
        <Receipt className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">Aucune dépense</div>
        <p className="text-sm text-neutral-600 mt-0.5">
          Suivez vos sorties d'argent : aliment, transport, achats de marchandise…
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="bg-brand text-brand-fg rounded-lg px-4 py-2 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
      >
        <Plus className="h-4 w-4" />
        Nouvelle dépense
      </button>
    </div>
  );
}
