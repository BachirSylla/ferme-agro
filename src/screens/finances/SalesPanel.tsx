import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  Archive,
  X,
  ShoppingCart,
  Trash2,
  Info,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CustomerPicker } from './CustomerPicker';
import {
  PAYMENT_CLASS,
  PAYMENT_LABEL,
  dateShortFmt,
  formatFCFA,
  formatNumberFr,
  qtyFmt,
  todayIso,
} from '@/lib/format';
import type { Enums, Tables } from '@/types/db';

type Sale = Tables<'sales'>;
type SaleItem = Tables<'sale_items'>;
type Product = Tables<'products'>;
type Customer = Tables<'customers'>;
type PaymentMethod = Enums<'payment_method'>;

const STATUSES = ['payee', 'impayee', 'partielle'] as const;
type SaleStatus = (typeof STATUSES)[number];

const STATUS_LABEL: Record<SaleStatus, string> = {
  payee: 'Payée',
  impayee: 'Impayée',
  partielle: 'Partielle',
};
const STATUS_CLASS: Record<SaleStatus, string> = {
  payee: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  impayee: 'bg-red-100 text-red-800 border-red-200',
  partielle: 'bg-amber-100 text-amber-800 border-amber-200',
};

type ItemDraft = {
  product_id: string;
  quantity: string;
  unit_price: string;
  // lot_id : facultatif. Permet le calcul de marge par lot (v_lot_overview).
  // '' = pas de rattachement. Pour les produits sans species (négoce), le
  // sélecteur n'est même pas affiché.
  lot_id: string;
};
type Lot = Tables<'lots'>;

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; sale: Sale; items: SaleItem[] };

export function SalesPanel() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;

  const [sales, setSales] = useState<Sale[] | null>(null);
  const [itemsBySale, setItemsBySale] = useState<Map<string, SaleItem[]>>(new Map());
  const [productsById, setProductsById] = useState<Map<string, Product>>(new Map());
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Lots actifs : nécessaires pour le sélecteur "Lot d'origine" par ligne
  // de vente. Filtrés par species_id du produit (côté form), pour ne pas
  // proposer un lot de cailles avec une vente de miel.
  const [activeLots, setActiveLots] = useState<Lot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const refresh = useCallback(async () => {
    setLoadError(null);
    const [salesRes, itemsRes, prRes, cuRes, lotsRes] = await Promise.all([
      supabase
        .from('sales')
        .select('*')
        .is('deleted_at', null)
        .order('day', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('sale_items').select('*').is('deleted_at', null),
      supabase
        .from('products')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
      supabase
        .from('customers')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
      supabase
        .from('lots')
        .select('*')
        .eq('status', 'actif')
        .is('deleted_at', null)
        .order('code', { ascending: true }),
    ]);
    if (salesRes.error || itemsRes.error || prRes.error || cuRes.error || lotsRes.error) {
      setLoadError(
        salesRes.error?.message ??
          itemsRes.error?.message ??
          prRes.error?.message ??
          cuRes.error?.message ??
          lotsRes.error?.message ??
          'erreur',
      );
      setSales([]);
      return;
    }
    setSales(salesRes.data);
    const map = new Map<string, SaleItem[]>();
    for (const it of itemsRes.data) {
      const arr = map.get(it.sale_id);
      if (arr) arr.push(it);
      else map.set(it.sale_id, [it]);
    }
    setItemsBySale(map);
    setProductsById(new Map(prRes.data.map((p) => [p.id, p])));
    setCustomers(cuRes.data);
    setActiveLots(lotsRes.data ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const products = useMemo(() => Array.from(productsById.values()), [productsById]);

  function startEdit(sale: Sale) {
    setForm({ mode: 'edit', sale, items: itemsBySale.get(sale.id) ?? [] });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600">
          {sales === null
            ? 'Chargement…'
            : `${sales.length} vente${sales.length > 1 ? 's' : ''}`}
        </div>
        {form.mode === 'closed' && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create' })}
            disabled={products.length === 0}
            className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Nouvelle vente
          </button>
        )}
      </div>

      {products.length === 0 && sales !== null && form.mode === 'closed' && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 text-sm flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Créez d'abord un produit dans le <strong>Catalogue</strong> pour pouvoir
            enregistrer une vente.
          </span>
        </div>
      )}

      {form.mode !== 'closed' && (
        <SaleForm
          orgId={orgId}
          products={products}
          productsById={productsById}
          customers={customers}
          activeLots={activeLots}
          initial={form.mode === 'edit' ? { sale: form.sale, items: form.items } : null}
          onClose={() => setForm({ mode: 'closed' })}
          onCustomerCreated={(c) => setCustomers((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name)))}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      )}

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les ventes : {loadError}
        </div>
      )}

      {sales === null ? (
        <ListSkeleton />
      ) : sales.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white border border-neutral-200 overflow-hidden shadow-sm">
          {sales.map((s) => {
            const items = itemsBySale.get(s.id) ?? [];
            const customer = s.customer_id ? customers.find((c) => c.id === s.customer_id) : null;
            const firstName = items[0] ? productsById.get(items[0].product_id)?.name : null;
            const moreCount = items.length - 1;
            const status = STATUSES.includes(s.status as SaleStatus)
              ? (s.status as SaleStatus)
              : null;
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 p-3 hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
                    <ShoppingCart className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">
                        {formatFCFA(s.total)}
                      </span>
                      <PaymentBadge method={s.payment_method} />
                      {status && <StatusBadge status={status} />}
                    </div>
                    <div className="text-xs text-neutral-500 truncate flex items-center gap-1 flex-wrap mt-0.5">
                      <span>{dateShortFmt.format(new Date(s.day))}</span>
                      <span>·</span>
                      <span className={customer ? '' : 'italic'}>
                        {customer?.name ?? 'Comptoir'}
                      </span>
                      {firstName && (
                        <>
                          <span>·</span>
                          <span className="truncate">
                            {firstName}
                            {moreCount > 0 ? ` (+${moreCount})` : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(s)}
                    className="text-sm text-neutral-700 hover:text-neutral-900 px-2 py-1.5 rounded-md hover:bg-neutral-100"
                    aria-label="Éditer"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <ArchiveSale sale={s} onArchived={() => void refresh()} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SaleForm({
  orgId,
  products,
  productsById,
  customers,
  activeLots,
  initial,
  onClose,
  onSaved,
  onCustomerCreated,
}: {
  orgId: string;
  products: Product[];
  productsById: Map<string, Product>;
  customers: Customer[];
  activeLots: Lot[];
  initial: { sale: Sale; items: SaleItem[] } | null;
  onClose: () => void;
  onSaved: () => void;
  onCustomerCreated: (c: Customer) => void;
}) {
  const toast = useToast();
  const isEdit = initial !== null;

  const [day, setDay] = useState(initial?.sale.day ?? todayIso());
  const [customerId, setCustomerId] = useState(initial?.sale.customer_id ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    initial?.sale.payment_method ?? 'cash',
  );
  const [status, setStatus] = useState<SaleStatus>(
    (initial?.sale.status as SaleStatus) ?? 'payee',
  );
  const [items, setItems] = useState<ItemDraft[]>(
    initial
      ? initial.items.map((i) => ({
          product_id: i.product_id,
          quantity: String(i.quantity),
          unit_price: String(i.unit_price),
          lot_id: i.lot_id ?? '',
        }))
      : [{ product_id: '', quantity: '1', unit_price: '0', lot_id: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function selectProduct(idx: number, productId: string) {
    const product = productsById.get(productId);
    updateItem(idx, {
      product_id: productId,
      // Pré-remplit le prix unitaire avec le default_price du produit (sauf en édition,
      // pour ne pas écraser un prix négocié manuellement).
      unit_price: product && !isEdit ? String(product.default_price) : items[idx].unit_price,
      // Reset le lot quand le produit change : un lot rattaché à un produit
      // d'une autre espèce n'aurait plus de sens.
      lot_id: '',
    });
  }

  function addItem() {
    setItems((arr) => [...arr, { product_id: '', quantity: '1', unit_price: '0', lot_id: '' }]);
  }

  function removeItem(idx: number) {
    setItems((arr) => (arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr));
  }

  const lineTotals = items.map((it) => {
    const q = Number.parseFloat(it.quantity.replace(',', '.'));
    const p = Number.parseInt(it.unit_price, 10);
    return Number.isFinite(q) && Number.isFinite(p) ? Math.round(q * p) : 0;
  });
  const total = lineTotals.reduce((a, b) => a + b, 0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (isEdit) {
      // En édition, on ne touche qu'aux métadonnées. Les lignes sont read-only ici
      // (cf. note dans le formulaire) pour éviter la complexité de réconciliation.
      setBusy(true);
      const { error: dbError } = await supabase
        .from('sales')
        .update({
          day,
          customer_id: customerId === '' ? null : customerId,
          payment_method: paymentMethod,
          status,
        })
        .eq('id', initial!.sale.id);
      setBusy(false);
      if (dbError) {
        setError(dbError.message);
        return;
      }
      toast.push('success', 'Vente mise à jour.');
      onSaved();
      return;
    }

    // ─── Création : valider + insertion atomique au mieux ──
    const cleanedItems: {
      product_id: string;
      quantity: number;
      unit_price: number;
      lot_id: string | null;
    }[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const q = Number.parseFloat(it.quantity.replace(',', '.'));
      const p = Number.parseInt(it.unit_price, 10);
      if (!it.product_id) {
        setError(`Ligne ${i + 1} : choisissez un produit.`);
        return;
      }
      if (!Number.isFinite(q) || q <= 0) {
        setError(`Ligne ${i + 1} : quantité invalide.`);
        return;
      }
      if (!Number.isFinite(p) || p < 0) {
        setError(`Ligne ${i + 1} : prix invalide.`);
        return;
      }
      cleanedItems.push({
        product_id: it.product_id,
        quantity: q,
        unit_price: p,
        lot_id: it.lot_id === '' ? null : it.lot_id,
      });
    }
    if (cleanedItems.length === 0) {
      setError('Ajoutez au moins une ligne.');
      return;
    }

    setBusy(true);
    const saleId = crypto.randomUUID();
    const { error: saleErr } = await supabase.from('sales').insert({
      id: saleId,
      org_id: orgId,
      customer_id: customerId === '' ? null : customerId,
      day,
      total,
      payment_method: paymentMethod,
      status,
    });
    if (saleErr) {
      setBusy(false);
      setError(saleErr.message);
      return;
    }

    const { error: itemsErr } = await supabase.from('sale_items').insert(
      cleanedItems.map((it) => ({
        org_id: orgId,
        sale_id: saleId,
        product_id: it.product_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        lot_id: it.lot_id,
      })),
    );

    if (itemsErr) {
      // Rollback : soft-delete la vente orpheline pour ne pas la laisser dans la liste.
      await supabase
        .from('sales')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', saleId);
      setBusy(false);
      setError(`Échec de l'enregistrement des lignes : ${itemsErr.message}`);
      return;
    }

    setBusy(false);
    toast.push('success', `Vente de ${formatFCFA(total)} enregistrée.`);
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{isEdit ? 'Modifier la vente' : 'Nouvelle vente'}</h3>
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
        <CustomerPicker
          orgId={orgId}
          customers={customers}
          value={customerId}
          onChange={setCustomerId}
          onCreated={onCustomerCreated}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Statut</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SaleStatus)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="payee">Payée</option>
            <option value="impayee">Impayée</option>
            <option value="partielle">Partielle</option>
          </select>
        </label>
      </div>

      {isEdit ? (
        <ReadOnlyItems
          items={initial!.items}
          productsById={productsById}
          lotsById={new Map(activeLots.map((l) => [l.id, l]))}
          total={initial!.sale.total}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700">Lignes</span>
            <button
              type="button"
              onClick={addItem}
              className="text-xs text-brand hover:underline flex items-center gap-1"
            >
              <Plus className="h-3 w-3" />
              Ajouter une ligne
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {items.map((it, idx) => {
              const product = productsById.get(it.product_id);
              return (
                <div
                  key={idx}
                  className="rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <select
                      required
                      value={it.product_id}
                      onChange={(e) => selectProduct(idx, e.target.value)}
                      className="flex-1 border border-neutral-300 rounded-lg px-2 py-1.5 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                    >
                      <option value="" disabled>
                        — Produit
                      </option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="p-1.5 text-neutral-400 hover:text-red-700 hover:bg-red-50 rounded-md"
                        aria-label="Supprimer la ligne"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <label className="flex flex-col gap-1 text-xs text-neutral-600">
                      Quantité {product?.unit ? `(${product.unit})` : ''}
                      <input
                        type="text"
                        required
                        inputMode="decimal"
                        pattern="[0-9]+([.,][0-9]+)?"
                        value={it.quantity}
                        onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                        className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-neutral-600">
                      P.U.
                      <div className="relative">
                        <input
                          type="number"
                          required
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={it.unit_price}
                          onChange={(e) => updateItem(idx, { unit_price: e.target.value })}
                          className="w-full border border-neutral-300 rounded-lg px-2 py-1.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-neutral-500 font-medium">
                          FCFA
                        </span>
                      </div>
                    </label>
                    <div className="text-xs text-neutral-700 font-medium pb-1.5 whitespace-nowrap">
                      = {formatNumberFr(lineTotals[idx])}
                    </div>
                  </div>
                  {/* Sélecteur de lot d'origine, facultatif. Masqué si le produit
                      n'a pas d'espèce (négoce) ou s'il n'existe aucun lot actif
                      pertinent. Pas obligatoire : '' = vente non rattachée. */}
                  {(() => {
                    if (!product?.species_id) return null;
                    const relevantLots = activeLots.filter(
                      (l) => l.species_id === product.species_id,
                    );
                    if (relevantLots.length === 0) return null;
                    return (
                      <label className="flex flex-col gap-1 text-xs text-neutral-600">
                        Lot d'origine <span className="text-neutral-400 font-normal">(facultatif)</span>
                        <select
                          value={it.lot_id}
                          onChange={(e) => updateItem(idx, { lot_id: e.target.value })}
                          className="border border-neutral-300 rounded-lg px-2 py-1.5 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                        >
                          <option value="">— Pas de rattachement</option>
                          {relevantLots.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.code}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
        <span className="text-sm text-neutral-700">Total</span>
        <span className="text-lg font-semibold">
          {formatFCFA(isEdit ? initial!.sale.total : total)}
        </span>
      </div>

      {isEdit && (
        <p className="text-xs text-neutral-500 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          Pour modifier les lignes (produits, quantités, prix), archivez cette vente
          et créez-en une nouvelle. Les métadonnées ci-dessus restent éditables.
        </p>
      )}

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
          {isEdit ? 'Mettre à jour' : 'Enregistrer la vente'}
        </button>
      </div>
    </form>
  );
}

function ReadOnlyItems({
  items,
  productsById,
  lotsById,
  total,
}: {
  items: SaleItem[];
  productsById: Map<string, Product>;
  lotsById: Map<string, Lot>;
  total: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-neutral-700">Lignes (lecture seule)</span>
      <ul className="rounded-xl border border-neutral-200 bg-neutral-50 divide-y divide-neutral-200 overflow-hidden">
        {items.map((it) => {
          const product = productsById.get(it.product_id);
          const line = Math.round(it.quantity * it.unit_price);
          const lot = it.lot_id ? lotsById.get(it.lot_id) : null;
          return (
            <li key={it.id} className="p-2.5 flex items-center justify-between gap-3 text-sm">
              <span className="truncate">
                {product?.name ?? 'Produit inconnu'}{' '}
                <span className="text-neutral-500">
                  · {qtyFmt.format(it.quantity)} {product?.unit ?? ''} ×{' '}
                  {formatNumberFr(it.unit_price)}
                </span>
                {lot && (
                  <span className="ml-1 inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md border bg-brand/10 text-brand border-brand/20">
                    → {lot.code}
                  </span>
                )}
              </span>
              <span className="font-medium whitespace-nowrap">{formatNumberFr(line)}</span>
            </li>
          );
        })}
      </ul>
      <div className="text-xs text-neutral-500 text-right">
        Total figé à {formatFCFA(total)}
      </div>
    </div>
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

function StatusBadge({ status }: { status: SaleStatus }) {
  return (
    <span
      className={
        'inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md border ' +
        STATUS_CLASS[status]
      }
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function ArchiveSale({ sale, onArchived }: { sale: Sale; onArchived: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    // On archive la vente. Les sale_items restent (leur filtrage côté lecture passe
    // par leur sale_id → la vente archivée n'apparaît plus).
    const { error: dbError } = await supabase
      .from('sales')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', sale.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', 'Vente archivée.');
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
        title="Archiver cette vente ?"
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

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 flex flex-col items-center text-center gap-3">
      <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand grid place-items-center">
        <ShoppingCart className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">Aucune vente</div>
        <p className="text-sm text-neutral-600 mt-0.5">
          Enregistrez votre première vente pour suivre les revenus.
        </p>
      </div>
    </div>
  );
}
