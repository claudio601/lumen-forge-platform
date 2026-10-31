// scripts/whatsapp/comunas.ts
// [COMUNA] Escribe api/_lib/whatsapp/comunas.generated.ts con las 346 comunas de Chile y su codigo
// CUT, desde el CodeSystem de comunas de HL7 Chile (Core CL, codigos de la SUBDERE).
//
//   npx tsx scripts/whatsapp/comunas.ts
//
// La fuente trae algunos nombres con errores de tipeo o sin tildes: FIXES los corrige con el nombre
// oficial (INE/SUBDERE). Los nombres alternativos ("Coihaique", "Calera", "Vina") van a mano en
// ALIASES de api/_lib/whatsapp/comunas.ts, no aqui. El archivo generado queda en ASCII (las tildes
// van como \u), para que ningun editor las corrompa.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://build.fhir.org/ig/HL7Chile/clcore_ig/CodeSystem-CSCodComunasCL.json';
const OUT = fileURLToPath(new URL('../../api/_lib/whatsapp/comunas.generated.ts', import.meta.url));
const EXPECTED = 346;

/** Codigo CUT -> nombre oficial, cuando la fuente lo escribe distinto. */
export const FIXES: Record<string, string> = {
  '04105': 'Paihuano',
  '05502': 'La Calera',
  '07309': 'Vichuqu\u00e9n',
  '09112': 'Padre Las Casas',
  '11101': 'Coyhaique',
  '12202': 'Ant\u00e1rtica',
  '13101': 'Santiago',
  '13106': 'Estaci\u00f3n Central',
  '13120': '\u00d1u\u00f1oa',
  '16207': 'Trehuaco',
};

interface Concept { code: string; display: string }

function ascii(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

async function main(): Promise<void> {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error('La fuente respondio ' + res.status);
  const concepts = ((await res.json()) as { concept?: Concept[] }).concept ?? [];
  const rows = concepts
    .filter((c) => /^\d{5}$/.test(c.code) && c.display?.trim())
    .map((c) => [c.code, FIXES[c.code] ?? c.display.trim()] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (rows.length !== EXPECTED) throw new Error('Se esperaban ' + EXPECTED + ' comunas y llegaron ' + rows.length);
  for (const code of Object.keys(FIXES)) {
    if (!rows.some(([c]) => c === code)) throw new Error('FIXES trae un codigo que la fuente no tiene: ' + code);
  }
  const body = [
    '// api/_lib/whatsapp/comunas.generated.ts',
    '// GENERADO por scripts/whatsapp/comunas.ts: no editar a mano.',
    '// Fuente: ' + SOURCE,
    '// [codigo CUT, nombre oficial]; las dos primeras cifras del codigo son la region.',
    'export const COMUNAS: ReadonlyArray<readonly [string, string]> = [',
    ...rows.map(([code, name]) => "  ['" + code + "', '" + ascii(name).replace(/'/g, "\\'") + "'],"),
    '];',
    '',
  ].join('\n');
  writeFileSync(OUT, body);
  console.log('Escritas ' + rows.length + ' comunas en ' + OUT);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
