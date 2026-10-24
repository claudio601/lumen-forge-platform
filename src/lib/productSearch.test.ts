// src/lib/productSearch.test.ts
// Búsqueda tolerante (auditoría UX, B-03) y la salida sin resultados (B-04). Corre contra el
// catálogo real, que cambia con cada sincronización de Jumpseller: las pruebas fijan reglas
// (qué tiene que encontrar cada consulta de la auditoría y en qué orden), no conteos.

import { describe, it, expect } from 'vitest';
import { products, categories, type Product } from '@/data/products';
import { GENERIC_SEARCH_WORDS, SEARCH_SYNONYMS } from '@/data/catalog/search-synonyms';
import {
  highlightMatches,
  normalizeSearchText,
  searchIndex,
  searchProducts,
  searchRequestMailto,
  searchSuggestions,
  searchThatFinds,
  searchWords,
} from './productSearch';
import { searchTermsFromPath } from './notFound';

const search = (q: string) => searchProducts(products, q);
const ids = (list: readonly Product[]) => new Set(list.map(p => p.id));
const norm = normalizeSearchText;
const catName = (id: string) => categories.find(c => c.id === id)?.name ?? id;
/** Las variantes para elegir y la única. */
const allVariants = (p: Product) => [...(p.variants ?? []), ...(p.singleVariant ? [p.singleVariant] : [])];
/** Todo el texto que indexa un producto, normalizado. */
const haystack = (p: Product) =>
  norm([p.sku, p.name, p.brand, ...p.categories.map(catName), ...allVariants(p).flatMap(v => [v.sku, ...v.options.map(o => o.value)]), ...p.kelvins.map(k => `${k}K`)].join(' '));
const nameHas = (p: Product, re: RegExp) => re.test(norm(p.name));
const sameSet = (a: readonly Product[], b: readonly Product[]) => expect([...ids(a)].sort()).toEqual([...ids(b)].sort());
const allSkus = (p: Product) => [p.sku, ...allVariants(p).map(v => v.sku)].filter(Boolean).map(norm);
const synonymTargets = (s: (typeof SEARCH_SYNONYMS)[number]) => [s.encuentra].flat();

describe('texto normalizado', () => {
  it('sin tildes y en minúsculas', () => {
    expect(norm('ALUMBRADO PÚBLICO')).toBe('alumbrado publico');
    expect(norm('Señalética Galpón')).toBe('senaletica galpon');
  });

  it('junta lo que se escribe separado: «2700 K», «IP 65», «60 x 60» y la coma decimal', () => {
    expect(searchWords('2700 K')).toEqual(['2700k']);
    expect(searchWords('IP 65')).toEqual(['ip65']);
    expect(searchWords('panel 60 x 60')).toEqual(['panel', '60x60']);
    expect(searchWords('CINTA 14,4W 5mt.')).toEqual(['cinta', '14.4w', '5mt']);
    expect(searchWords('eLIGHTS.cl')).toEqual(['elights', 'cl']);
  });

  it('unidades escritas largas: «100 watts», «100watts», «2700 kelvin», «1500 lúmenes»', () => {
    expect(searchWords('100 watts')).toEqual(['100w']);
    expect(searchWords('100watts')).toEqual(['100w']);
    expect(searchWords('100 Watt')).toEqual(['100w']);
    expect(searchWords('2700 kelvin')).toEqual(['2700k']);
    expect(searchWords('1500 lúmenes')).toEqual(['1500lm']);
  });
});

describe('consultas de la auditoría (B-03)', () => {
  it('«alumbrado publico» sin tilde da lo mismo que con tilde y trae toda la categoría', () => {
    const plain = search('alumbrado publico');
    expect(plain.length).toBeGreaterThan(0);
    sameSet(plain, search('alumbrado público'));
    sameSet(plain, search('ALUMBRADO PUBLICO'));
    const inCategory = products.filter(p => p.categories.includes('alumbrado-publico'));
    for (const p of inCategory) expect(ids(plain).has(p.id), p.name).toBe(true);
    for (const p of plain) expect(haystack(p)).toMatch(/alumbrado.*publico|publico.*alumbrado/);
  });

  it('«reflector» encuentra los proyectores (sinónimo)', () => {
    const r = search('reflector');
    expect(r.length).toBeGreaterThan(0);
    sameSet(r, search('proyector'));
    for (const p of products.filter(x => nameHas(x, /\bproyector\b/))) expect(ids(r).has(p.id), p.name).toBe(true);
  });

  it('«luminaria vial»: «luminaria» no filtra; trae lo que dice «vial» y el alumbrado público', () => {
    const r = search('luminaria vial');
    sameSet(r, search('vial'));
    const expected = ids([...search('alumbrado publico'), ...products.filter(p => nameHas(p, /\bvial\b/))]);
    expect([...ids(r)].sort()).toEqual([...expected].sort());
    // Lo que dice «vial» tal cual va antes que lo que llega por sinónimo
    const literal = r.filter(p => nameHas(p, /\bvial\b/));
    expect(r.slice(0, literal.length)).toEqual(literal);
  });

  it('«galpon» (sin tilde) encuentra las campanas; «galpón» y «galpones», lo mismo', () => {
    const r = search('galpon');
    expect(r.length).toBeGreaterThan(0);
    sameSet(r, search('campana'));
    sameSet(r, search('galpón'));
    sameSet(r, search('galpones'));
    for (const p of products.filter(x => nameHas(x, /\bcampana\b/))) expect(ids(r).has(p.id), p.name).toBe(true);
  });

  it('«cancha» encuentra los proyectores de estadio', () => {
    const r = search('cancha');
    expect(r.length).toBeGreaterThan(0);
    sameSet(r, search('proyector de estadio'));
    for (const p of r) expect(haystack(p)).toMatch(/estadio/);
    for (const p of products.filter(x => nameHas(x, /proyector.*estadio/))) expect(ids(r).has(p.id), p.name).toBe(true);
  });

  it('«2700K» trae los productos con alguna variante de 2700K (también «2700 K» y «2700»)', () => {
    const r = search('2700K');
    const withVariant = products.filter(p => p.kelvins.includes(2700));
    expect(withVariant.length).toBeGreaterThan(0);
    for (const p of withVariant) expect(ids(r).has(p.id), p.name).toBe(true);
    for (const p of r) expect(p.kelvins.includes(2700) || /2700\s*k/i.test(p.name), p.name).toBe(true);
    sameSet(r, search('2700 K'));
    sameSet(r, search('2700'));
  });

  it('«IP 65» da lo mismo que «IP65» y trae los IP65', () => {
    const r = search('IP 65');
    sameSet(r, search('ip65'));
    const ip65 = products.filter(p => p.ip === 'IP65');
    expect(ip65.length).toBeGreaterThan(0);
    for (const p of ip65) expect(ids(r).has(p.id), p.name).toBe(true);
    for (const p of r) expect(haystack(p)).toMatch(/ip ?65/);
  });

  it('«APB601» (SKU de una variante BESTLED) trae primero ese producto', () => {
    const owner = products.find(p => p.variants?.some(v => v.sku === 'APB601'));
    if (!owner) return; // la variante ya no está en Jumpseller: la regla general va abajo
    expect(search('APB601')[0].id).toBe(owner.id);
    expect(search('apb601')[0].id).toBe(owner.id);
  });

  it('el SKU de cualquier variante (también la única) encuentra su producto, y lo que coincide por SKU va primero', () => {
    const skus = [...new Set(products.flatMap(p => allVariants(p).map(v => v.sku)).filter(Boolean))];
    // Variantes únicas con un SKU distinto del producto («PLC20GC» de «PLC20G»): también cuentan
    expect(products.some(p => p.singleVariant?.sku && norm(p.singleVariant.sku) !== norm(p.sku))).toBe(true);
    expect(skus.length).toBeGreaterThan(0);
    for (const sku of skus) {
      const r = search(sku);
      const q = searchWords(sku);
      const bySku = r.filter(p => allSkus(p).some(s => q.every(w => searchWords(s).some(x => x.startsWith(w)))));
      for (const p of products.filter(x => allSkus(x).includes(norm(sku)))) expect(ids(bySku).has(p.id), `${sku}: ${p.name}`).toBe(true);
      expect(r.slice(0, bySku.length), sku).toEqual(bySku);
    }
  });

  it('el SKU completo trae primero a su dueño, antes que un SKU que solo empieza igual', () => {
    const skus = [...new Set(products.flatMap(allSkus))];
    for (const sku of skus) {
      const owners = ids(products.filter(p => allSkus(p).includes(sku)));
      expect(owners.has(search(sku)[0]?.id), sku).toBe(true);
    }
  });

  it('«proyectr» (una letra menos) da lo mismo que «proyector»', () => {
    const r = search('proyectr');
    expect(r.length).toBeGreaterThan(0);
    sameSet(r, search('proyector'));
  });

  it('«antiexplosivo» trae toda la iluminación antiexplosiva; «ex» y «ATEX», lo mismo, y «ex» no trae lo de exterior', () => {
    const r = search('antiexplosivo');
    for (const p of products.filter(x => x.categories.includes('iluminacion-antiexplosiva'))) expect(ids(r).has(p.id), p.name).toBe(true);
    sameSet(r, search('antiexplosiva'));
    sameSet(search('ex'), r);
    sameSet(search('ATEX'), r);
  });

  it('«panel 60x60» trae los paneles de 60x60, todas las palabras presentes', () => {
    const r = search('panel 60x60');
    expect(r.length).toBeGreaterThan(0);
    for (const p of r) expect(haystack(p)).toMatch(/panel/);
    for (const p of r) expect(haystack(p)).toMatch(/60 ?x ?60/);
    for (const p of products.filter(x => nameHas(x, /\bpanel\b.*\b60x60\b/))) expect(ids(r).has(p.id), p.name).toBe(true);
    sameSet(r, search('panel 60 x 60'));
  });
});

describe('plurales y palabras genéricas', () => {
  it('«luminarias», «lámparas», «luces» y «luz» no filtran, tampoco en plural', () => {
    sameSet(search('luminarias solares'), search('luminaria solar'));
    sameSet(search('luminarias solares'), search('solar'));
    sameSet(search('lámparas solares'), search('solar'));
    sameSet(search('luz solar'), search('solar'));
    sameSet(search('luminarias viales'), search('luminaria vial'));
    sameSet(search('luminarias para galpon'), search('galpon'));
    sameSet(search('luces de emergencia'), search('emergencia'));
    expect(search('luminarias solares').length).toBeGreaterThan(0);
    expect(search('luces de emergencia').length).toBeGreaterThan(0);
  });

  it('solo palabras genéricas: se buscan las que están en el catálogo («luces led» busca «led»)', () => {
    expect(search('luces led').length).toBeGreaterThan(0);
    sameSet(search('luces led'), search('led'));
  });

  it('«luz azul» trae primero lo que es azul (la cinta), no solo el «1% de luz azul» de las variantes', () => {
    const r = search('luz azul');
    const blue = r.filter(p => nameHas(p, /\bazul\b/));
    expect(blue.length).toBeGreaterThan(0);
    expect(r.slice(0, blue.length)).toEqual(blue);
  });
});

describe('una letra de diferencia, solo como respaldo', () => {
  it('«salida» trae lo que dice «salida», no todo lo de «Luz Cálida»', () => {
    const r = search('salida');
    expect(r.length).toBeGreaterThan(0);
    for (const p of r) expect(haystack(p), p.name).toMatch(/salida/);
  });

  it('«calida» no trae «salida»', () => {
    const r = search('calida');
    expect(r.length).toBeGreaterThan(0);
    for (const p of r) expect(haystack(p), p.name).toMatch(/calida/);
  });

  it('«estanca» no trae las estacas, y «estaca» no trae la estanca', () => {
    for (const p of search('estanca')) expect(haystack(p), p.name).toMatch(/estanca/);
    for (const p of search('estaca')) expect(haystack(p), p.name).toMatch(/estaca\b/);
  });

  it('con otra primera letra no hay tolerancia: «puente» no trae «fuente», «barco» no trae «marco»', () => {
    expect(search('puente')).toEqual([]);
    expect(search('barco')).toEqual([]);
  });

  it('una palabra que es sinónimo no busca parecidos: «calles» trae el alumbrado público, no los «cables»', () => {
    sameSet(search('calles'), search('calle'));
    for (const p of search('calles')) expect(haystack(p), p.name).not.toMatch(/cables/);
  });

  it('lo que llega con una letra de diferencia va después de lo que coincide tal cual', () => {
    // «galpn»: por sinónimo (campana) con una letra de diferencia; todo igual que «galpon»
    sameSet(search('galpn'), search('galpon'));
  });
});

describe('sinónimos agregados en la revisión', () => {
  it('«plafon» y «cielo falso» traen paneles LED, no los «panel solar»', () => {
    for (const q of ['plafon', 'plafón', 'cielo falso']) {
      const r = search(q);
      expect(r.length, q).toBeGreaterThan(0);
      for (const p of r) expect(p.categories, `${q}: ${p.name}`).toContain('paneles-led');
      for (const p of r) expect(p.name, q).not.toMatch(/solar/i);
    }
  });

  it('«dimmer» trae lo regulable y lo «dimerizable»', () => {
    const r = ids(search('dimmer'));
    for (const p of products.filter(x => nameHas(x, /\b(regulable|dimerizable)\b/))) expect(r.has(p.id), p.name).toBe(true);
  });

  it('«triproof», «tri proof» y «tri-proof» traen las TRI-PROOF y las herméticas', () => {
    const triproof = products.filter(p => nameHas(p, /tri-proof/));
    const hermetic = products.filter(p => nameHas(p, /\bhermetica\b/));
    expect(triproof.length + hermetic.length).toBeGreaterThan(0);
    for (const q of ['triproof', 'tri proof', 'tri-proof']) {
      const r = ids(search(q));
      for (const p of [...triproof, ...hermetic]) expect(r.has(p.id), `${q}: ${p.name}`).toBe(true);
    }
  });

  it('«highbay» da lo mismo que «high bay»; «cartel salida», la señalética de salida', () => {
    sameSet(search('highbay'), search('high bay'));
    expect(search('highbay').length).toBeGreaterThan(0);
    const r = search('cartel salida');
    expect(r.length).toBeGreaterThan(0);
    for (const p of r) expect(haystack(p), p.name).toMatch(/senaletica.*salida/);
  });

  it('«100 watts» y «2700 kelvin» dan lo mismo que «100w» y «2700k»', () => {
    sameSet(search('100 watts'), search('100w'));
    sameSet(search('2700 kelvin'), search('2700K'));
    expect(search('100 watts').length).toBeGreaterThan(0);
  });
});

describe('reglas de la búsqueda', () => {
  it('sin la comparación numérica suelta: «0» no trae todo, y un número busca ese número', () => {
    expect(search('0')).toEqual([]);
    for (let d = 1; d <= 9; d++) expect(search(String(d)).length, String(d)).toBeLessThan(products.length);
    for (const p of search('100')) expect(norm(`${p.name} ${haystack(p)}`)).toMatch(/(^|[^0-9.])100(?![0-9])/);
  });

  it('todas las palabras tienen que estar', () => {
    const both = search('campana 200w');
    expect(both.length).toBeGreaterThan(0);
    for (const p of both) expect(haystack(p)).toMatch(/200 ?w/);
    expect(search('campana palabraquenoexiste')).toEqual([]);
  });

  it('orden: SKU, nombre y el resto; a igualdad, el orden del catálogo', () => {
    const r = search('proyector');
    const inName = r.filter(p => nameHas(p, /proyector/));
    expect(inName.length).toBeGreaterThan(0);
    expect(r.slice(0, inName.length)).toEqual(inName);
    const position = new Map(products.map((p, i) => [p.id, i]));
    const order = inName.map(p => position.get(p.id)!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('«foco»: primero lo que dice «foco» en el nombre, después los proyectores (sinónimo)', () => {
    const r = search('foco');
    const literal = r.filter(p => nameHas(p, /\bfocos?\b/));
    expect(literal.length).toBeGreaterThan(0);
    expect(r.slice(0, literal.length)).toEqual(literal);
    for (const p of search('proyector')) expect(ids(r).has(p.id)).toBe(true);
  });

  it('con una potencia, primero los productos de esa potencia: no el trípode que nombra varias', () => {
    for (const q of ['proyector 10w', 'proyector 50w', 'proyector 100w', 'reflector 200w', 'foco 100w', '100']) {
      const r = search(q);
      expect(r.length, q).toBeGreaterThan(0);
      const watts = Number(/(\d+)w?$/.exec(q)![1]);
      expect(r[0].watts, `${q}: ${r[0].name}`).toBe(watts);
      expect(r[0].name, q).not.toMatch(/tripode/i);
    }
  });

  it('consulta vacía o solo espacios: nada', () => {
    expect(search('')).toEqual([]);
    expect(search('   ')).toEqual([]);
  });

  it('solo palabras genéricas («led»): se buscan tal cual', () => {
    expect(search('led').length).toBeGreaterThan(0);
  });

  it('el índice se arma una sola vez y es liviano', () => {
    const t0 = performance.now();
    const index = searchIndex(products);
    const built = performance.now() - t0;
    expect(searchIndex(products)).toBe(index);
    const queries = ['reflector', 'luminaria vial', 'alumbrado publico', 'galpon', 'cancha', '2700K', 'IP 65', 'APB601', 'proyectr', 'panel 60x60'];
    const t1 = performance.now();
    for (const q of queries) search(q);
    const perQuery = (performance.now() - t1) / queries.length;
    // Márgenes amplios (la máquina de CI es lenta): en un portátil, el índice tarda ~15 ms y una consulta ~1-3 ms
    expect(built).toBeLessThan(1000);
    expect(perQuery).toBeLessThan(100);
  });
});

describe('diccionario de sinónimos (search-synonyms.ts)', () => {
  const keys = SEARCH_SYNONYMS.flatMap(s => s.busca.map(norm));

  it('entre 20 y 40 palabras, sin repetir', () => {
    // La auditoría pedía de 20 a 30; la revisión agregó «highbay», «tri proof», «cartel» y «regulable»
    expect(keys.length).toBeGreaterThanOrEqual(20);
    expect(keys.length).toBeLessThanOrEqual(40);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('cada «encuentra» da resultados y cada palabra trae al menos lo mismo (en su categoría, si la tiene)', () => {
    for (const s of SEARCH_SYNONYMS) {
      for (const means of synonymTargets(s)) {
        const target = search(means).filter(p => !s.categoria || p.categories.includes(s.categoria));
        expect(target.length, means).toBeGreaterThan(0);
        for (const key of s.busca) {
          const r = ids(search(key));
          for (const p of target) expect(r.has(p.id), `${key} → ${means}: ${p.name}`).toBe(true);
        }
      }
    }
  });

  it('las categorías del diccionario existen', () => {
    for (const s of SEARCH_SYNONYMS) if (s.categoria) expect(categories.some(c => c.id === s.categoria), s.categoria).toBe(true);
  });

  it('ninguna palabra del diccionario es genérica', () => {
    const generic = new Set(GENERIC_SEARCH_WORDS.map(norm));
    for (const key of keys) for (const w of searchWords(key)) expect(generic.has(w), key).toBe(false);
  });

  it('las palabras genéricas, en plural, tampoco filtran', () => {
    for (const w of ['luminarias', 'lamparas', 'lámparas', 'luces', 'leds']) sameSet(search(`${w} solar`), search('solar'));
  });
});

describe('sin resultados (B-04)', () => {
  it('hasta 3 sugerencias, todas con resultados y distintas; primero por sinónimo', () => {
    const s = searchSuggestions(products, 'foco cancha palabraquenoexiste');
    expect(search('foco cancha palabraquenoexiste')).toEqual([]);
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(3);
    expect(s.slice(0, 2)).toEqual(['proyector', 'proyector de estadio']);
    for (const q of s) expect(search(q).length, q).toBeGreaterThan(0);
    expect(new Set(s.map(q => [...ids(search(q))].sort().join('|'))).size).toBe(s.length);
  });

  it('las palabras sugeridas se muestran como las escribió el cliente, con sus tildes', () => {
    expect(searchSuggestions(products, 'señalética xyzzy')[0]).toBe('señalética');
    expect(searchSuggestions(products, 'proyector antivandálico xyzzy')).toContain('antivandálico');
    expect(searchSuggestions(products, 'iluminación pública xyzzy')[0]).toBe('pública');
  });

  it('sin sinónimos, igual hay sugerencias (búsquedas populares) que dan resultados', () => {
    const s = searchSuggestions(products, 'xyzzy');
    expect(s).toHaveLength(3);
    for (const q of s) expect(search(q).length, q).toBeGreaterThan(0);
  });

  it('correo prellenado a ventas@elights.cl con «Busco: {consulta}» en el asunto y el cuerpo', () => {
    const href = searchRequestMailto('  galpón   200W ');
    expect(href.startsWith('mailto:ventas@elights.cl?subject=')).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('subject')).toBe('Busco: galpón 200W');
    expect(params.get('body')).toContain('Hola, busco: galpón 200W');
    expect(href).not.toMatch(/wa\.me|whatsapp/i);
  });

  it('una consulta muy larga se corta en el correo', () => {
    const params = new URLSearchParams(searchRequestMailto('x'.repeat(500)).split('?')[1]);
    expect(params.get('subject')!.length).toBeLessThanOrEqual('Busco: '.length + 120);
  });

  it('un emoji justo en el corte no rompe el correo (ni la página)', () => {
    for (const q of ['a'.repeat(119) + '😀 más', 'a'.repeat(120) + '😀', '😀'.repeat(200), 'galpón \uD83D suelto']) {
      const href = searchRequestMailto(q);
      const subject = new URLSearchParams(href.split('?')[1]).get('subject')!;
      expect(subject.startsWith('Busco: ')).toBe(true);
      expect([...subject.slice('Busco: '.length)].length).toBeLessThanOrEqual(120);
    }
    const subject = new URLSearchParams(searchRequestMailto('a'.repeat(119) + '😀 más').split('?')[1]).get('subject');
    expect(subject).toBe(`Busco: ${'a'.repeat(119)}😀`);
  });
});

describe('la 404 (B-10): lo que de las palabras de la URL sí encuentra productos', () => {
  /** Un catálogo chico, para fijar la regla sin depender de Jumpseller. */
  const fake = (sku: string, name: string): Product =>
    ({ id: sku.toLowerCase(), sku, name, brand: '', kelvins: [], categories: [] }) as unknown as Product;
  const mini = [
    fake('NF8-150', 'CAMPANA LED UFO NF8 150W 110LM/W IP65'),
    fake('NF8-200', 'CAMPANA LED UFO NF8 200W 110LM/W IP65'),
    fake('LF40', 'LINEAL LED FLAT 40W 120 CM IP20'),
    fake('APB60', 'ALUMBRADO PÚBLICO BESTLED 60W IP66'),
  ];
  const finds = (q: string) => searchThatFinds(mini, q);

  it('un producto dado de baja: se queda con las palabras que siguen encontrando (sin su potencia)', () => {
    expect(searchProducts(mini, 'campana led ufo nf8 100w 110lm w ip65')).toEqual([]);
    expect(finds('campana led ufo nf8 100w 110lm w ip65')).toBe('campana led ufo nf8 110lm ip65');
    expect(finds('lineal led flat 60w 120 cm ip20 6500k')).toBe('lineal led flat 120 cm ip20');
  });

  it('como se escribieron: con tildes y con las medidas juntas', () => {
    expect(finds('alumbrado público bestled 97w')).toBe('alumbrado público bestled');
    expect(finds('lineal 120 cm')).toBe('lineal 120 cm');
  });

  it('sin palabras de una letra, ni empezar por una de menos de 3; vacío si nada encuentra o si solo queda «led»', () => {
    expect(finds('no campana')).toBe('campana');
    expect(finds('una url que no existe')).toBe('');
    expect(finds('led que no existe')).toBe('');
    expect(finds('')).toBe('');
  });

  it('en el catálogo real: nunca precarga una búsqueda sin resultados, y la ficha con otra potencia encuentra algo', () => {
    for (const p of products) {
      const own = searchThatFinds(products, searchTermsFromPath(`/producto/${p.id}`));
      if (own) expect(search(own).length, p.id).toBeGreaterThan(0);
      if (!/\d+w/.test(p.id)) continue;
      const other = `/producto/${p.id.replace(/(\d+)w/, (_m, n) => `${Number(n) + 7}w`)}`;
      const q = searchThatFinds(products, searchTermsFromPath(other));
      expect(q, other).not.toBe('');
      expect(search(q).length, other).toBeGreaterThan(0);
    }
  });
});

describe('sugerencias del encabezado: lo escrito en negrita', () => {
  /** Los trozos marcados, unidos con «|». */
  const bold = (text: string, q: string) => highlightMatches(text, q).filter(p => p.match).map(p => p.text).join('|');

  it('al comienzo de una palabra, sin tildes ni mayúsculas, como está escrito el nombre', () => {
    expect(bold('PROYECTOR LED ANTIVANDÁLICO 70W IP66', 'antiva')).toBe('ANTIVA');
    expect(bold('ALUMBRADO PÚBLICO BESTLED 60W', 'publico')).toBe('PÚBLICO');
    expect(bold('Panel LED 60x60 Luz Cálida', 'CALIDA panel')).toBe('Panel|Cálida');
  });

  it('no marca dentro de una palabra, ni un número solo dentro de otro número', () => {
    expect(bold('FUENTE DE PODER SWITCHING', 'tch')).toBe('');
    expect(bold('PROYECTOR 1000W', '100')).toBe('');
    expect(bold('PROYECTOR 100W', '100')).toBe('100');
  });

  it('las medidas y unidades como las junta la búsqueda: «100 watts» marca «100W», «ip 66» marca «IP66»', () => {
    expect(bold('PROYECTOR LED 100W IP66', '100 watts ip 66')).toBe('100W|IP66');
  });

  it('los trozos vuelven a armar el nombre completo, también sin coincidencias', () => {
    for (const p of products.slice(0, 50)) {
      expect(highlightMatches(p.name, 'led 100w').map(x => x.text).join('')).toBe(p.name);
    }
    expect(highlightMatches('', 'led')).toEqual([]);
  });
});
