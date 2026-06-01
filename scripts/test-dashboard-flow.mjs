// Test des SOURCES DE DONNÉES du Dashboard contre Supabase hébergé.
// Ne rend pas la React UI, mais reproduit exactement les 4 requêtes que fait
// DashboardScreen.tsx et vérifie la cohérence des chiffres avec les données saisies.
// Si ce test passe, les chiffres affichés par le dashboard sont mécaniquement bons.

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
const email = `claude-dash-test-${Date.now()}@mailinator.com`;
const today = new Date().toISOString().slice(0, 10);
const firstOfMonth = `${today.slice(0, 7)}-01`;

console.log(`[setup] signUp + catalogue + lot + transactions`);
const { data: su, error: suErr } = await sb.auth.signUp({ email, password: 'TestPassword123!' });
if (suErr || !su.session) { console.error('  ✗', suErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', su.user.id).single()).data.org_id;

const { data: cailles } = await sb.from('species').insert({ org_id: orgId, name: 'Cailles' }).select().single();
const { data: oeufs } = await sb.from('products').insert({ org_id: orgId, species_id: cailles.id, name: 'Œufs de caille', unit: 'unite', default_price: 100 }).select().single();
const { data: miel } = await sb.from('products').insert({ org_id: orgId, species_id: null, name: 'Miel', unit: 'litre', default_price: 5000 }).select().single();
const { data: lot } = await sb.from('lots').insert({ org_id: orgId, species_id: cailles.id, code: 'LOT-CAILLES-001', initial_count: 200, current_count: 196, status: 'actif' }).select().single();

// Vente du jour 7000 (30 œufs × 100 + 1 miel × 4000), Wave, payée
const saleId = crypto.randomUUID();
await sb.from('sales').insert({ id: saleId, org_id: orgId, day: today, total: 7000, payment_method: 'wave', status: 'payee' });
await sb.from('sale_items').insert([
  { org_id: orgId, sale_id: saleId, product_id: oeufs.id, quantity: 30, unit_price: 100 },
  { org_id: orgId, sale_id: saleId, product_id: miel.id, quantity: 1, unit_price: 4000 },
]);

// Dépenses : aliment 46000 imputé lot + achat marchandise 3000 sans lot
await sb.from('expenses').insert([
  { org_id: orgId, lot_id: lot.id, day: today, category: 'aliment', amount: 46000, supplier: 'X', payment_method: 'cash' },
  { org_id: orgId, lot_id: null, day: today, category: 'achat marchandise', amount: 3000, payment_method: 'cash' },
]);

// Production du jour : 162 ponte + 8 casse sur le lot
await sb.from('production_records').insert([
  { org_id: orgId, lot_id: lot.id, product_id: oeufs.id, day: today, quantity: 162, category: 'ponte' },
  { org_id: orgId, lot_id: lot.id, product_id: oeufs.id, day: today, quantity: 8, category: 'casse' },
]);
console.log('  ✓ setup prêt');

// ─── 1) v_financial_summary du mois courant ─────────────────
console.log('\n[1] v_financial_summary pour mois =', firstOfMonth);
const { data: sumRow, error: sumErr } = await sb
  .from('v_financial_summary')
  .select('*')
  .eq('mois', firstOfMonth)
  .maybeSingle();
if (sumErr) { console.error('  ✗', sumErr.message); process.exit(1); }
if (!sumRow) { console.error('  ✗ pas de ligne pour ce mois'); process.exit(1); }
console.log('  → revenus =', sumRow.revenus, ', depenses =', sumRow.depenses, ', benefice =', sumRow.benefice);
const expRev = 7000;
const expDep = 46000 + 3000; // toutes dépenses du mois en cash
const expBen = expRev - expDep;
if (sumRow.revenus !== expRev) { console.error(`  ✗ revenus attendu ${expRev}, reçu ${sumRow.revenus}`); process.exit(1); }
if (sumRow.depenses !== expDep) { console.error(`  ✗ depenses attendu ${expDep}, reçu ${sumRow.depenses}`); process.exit(1); }
if (sumRow.benefice !== expBen) { console.error(`  ✗ benefice attendu ${expBen}, reçu ${sumRow.benefice}`); process.exit(1); }
console.log(`  ✓ revenus=${expRev}, depenses=${expDep}, benefice=${expBen}`);

// ─── 2) Production du jour ──────────────────────────────────
console.log('\n[2] production_records day =', today);
const { data: prod } = await sb
  .from('production_records')
  .select('quantity, category')
  .eq('day', today)
  .is('deleted_at', null);
console.log('  → saisies :', prod);
const byCat = prod.reduce((acc, r) => {
  acc[r.category] = (acc[r.category] ?? 0) + r.quantity;
  return acc;
}, {});
console.log('  → groupé :', byCat);
if (byCat.ponte !== 162) { console.error('  ✗ ponte attendu 162'); process.exit(1); }
if (byCat.casse !== 8) { console.error('  ✗ casse attendu 8'); process.exit(1); }
console.log('  ✓ Ponte=162, Casse=8 (2 saisies)');

// ─── 3) v_lot_overview pour les lots actifs ─────────────────
console.log('\n[3] v_lot_overview actifs');
const { data: lots } = await sb
  .from('v_lot_overview')
  .select('*')
  .eq('status', 'actif')
  .order('cout_total', { ascending: false, nullsFirst: false })
  .limit(5);
console.log('  → lots :', lots);
if (lots.length !== 1) { console.error('  ✗ 1 lot attendu'); process.exit(1); }
const l = lots[0];
if (l.code !== 'LOT-CAILLES-001') { console.error('  ✗ code inattendu'); process.exit(1); }
// total_produit = 162 + 8 = 170 (somme des quantités du lot)
if (Number(l.total_produit) !== 170) { console.error(`  ✗ total_produit attendu 170, reçu ${l.total_produit}`); process.exit(1); }
// cout_total = depenses_directes (46000) + cout_intrants (0) + cout_sante (0)
if (l.cout_total !== 46000) { console.error(`  ✗ cout_total attendu 46000, reçu ${l.cout_total}`); process.exit(1); }
console.log(`  ✓ LOT-CAILLES-001 : produit=170, cout_total=46000 FCFA`);

// ─── 4) Ventes récentes ─────────────────────────────────────
console.log('\n[4] sales récentes');
const { data: sales } = await sb
  .from('sales')
  .select('total, payment_method, day')
  .is('deleted_at', null)
  .order('day', { ascending: false })
  .order('created_at', { ascending: false })
  .limit(5);
console.log('  → ventes :', sales);
if (sales.length !== 1) { console.error('  ✗ 1 vente attendue'); process.exit(1); }
if (sales[0].total !== 7000) { console.error('  ✗ total attendu 7000'); process.exit(1); }
if (sales[0].payment_method !== 'wave') { console.error('  ✗ paiement attendu wave'); process.exit(1); }
console.log('  ✓ 1 vente : 7000 FCFA Wave');

// ─── Cohérence croisée : on N'ADDITIONNE PAS cout_total du lot avec depenses ──
console.log('\n[cohérence] dépenses mois (49000) vs cout_total lot (46000)');
console.log('  → ce sont 2 vues métier distinctes :');
console.log('    - v_financial_summary.depenses = 49000 (total cash : aliment 46000 + marchandise 3000)');
console.log('    - v_lot_overview.cout_total = 46000 (uniquement ce qui est imputé au lot)');
console.log('  → 3000 (achat marchandise / négoce) reste DANS les dépenses mois mais HORS coût du lot. OK.');

await sb.auth.signOut();
console.log('\n=== TEST DASHBOARD PASS ===');
console.log('Les 4 requêtes du dashboard retournent les chiffres attendus.');
console.log('Les conventions négoce vs ferme sont respectées par les vues.');
