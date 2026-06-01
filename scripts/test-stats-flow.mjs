// Test des sources de données du StatsScreen contre Supabase hébergé.
// Reproduit les 2 requêtes que fait l'écran Stats :
//   - v_financial_summary multi-mois (.in('mois', [...]))
//   - production_records sur la période (.gte / .lte sur day)
// Vérifie que les chiffres du mois courant (juin) sont cohérents avec ceux
// du tableau de bord (revenus 7000 / cout_total 46000 dans test-dashboard).

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

function firstOfMonthIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function addMonthsIso(yyyymm01, n) {
  const [y, m] = yyyymm01.split('-').map(Number);
  return firstOfMonthIso(new Date(y, m - 1 + n, 1));
}

function lastOfMonthIso(yyyymm01) {
  const [y, m] = yyyymm01.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const env = loadEnvLocal();
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const email = `claude-stats-test-${Date.now()}@mailinator.com`;
const today = new Date().toISOString().slice(0, 10);

console.log(`[setup] signUp + catalogue + lot + transactions juin`);
const { data: su, error: suErr } = await sb.auth.signUp({ email, password: 'TestPassword123!' });
if (suErr || !su.session) { console.error('  ✗', suErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', su.user.id).single()).data.org_id;

const { data: cailles } = await sb.from('species').insert({ org_id: orgId, name: 'Cailles' }).select().single();
const { data: oeufs } = await sb.from('products').insert({ org_id: orgId, species_id: cailles.id, name: 'Œufs de caille', unit: 'unite', default_price: 100 }).select().single();
const { data: lot } = await sb.from('lots').insert({ org_id: orgId, species_id: cailles.id, code: 'LOT-CAILLES-001', initial_count: 200, current_count: 196, status: 'actif' }).select().single();

const saleId = crypto.randomUUID();
await sb.from('sales').insert({ id: saleId, org_id: orgId, day: today, total: 7000, payment_method: 'wave', status: 'payee' });
await sb.from('sale_items').insert({ org_id: orgId, sale_id: saleId, product_id: oeufs.id, quantity: 30, unit_price: 100 });
await sb.from('expenses').insert([
  { org_id: orgId, lot_id: lot.id, day: today, category: 'aliment', amount: 46000, payment_method: 'cash' },
  { org_id: orgId, lot_id: null, day: today, category: 'achat marchandise', amount: 3000, payment_method: 'cash' },
]);
await sb.from('production_records').insert([
  { org_id: orgId, lot_id: lot.id, product_id: oeufs.id, day: today, quantity: 162, category: 'ponte' },
  { org_id: orgId, lot_id: lot.id, product_id: oeufs.id, day: today, quantity: 8, category: 'casse' },
]);
console.log('  ✓ setup');

// ─── Range 12 mois ──────────────────────────────────────────
console.log('\n[A] Mode "12 derniers mois"');
const end = firstOfMonthIso();
const months12 = Array.from({ length: 12 }, (_, i) => addMonthsIso(end, -(11 - i)));
console.log('  mois ciblés :', months12.slice(0, 3).join(', '), '… →', months12[11]);

const startDay = months12[0];
const endDay = lastOfMonthIso(months12[11]);

const [sumRes, prodRes] = await Promise.all([
  sb.from('v_financial_summary').select('*').in('mois', months12).order('mois'),
  sb.from('production_records').select('day, quantity, category').gte('day', startDay).lte('day', endDay).is('deleted_at', null),
]);
if (sumRes.error) { console.error('  ✗ summary', sumRes.error.message); process.exit(1); }
if (prodRes.error) { console.error('  ✗ production', prodRes.error.message); process.exit(1); }
console.log('  v_financial_summary →', sumRes.data.length, 'mois retournés');
console.log('  production_records →', prodRes.data.length, 'saisies sur la période');

const juneRow = sumRes.data.find((r) => r.mois?.startsWith(today.slice(0, 7)));
if (!juneRow) { console.error('  ✗ pas de ligne pour le mois courant'); process.exit(1); }
console.log('  → mois courant :', { revenus: juneRow.revenus, depenses: juneRow.depenses, benefice: juneRow.benefice });
if (juneRow.revenus !== 7000 || juneRow.depenses !== 49000 || juneRow.benefice !== -42000) {
  console.error('  ✗ chiffres inattendus');
  process.exit(1);
}
console.log('  ✓ Juin : 7000 / 49000 / -42000');

// Agrégation production par mois client-side (logique de l'écran)
const byMonth = new Map();
for (const p of prodRes.data) {
  const m = `${p.day.slice(0, 7)}-01`;
  const cur = byMonth.get(m) ?? { ponte: 0, casse: 0, consomme: 0, recolte: 0 };
  cur[p.category] += p.quantity;
  byMonth.set(m, cur);
}
console.log('  agrégation production par mois (client-side) :');
for (const [m, agg] of byMonth) {
  console.log(`    ${m}`, agg);
}

// ─── Range 6 mois ───────────────────────────────────────────
console.log('\n[B] Mode "6 derniers mois"');
const months6 = Array.from({ length: 6 }, (_, i) => addMonthsIso(end, -(5 - i)));
const { data: sum6 } = await sb.from('v_financial_summary').select('*').in('mois', months6).order('mois');
console.log('  → mois retournés :', sum6.length, '/ attendu ≤ 6');
if (sum6.length > 6) { console.error('  ✗ trop de mois'); process.exit(1); }

// ─── Navigate sur mois passé ────────────────────────────────
console.log('\n[C] Mode "Mois précis" : mois précédent');
const prevMonth = addMonthsIso(end, -1);
const { data: prevSum } = await sb.from('v_financial_summary').select('*').eq('mois', prevMonth).maybeSingle();
console.log('  → mois précédent :', prevMonth, '→', prevSum ? 'data' : 'null (vide attendu si pas d\'activité)');

await sb.auth.signOut();
console.log('\n=== TEST STATS PASS ===');
console.log('Requêtes multi-mois (.in) + range jour OK.');
console.log('Mois courant cohérent avec ce que le dashboard affiche.');
