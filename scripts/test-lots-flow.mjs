// Test end-to-end de la chaîne Lots contre Supabase hébergé.
// Reproduit le scénario utilisateur :
//   - créer une espèce "Cailles"
//   - créer un lot LOT-CAILLES-001 (species_id requis, 200 têtes)
//   - éditer current_count = 196
//   - changer le statut → vendu
//   - archiver → disparaît de la liste active, reste en base

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
const email = `claude-lots-test-${Date.now()}@mailinator.com`;
const password = 'TestPassword123!';

console.log(`[1] signUp ${email}`);
const { data: signUp, error: suErr } = await sb.auth.signUp({ email, password });
if (suErr || !signUp.session) { console.error('  ✗', suErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', signUp.user.id).single()).data.org_id;
console.log('  ✓ user/org prêts');

console.log('[2] créer espèce "Cailles"');
const { data: sp, error: spErr } = await sb
  .from('species')
  .insert({ org_id: orgId, name: 'Cailles', category: 'volaille' })
  .select()
  .single();
if (spErr) { console.error('  ✗', spErr.message); process.exit(1); }
console.log('  ✓ species', sp.id.slice(0, 8));

console.log('[3] créer lot LOT-CAILLES-001 (200 têtes, statut actif)');
const { data: lot, error: lotErr } = await sb
  .from('lots')
  .insert({
    org_id: orgId,
    species_id: sp.id,
    code: 'LOT-CAILLES-001',
    initial_count: 200,
    current_count: 200,
    status: 'actif',
  })
  .select()
  .single();
if (lotErr) { console.error('  ✗', lotErr.message); process.exit(1); }
console.log('  ✓ lot', lot.id.slice(0, 8), '-', lot.code, '/', lot.current_count, '/', lot.status);

console.log('[4] lister actifs');
const { data: actifs } = await sb.from('lots').select('code, current_count, status').is('deleted_at', null);
console.log('  visibles :', actifs);
if (actifs.length !== 1) { console.error('  ✗ devrait y avoir 1 lot'); process.exit(1); }

console.log('[5] éditer current_count → 196');
const { error: u1 } = await sb.from('lots').update({ current_count: 196 }).eq('id', lot.id);
if (u1) { console.error('  ✗', u1.message); process.exit(1); }

console.log('[6] changer statut → vendu');
const { error: u2 } = await sb.from('lots').update({ status: 'vendu' }).eq('id', lot.id);
if (u2) { console.error('  ✗', u2.message); process.exit(1); }

console.log('[7] relire le lot');
const { data: after } = await sb.from('lots').select('current_count, status').eq('id', lot.id).single();
if (after.current_count !== 196 || after.status !== 'vendu') {
  console.error('  ✗ état inattendu', after);
  process.exit(1);
}
console.log('  ✓ current_count = 196, status = vendu');

console.log('[8] archiver (soft delete)');
const { error: arch } = await sb
  .from('lots')
  .update({ deleted_at: new Date().toISOString() })
  .eq('id', lot.id);
if (arch) { console.error('  ✗', arch.message); process.exit(1); }

console.log('[9] liste active après archivage : doit être vide');
const { data: afterArch } = await sb.from('lots').select('code').is('deleted_at', null);
console.log('  visibles :', afterArch);
if (afterArch.length !== 0) { console.error('  ✗ devrait être vide'); process.exit(1); }

console.log('[10] ligne toujours en base (soft delete)');
const { data: row } = await sb.from('lots').select('code, deleted_at').eq('id', lot.id).single();
if (!row.deleted_at) { console.error('  ✗ deleted_at vide'); process.exit(1); }
console.log('  ✓ conservée, deleted_at =', row.deleted_at);

await sb.auth.signOut();
console.log('\n=== TEST LOTS PASS ===');
console.log('Création avec species_id, éditions current_count + status, archivage soft → OK.');
