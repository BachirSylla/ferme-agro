// Génère les icônes PNG du PWA depuis public/pwa-icon.svg (source de vérité).
// À relancer après toute modification du SVG source :
//   node scripts/generate-pwa-icons.mjs
//
// @resvg/resvg-js : pure JS + binaires pré-compilés, fonctionne sans dépendance
// système (vs sharp qui requiert un runtime C++ sous Windows).

import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const SVG_PATH = 'public/pwa-icon.svg';
const OUT_DIR = 'public';

// Tailles attendues par notre manifest (cf. vite.config.ts) +
// apple-touch-icon pour iOS (180px) + icône maskable séparée
// (notre source ayant déjà du padding, on réutilise le même rendu 512).
const targets = [
  { name: 'pwa-64x64.png', size: 64 },
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'maskable-icon-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

const svg = fs.readFileSync(SVG_PATH, 'utf8');

for (const { name, size } of targets) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const png = resvg.render().asPng();
  fs.writeFileSync(`${OUT_DIR}/${name}`, png);
  console.log(`  ✓ ${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

console.log(`\nGénéré ${targets.length} icônes depuis ${SVG_PATH}.`);
