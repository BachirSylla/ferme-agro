// Test end-to-end du catalogue contre le projet Supabase hébergé.
// Reproduit le scénario de validation utilisateur :
//   - créer une espèce "Cailles" (volaille)
//   - créer un produit "Œufs de caille" rattaché à Cailles
//   - créer un produit "Miel" SANS espèce (species_id = null)
//   - lister : les 3 doivent apparaître
//   - archiver "Miel", relister : Miel doit disparaître
//
// Lance après .env.local renseigné :
//   node scripts/test-catalogue-flow.mjs

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnvLocal();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const email = `claude-cat-test-${Date.now()}@mailinator.com`;
const password = 'TestPassword123!';

console.log(`[1] signUp ${email}`);
const { data: signUp, error: signUpErr } = await supabase.auth.signUp({ email, password });
if (signUpErr || !signUp.session) {
  console.error('  ✗ signUp:', signUpErr?.message ?? 'no session');
  process.exit(1);
}
const orgId = (
  await supabase.from('profiles').select('org_id').eq('id', signUp.user.id).single()
).data.org_id;
console.log('  ✓ user/org prêts', { user: signUp.user.id.slice(0, 8), org: orgId.slice(0, 8) });

console.log('[2] créer espèce "Cailles" (volaille)');
const { data: cailles, error: spErr } = await supabase
  .from('species')
  .insert({ org_id: orgId, name: 'Cailles', category: 'volaille' })
  .select()
  .single();
if (spErr) { console.error('  ✗', spErr.message); process.exit(1); }
console.log('  ✓ species', cailles.id.slice(0, 8), '-', cailles.name);

console.log('[3] créer produit "Œufs de caille" (rattaché à Cailles, unite=unite, prix=100)');
const { data: oeufs, error: oeufsErr } = await supabase
  .from('products')
  .insert({
    org_id: orgId,
    species_id: cailles.id,
    name: 'Œufs de caille',
    unit: 'unite',
    default_price: 100,
  })
  .select()
  .single();
if (oeufsErr) { console.error('  ✗', oeufsErr.message); process.exit(1); }
console.log('  ✓ product', oeufs.id.slice(0, 8), '-', oeufs.name, 'species_id =', oeufs.species_id?.slice(0, 8));

console.log('[4] créer produit "Miel" SANS espèce (species_id = null, unite=litre, prix=5000)');
const { data: miel, error: mielErr } = await supabase
  .from('products')
  .insert({
    org_id: orgId,
    species_id: null,
    name: 'Miel',
    unit: 'litre',
    default_price: 5000,
  })
  .select()
  .single();
if (mielErr) { console.error('  ✗', mielErr.message); process.exit(1); }
if (miel.species_id !== null) { console.error('  ✗ species_id devrait être null, reçu', miel.species_id); process.exit(1); }
console.log('  ✓ product', miel.id.slice(0, 8), '-', miel.name, 'species_id =', String(miel.species_id));

console.log('[5] lister : 1 espèce + 2 produits attendus');
const { data: spList } = await supabase.from('species').select('name').is('deleted_at', null).order('name');
const { data: prList } = await supabase.from('products').select('name, species_id, unit, default_price').is('deleted_at', null).order('name');
console.log('  espèces :', spList.map((s) => s.name));
console.log('  produits :');
for (const p of prList) {
  console.log(`    - ${p.name} (${p.unit}, ${p.default_price} FCFA, species_id=${p.species_id ?? 'null'})`);
}
if (spList.length !== 1 || prList.length !== 2) {
  console.error('  ✗ comptes inattendus');
  process.exit(1);
}

console.log('[6] archiver "Miel" (soft delete via deleted_at)');
const { error: archErr } = await supabase
  .from('products')
  .update({ deleted_at: new Date().toISOString() })
  .eq('id', miel.id);
if (archErr) { console.error('  ✗', archErr.message); process.exit(1); }

console.log('[7] relister produits : "Miel" doit avoir disparu');
const { data: afterArch } = await supabase
  .from('products')
  .select('name')
  .is('deleted_at', null)
  .order('name');
console.log('  produits visibles :', afterArch.map((p) => p.name));
if (afterArch.length !== 1 || afterArch[0].name !== 'Œufs de caille') {
  console.error('  ✗ liste filtrée incorrecte');
  process.exit(1);
}

console.log('[8] vérifier que "Miel" existe TOUJOURS en base (preuve soft delete)');
const { data: mielRow } = await supabase
  .from('products')
  .select('id, name, deleted_at')
  .eq('id', miel.id)
  .single();
if (!mielRow.deleted_at) { console.error('  ✗ deleted_at vide alors qu\'on vient d\'archiver'); process.exit(1); }
console.log('  ✓ ligne conservée, deleted_at =', mielRow.deleted_at);

await supabase.auth.signOut();
console.log('\n=== TEST CATALOGUE PASS ===');
console.log('Espèce + produit avec espèce + produit SANS espèce : OK.');
console.log('Soft delete : la ligne reste en base, filtrée à la lecture.');
