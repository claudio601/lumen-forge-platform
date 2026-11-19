// api/_lib/shipping/productName.test.ts
// Nombres del catálogo con mayúscula inicial en el aviso de despacho (dueño, 18-11-2026): casos
// fijos con nombres reales y un recorrido por los nombres de product-links.generated.ts.
// El recorrido depende de los datos del día: la revisión de palabras nuevas solo informa en el
// robot de catálogo (isSyncBot, CLAUDE.md §14).

import { describe, expect, it } from 'vitest';
import { isSyncBot } from '../../../src/test/syncBot';
import { productLinks } from '../catalog/product-links.generated';
import { ACRONYMS, displayProductName, displayVariantLabel, SPECIAL } from './productName';

/**
 * Palabras en mayúsculas del catálogo (18-11-2026) revisadas como palabras comunes: van en
 * minúscula. Una palabra nueva en mayúsculas que no está aquí ni en ACRONYMS/SPECIAL hace fallar
 * la prueba: hay que decidir si es sigla o marca (productName.ts) o palabra común (aquí).
 */
const COMMON = new Set([
  'A', 'ALL', 'ALUMBRADO', 'ALUMINIO', 'AMARILLO', 'AMERICANO', 'AMPOLLETA', 'ANTIEXPLOSIVA', 'ANTIVANDÁLICO', 'APLIQUE', 'ARO',
  'AUTONOMIA', 'AUTONOMÍA', 'AZUL', 'BACKLIGHT', 'BARRA', 'BASCULANTE', 'BAZUCA', 'BIDIRECCIONAL', 'BLANCA', 'BLANCO', 'BOLA', 'BRAZO',
  'CABLES', 'CÁLIDA', 'CAMPANA', 'CANOA', 'CANOPY', 'CIELO', 'CILINDRO', 'CINTA', 'CIRCULO', 'CLASE', 'CM', 'CODO', 'COLGANTE',
  'COLORES', 'CON', 'CONCÉNTRICA', 'CONCENTRICO', 'CONTROL', 'CUADRADO', 'DE', 'DECORATIVO', 'DICROICA', 'DICROICO', 'DIMERIZABLE',
  'DOBLE', 'DOWNLIGHT', 'EMBUTIDA', 'EMBUTIDO', 'EMERGENCIA', 'EMPOTRADO', 'EN', 'ESTACA', 'ESTADIO', 'ESTANCA', 'EXPLOSIÓN',
  'EXTERIOR', 'EXTRA', 'FAROL', 'FAROS', 'FLAT', 'FOCO', 'FRÍA', 'FUENTE', 'GALVANIZADO', 'GRIS', 'HERMÉTICA', 'HRS', 'IN',
  'INDUSTRIAL', 'INSTALACIÓN', 'INTERIOR', 'ISLAND', 'JARDÍN', 'KIT', 'LÁMPARA', 'LAVADORA', 'LINEAL', 'LISA', 'LM', 'LOS',
  'LÚMENES', 'LUMINARIA', 'LUZ', 'M', 'MARCO', 'MINI', 'MINUTOS', 'MM', 'MODERNA', 'MODULAR', 'MONOFÁSICO', 'MONTAR', 'MOVIMIENTO',
  'MT', 'MULTIFUNCIÓN', 'MURO', 'NEGRA', 'NEGRO', 'NIQUEL', 'O', 'ONE', 'OPAL', 'ORNAMENTAL', 'OVAL', 'OVALADO', 'PAGODA', 'PANEL',
  'PANELES', 'PARA', 'PARED', 'PERFIL', 'PERFORADA', 'PISCINA', 'PISO', 'PLANO', 'PODER', 'PORTÁTIL', 'POSTE', 'PREMIUM', 'PROOF',
  'PROYECTOR', 'PRUEBA', 'PÚBLICO', 'RECARGABLE', 'REDONDO', 'REGLETA', 'REGULABLE', 'REJILLA', 'REMOTO', 'RETRAÍDO', 'RIEL', 'ROJO',
  'SALIDA', 'SEMI', 'SENSOR', 'SEÑALÉTICA', 'SLIM', 'SOBREPONER', 'SOBREPUESTO', 'SOLAR', 'SQUARE', 'SUMERGIBLE', 'SUPERMARKET',
  'SUSPENDIDA', 'SUSPENDIDOS', 'SWITCHING', 'THIN', 'TODOS', 'TORTUGA', 'TRANSPARENTE', 'TRI', 'TRIFÁSICO', 'TRIPODE', 'TUBO',
  'TUBULAR', 'ULTRA', 'UNIVERSAL', 'VERDE', 'VERTICAL', 'VIAL', 'VIDRIO', 'WALL', 'WASHER', 'X',
]);

const LOCALE = 'es-CL';
const up = (s: string) => s.toLocaleUpperCase(LOCALE);
/** Tramos de letras de las palabras sin dígitos (las con dígitos quedan iguales). «C/» se expande. */
const letterRuns = (text: string) =>
  text
    .split(/\s+/)
    .map((w) => w.replace(/^[cC]\//, ''))
    .filter((w) => w && !/\d/.test(w))
    .flatMap((w) => w.match(/\p{L}+/gu) ?? []);

const KEPT = new Set([...ACRONYMS, ...SPECIAL.keys()]);
const SPECIAL_FORMS = new Set(SPECIAL.values());

describe('casos fijos (nombres reales del catálogo)', () => {
  it.each([
    ['ALUMBRADO PÚBLICO BESTLED 40W IP66 IK08', 'Alumbrado público BESTLED 40W IP66 IK08'],
    ['PROYECTOR LED SOLAR 100W IP65 C/PANEL SOLAR C/CONTROL REMOTO', 'Proyector LED solar 100W IP65 con panel solar y control remoto'],
    ['CAMPANA LED UFO PRO HL 200W 190LM/W IP65 CON SENSOR', 'Campana LED UFO PRO HL 200W 190LM/W IP65 con sensor'],
    ['LUMINARIA LED VIAL A PRUEBA DE EXPLOSIÓN 125W IP66 CLASE I DIV. 2', 'Luminaria LED vial a prueba de explosión 125W IP66 clase I Div. 2'],
    ['SEÑALÉTICA DE EMERGENCIA LED SLIM 24 X 18 CM. SALIDA', 'Señalética de emergencia LED slim 24 x 18 cm. salida'],
    ['BRAZO GALVANIZADO PARA POSTE 1 SALIDA Ø48MM', 'Brazo galvanizado para poste 1 salida Ø48MM'],
    ['Panel LED 60x60 Slim 40W Dimerizable | Extra Plano eLIGHTS', 'Panel LED 60x60 slim 40W dimerizable | extra plano eLIGHTS'],
    ['BARRA DE EMERGENCIA 60 LEDs RECARGABLE AUTONOMÍA 3-6 HRS.', 'Barra de emergencia 60 LEDs recargable autonomía 3-6 hrs.'],
    ['LUMINARIA LED TRI-PROOF A PRUEBA DE EXPLOSIÓN ATEX 40W', 'Luminaria LED tri-proof a prueba de explosión ATEX 40W'],
    ['ALUMBRADO PÚBLICO LED SOLAR VITO 400W ALL IN ONE INDUSTRIAL C/ CONTROL REMOTO', 'Alumbrado público LED solar Vito 400W all in one industrial con control remoto'],
    ['CAMPANA LED UFO NF3 150W 150 LM/W  IP66', 'Campana LED UFO NF3 150W 150 lm/W IP66'],
    ['PROYECTOR LED SOLAR 100W IP66 C/PANEL SOLAR C/CONTROL REMOTO (GRIS)', 'Proyector LED solar 100W IP66 con panel solar y control remoto (gris)'],
  ])('%s', (name, shown) => {
    expect(displayProductName(name)).toBe(shown);
  });

  it('la variante va en minúscula, salvo las palabras con dígitos y las siglas', () => {
    expect(displayVariantLabel('Neutra 4000K')).toBe('neutra 4000K');
    expect(displayVariantLabel('40W · Ámbar 2200K')).toBe('40W · ámbar 2200K');
    expect(displayVariantLabel('Cálida, 1 % de luz azul')).toBe('cálida, 1 % de luz azul');
    expect(displayVariantLabel('RGB')).toBe('RGB');
    expect(displayVariantLabel('Blanco')).toBe('blanco');
    expect(displayVariantLabel('')).toBe('');
    expect(`${displayProductName('ALUMBRADO PÚBLICO BESTLED 40W IP66 IK08')} – ${displayVariantLabel('Neutra 4000K')}`).toBe(
      'Alumbrado público BESTLED 40W IP66 IK08 – neutra 4000K',
    );
  });

  it('bordes: sigla, número o marca al comienzo; tildes y ñ; espacios de más', () => {
    expect(displayProductName('LED PANEL CUADRADO')).toBe('LED panel cuadrado');
    expect(displayProductName('2 FAROS LED')).toBe('2 faros LED');
    expect(displayProductName('eLIGHTS PANEL')).toBe('eLIGHTS panel');
    expect(displayProductName('ÁMBAR  ÑANDÚ   ÚNICO')).toBe('Ámbar ñandú único');
    expect(displayProductName('foco c/ sensor')).toBe('Foco con sensor');
  });
});

describe('los nombres del catálogo (product-links.generated.ts)', () => {
  const names = Object.values(productLinks).map((p) => p.name);
  const labels = [...new Set(Object.values(productLinks).flatMap((p) => Object.values(p.variants).map((v) => v.label)))];

  it('ninguna palabra común queda en mayúsculas ni una sigla en minúsculas', () => {
    expect(names.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const name of names) {
      const shown = displayProductName(name);
      const inRuns = letterRuns(name);
      const outRuns = letterRuns(shown);
      outRuns.forEach((run, i) => {
        // la mayúscula inicial del nombre («A prueba…») no cuenta
        const isUpper = run === up(run) && run !== run.toLocaleLowerCase(LOCALE) && !(i === 0 && run.length === 1);
        // en mayúsculas solo quedan siglas (o la «I» de «clase I», la «W» de «lm/W» y las formas fijas)
        if (isUpper && !ACRONYMS.has(run) && !SPECIAL_FORMS.has(run)) bad.push(`${shown}: «${run}» en mayúsculas`);
        // una sigla nunca queda en minúsculas (salvo la primera letra del nombre, que va en mayúscula)
        if (!isUpper && ACRONYMS.has(up(run)) && run !== up(run)) bad.push(`${shown}: «${run}» debería ir en mayúsculas`);
      });
      for (const run of inRuns) if (ACRONYMS.has(up(run))) expect(outRuns, name).toContain(up(run));
      // mayúscula inicial
      expect(shown.charAt(0), name).not.toMatch(/\p{Ll}/u);
    }
    expect(bad).toEqual([]);
  });

  it('toda palabra en mayúsculas del catálogo está clasificada (sigla, forma fija o palabra común)', () => {
    const seen = new Map<string, number>();
    const unclassified = new Set<string>();
    for (const name of names) {
      for (const run of letterRuns(name)) {
        const key = up(run);
        if (KEPT.has(key)) seen.set(key, (seen.get(key) ?? 0) + 1);
        else if (!COMMON.has(key)) unclassified.add(key);
      }
    }
    // Informe: las siglas y formas fijas que aparecen hoy en el catálogo.
    console.info(
      `[productName] ${names.length} nombres. Siglas y formas fijas: ${[...seen.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([w, n]) => `${SPECIAL.get(w) ?? w} (${n})`)
        .join(', ')}`,
    );
    for (const w of COMMON) expect(KEPT.has(w), w).toBe(false);
    if (isSyncBot && unclassified.size) {
      console.warn(`[productName] palabras nuevas sin clasificar (van en minúscula): ${[...unclassified].join(', ')}`);
      return;
    }
    expect([...unclassified], 'palabra nueva en mayúsculas: agrégala a ACRONYMS/SPECIAL (productName.ts) o a COMMON (esta prueba)').toEqual([]);
  });

  it('las etiquetas de variante quedan en minúscula (salvo números y siglas)', () => {
    for (const label of labels) {
      const shown = displayVariantLabel(label);
      for (const run of letterRuns(shown)) {
        if (!ACRONYMS.has(up(run))) expect(run, label).toBe(run.toLocaleLowerCase(LOCALE));
      }
    }
  });
});
