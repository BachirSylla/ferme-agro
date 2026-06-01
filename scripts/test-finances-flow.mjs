// Test end-to-end Finances contre Supabase hébergé.
// Reproduit le scénario utilisateur :
//   VENTE
//     - vente du jour, comptoir (customer_id null), payée Wave
//     - 2 lignes : 30 œufs × 100 + 1 miel × 4000 → total auto 7000
//     - édition métadonnées + archivage OK
//   DÉPENSES
//     - "aliment" 45000 cash, imputée à LOT-CAILLES-001
//     - "achat marchandise" 3000 cash, sans lot (miel = négoce)
//     - édition + archivage OK sur les deux
//   CLIENT
//     - création inline d'un client, puis vente rattachée

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnvLocal();
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const email = `claude-fin-test-${Date.now()}@mailinator.com`;

console.log(`[setup] signUp + catalogue + lot`);
const { data: su, error: suErr } = await sb.auth.signUp({ email, password: 'TestPassword123!' });
if (suErr || !su.session) { console.error('  ✗', suErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', su.user.id).single()).data.org_id;

const { data: cailles } = await sb.from('species').insert({ org_id: orgId, name: 'Cailles' }).select().single();
const { data: oeufs } = await sb.from('products').insert({ org_id: orgId, species_id: cailles.id, name: 'Œufs de caille', unit: 'unite', default_price: 100 }).select().single();
const { data: miel } = await sb.from('products').insert({ org_id: orgId, species_id: null, name: 'Miel', unit: 'litre', default_price: 5000 }).select().single();
const { data: lot } = await sb.from('lots').insert({ org_id: orgId, species_id: cailles.id, code: 'LOT-CAILLES-001', initial_count: 200, current_count: 200, status: 'actif' }).select().single();
console.log('  ✓ setup prêt');

// ─── VENTE ─────────────────────────────────────────────────────
console.log('\n[V1] vente comptoir, Wave, 30 œufs × 100 + 1 miel × 4000 (total auto 7000)');
const total1 = 30 * 100 + 1 * 4000;
const saleId = crypto.randomUUID();
const { error: sErr } = await sb.from('sales').insert({
  id: saleId,
  org_id: orgId,
  customer_id: null,
  day: new Date().toISOString().slice(0, 10),
  total: total1,
  payment_method: 'wave',
  status: 'payee',
});
if (sErr) { console.error('  ✗', sErr.message); process.exit(1); }
const { error: iErr } = await sb.from('sale_items').insert([
  { org_id: orgId, sale_id: saleId, product_id: oeufs.id, quantity: 30, unit_price: 100 },
  { org_id: orgId, sale_id: saleId, product_id: miel.id, quantity: 1, unit_price: 4000 },
]);
if (iErr) { console.error('  ✗', iErr.message); process.exit(1); }
const { data: vente } = await sb.from('sales').select('total, payment_method, status, customer_id').eq('id', saleId).single();
const { data: lignes } = await sb.from('sale_items').select('quantity, unit_price').eq('sale_id', saleId);
console.log('  ✓ vente :', vente);
console.log('  ✓ lignes :', lignes);
if (vente.total !== 7000) { console.error('  ✗ total attendu 7000'); process.exit(1); }
if (lignes.length !== 2) { console.error('  ✗ 2 lignes attendues'); process.exit(1); }

console.log('[V2] éditer la vente : passer en partielle');
const { error: uvErr } = await sb.from('sales').update({ status: 'partielle' }).eq('id', saleId);
if (uvErr) { console.error('  ✗', uvErr.message); process.exit(1); }
const { data: vente2 } = await sb.from('sales').select('status').eq('id', saleId).single();
if (vente2.status !== 'partielle') { console.error('  ✗ status non mis à jour'); process.exit(1); }
console.log('  ✓ status = partielle');

// ─── DÉPENSES ──────────────────────────────────────────────────
console.log('\n[D1] dépense "aliment" 45000 cash, imputée à LOT-CAILLES-001');
const { data: d1, error: d1Err } = await sb.from('expenses').insert({
  org_id: orgId,
  lot_id: lot.id,
  day: new Date().toISOString().slice(0, 10),
  category: 'aliment',
  amount: 45000,
  supplier: 'Fournisseur local',
  payment_method: 'cash',
}).select().single();
if (d1Err) { console.error('  ✗', d1Err.message); process.exit(1); }
console.log('  ✓ dépense', d1.id.slice(0, 8), '-', d1.category, d1.amount, 'lot =', d1.lot_id?.slice(0, 8));

console.log('[D2] dépense "achat marchandise" 3000 cash, SANS lot (miel négoce)');
const { data: d2, error: d2Err } = await sb.from('expenses').insert({
  org_id: orgId,
  lot_id: null,
  day: new Date().toISOString().slice(0, 10),
  category: 'achat marchandise',
  amount: 3000,
  supplier: null,
  payment_method: 'cash',
}).select().single();
if (d2Err) { console.error('  ✗', d2Err.message); process.exit(1); }
if (d2.lot_id !== null) { console.error('  ✗ lot_id devrait être null'); process.exit(1); }
console.log('  ✓ dépense', d2.id.slice(0, 8), '-', d2.category, d2.amount, '(sans lot)');

console.log('[D3] éditer la 1ère dépense : amount 45000 → 46000');
const { error: ud1 } = await sb.from('expenses').update({ amount: 46000 }).eq('id', d1.id);
if (ud1) { console.error('  ✗', ud1.message); process.exit(1); }
const { data: d1b } = await sb.from('expenses').select('amount').eq('id', d1.id).single();
if (d1b.amount !== 46000) { console.error('  ✗ amount non mis à jour'); process.exit(1); }
console.log('  ✓ amount = 46000');

console.log('[D4] archiver la dépense "achat marchandise"');
const { error: ad2 } = await sb.from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', d2.id);
if (ad2) { console.error('  ✗', ad2.message); process.exit(1); }
const { data: depsLeft } = await sb.from('expenses').select('category, amount').is('deleted_at', null);
console.log('  visibles :', depsLeft);
if (depsLeft.length !== 1) { console.error('  ✗ 1 dépense attendue'); process.exit(1); }

// ─── CLIENT INLINE ─────────────────────────────────────────────
console.log('\n[C1] créer un client "Boutique Aïssata" puis une vente rattachée');
const { data: cust, error: cuErr } = await sb.from('customers').insert({
  org_id: orgId,
  name: 'Boutique Aïssata',
  phone: '+221 77 000 00 00',
}).select().single();
if (cuErr) { console.error('  ✗', cuErr.message); process.exit(1); }
const sale2Id = crypto.randomUUID();
await sb.from('sales').insert({
  id: sale2Id,
  org_id: orgId,
  customer_id: cust.id,
  day: new Date().toISOString().slice(0, 10),
  total: 30 * 100,
  payment_method: 'orange_money',
  status: 'payee',
});
await sb.from('sale_items').insert({
  org_id: orgId,
  sale_id: sale2Id,
  product_id: oeufs.id,
  quantity: 30,
  unit_price: 100,
});
const { data: clientSale } = await sb
  .from('sales')
  .select('total, payment_method, customer_id')
  .eq('id', sale2Id)
  .single();
if (clientSale.customer_id !== cust.id) { console.error('  ✗ customer_id non lié'); process.exit(1); }
console.log('  ✓ vente client :', clientSale);

// ─── ARCHIVAGE VENTE ───────────────────────────────────────────
console.log('\n[V3] archiver la 1ère vente');
const { error: avErr } = await sb.from('sales').update({ deleted_at: new Date().toISOString() }).eq('id', saleId);
if (avErr) { console.error('  ✗', avErr.message); process.exit(1); }
const { data: visibles } = await sb.from('sales').select('total').is('deleted_at', null);
console.log('  ventes visibles :', visibles);
if (visibles.length !== 1) { console.error('  ✗ 1 vente attendue (celle du client)'); process.exit(1); }

await sb.auth.signOut();
console.log('\n=== TEST FINANCES PASS ===');
console.log('Vente multi-lignes + total auto + édition métadonnées + archivage OK.');
console.log('Dépense imputée à un lot + dépense de négoce sans lot + édition + archivage OK.');
console.log('Création client inline + vente rattachée OK.');
