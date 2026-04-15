// scripts/scraper-precios.mjs
// Scraper de precios competidores eLights
// Uso: node scripts/scraper-precios.mjs

import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
// 1. CARGA DE PRODUCTOS eLights desde JSON
// ─────────────────────────────────────────────
function loadELightsProducts() {
  const jsonPath = join(__dirname, 'elights-products.json');
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  console.log(`   ${data.length} productos cargados desde elights-products.json`);
  return data;
}

// ─────────────────────────────────────────────
// 2. HELPERS DE MATCHING
// ─────────────────────────────────────────────
function extractType(product) {
  const text = `${product.category} ${product.name}`.toLowerCase();
  if (text.includes('proyector') || text.includes('flood'))                            return 'proyector';
  if (text.includes('campana') || text.includes('highbay') || text.includes('high bay')) return 'campana';
  if (text.includes('panel'))                                                           return 'panel';
  if (text.includes('tubo') || text.includes('tube'))                                  return 'tubo';
  if (text.includes('solar'))                                                           return 'solar';
  if (text.includes('street') || text.includes('vial') || text.includes('alumbrado'))  return 'vial';
  if (text.includes('downlight'))                                                       return 'downlight';
  if (text.includes('lineal') || text.includes('regleta'))                             return 'lineal';
  if (text.includes('bombilla') || text.includes('bulbo'))                             return 'bombilla';
  if (text.includes('tira') || text.includes('strip'))                                 return 'tira';
  return 'otro';
}

function extractWattsFromName(name) {
  const patterns = [/(\d+(?:\.\d+)?)\s*watts?\b/i, /(\d+(?:\.\d+)?)\s*w\b/i, /(\d+)w/i];
  for (const pat of patterns) {
    const m = name.match(pat);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

function extractTypeFromName(name) {
  const text = name.toLowerCase();
  if (text.includes('proyector') || text.includes('reflector') || text.includes('flood')) return 'proyector';
  if (text.includes('campana') || text.includes('highbay') || text.includes('high bay') || text.includes('industrial')) return 'campana';
  if (text.includes('panel'))       return 'panel';
  if (text.includes('tubo') || text.includes('tube') || text.includes('t8'))  return 'tubo';
  if (text.includes('solar'))       return 'solar';
  if (text.includes('street') || text.includes('vial') || text.includes('alumbrado')) return 'vial';
  if (text.includes('downlight'))   return 'downlight';
  if (text.includes('lineal') || text.includes('regleta') || text.includes('barra'))   return 'lineal';
  if (text.includes('bombilla') || text.includes('bulbo') || text.includes('foco'))    return 'bombilla';
  if (text.includes('tira') || text.includes('strip'))                                  return 'tira';
  return 'otro';
}

function matchScore(elightsProduct, competitorProduct) {
  const elightsType = extractType(elightsProduct);
  const compType    = extractTypeFromName(competitorProduct.nombre);
  const compWatts   = extractWattsFromName(competitorProduct.nombre);
  let score = 0;
  if (elightsType !== 'otro' && compType === elightsType) score += 10;
  if (compWatts && elightsProduct.watts > 0) {
    const pctDiff = Math.abs(compWatts - elightsProduct.watts) / elightsProduct.watts;
    if (pctDiff === 0)        score += 10;
    else if (pctDiff <= 0.05) score += 8;
    else if (pctDiff <= 0.15) score += 5;
    else if (pctDiff <= 0.30) score += 2;
  }
  return score;
}

function findBestMatch(elightsProduct, competitorCatalog) {
  if (!competitorCatalog || competitorCatalog.length === 0) return null;
  let best = null, bestScore = -1;
  for (const item of competitorCatalog) {
    const score = matchScore(elightsProduct, item);
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= 5 ? best : null;
}

// ─────────────────────────────────────────────
// 3. SCRAPERS POR COMPETIDOR
// ─────────────────────────────────────────────
const DELAY = () => new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

function parsePrice(text) {
  if (!text) return null;
  const clean = text.replace(/[^\d]/g, '');
  return clean ? parseInt(clean, 10) : null;
}

// ── 3.1 PowerEnergy (JetEngine + Elementor) ───────────────────────────────
async function scrapePowerEnergy(browser) {
  const products = [];
  const baseUrl = 'https://www.powerenergy.cl/tienda/';
  console.log('\n🔍 Scrapeando PowerEnergy (JetEngine + Elementor)...');
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();
  try {
    let pageNum = 1, hasNext = true;
    while (hasNext) {
      const url = pageNum === 1 ? baseUrl : `${baseUrl}page/${pageNum}/`;
      console.log(`  → Página ${pageNum}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await DELAY();

      const jetCount = await page.$$eval('.jet-listing-grid__item', els => els.length).catch(() => 0);
      console.log(`     .jet-listing-grid__item: ${jetCount}`);

      const items = await page.$$eval('.jet-listing-grid__item', nodes =>
        nodes.map(n => ({
          nombre: n.querySelector('.jet-listing-dynamic-field__content, h1, h2, h3, h4, h5, [class*="title"], [class*="name"]')?.innerText?.trim() || '',
          precio: n.querySelector('.precio-tiered, .woocommerce-Price-amount, [class*="price"]')?.innerText?.trim() || '',
          url:    n.querySelector('a[href*="/producto/"], a[href*="/product/"], a')?.href || '',
        }))
      ).catch(() => []);

      const seen = new Set();
      for (const item of items) {
        seen.add(item.url);
        const precio = parsePrice(item.precio);
        if (item.nombre && precio) products.push({ nombre: item.nombre, precio, url: item.url, competidor: 'PowerEnergy' });
      }
      console.log(`     → ${items.length} items raw, ${products.length} acumulados`);

      const nextLink = await page.$('a.next, a.next.page-numbers, .jet-filters-pagination__next').catch(() => null);
      hasNext = !!nextLink && items.length > 0;
      pageNum++;
      if (pageNum > 50) break;
    }
  } catch (err) { console.error('  ⚠️  Error PowerEnergy:', err.message); }
  finally { await context.close(); }
  console.log(`  ✅ PowerEnergy: ${products.length} productos`);
  return products;
}

// ── 3.2 DemasLED (PrestaShop) ──────────────────────────────────────────────
async function scrapeDemasLED(browser) {
  const products = [];
  const baseUrl = 'https://www.demasled.cl/';
  console.log('\n🔍 Scrapeando DemasLED (PrestaShop)...');
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await DELAY();
    const categoryLinks = await page.$$eval(
      '#top-menu a, .category-top-menu a, nav a[href*="/es/"]',
      links => [...new Set(links.map(a => a.href).filter(h => h.includes('/es/') && !h.includes('#') && !h.endsWith('/es/')))]
    );
    const urls = categoryLinks.length > 0 ? categoryLinks : [baseUrl];
    console.log(`  → ${urls.length} categorías`);
    for (const catUrl of urls) {
      let pageNum = 1, hasNext = true;
      while (hasNext) {
        const url = pageNum === 1 ? catUrl : `${catUrl}?page=${pageNum}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await DELAY();
        const items = await page.$$eval(
          'article.product-miniature, .product-miniature',
          nodes => nodes.map(n => ({
            nombre: n.querySelector('.product-title a, h3 a, .h3 a')?.innerText?.trim() || '',
            precio: n.querySelector('.price, .product-price, span[itemprop="price"]')?.innerText?.trim() || '',
            url:    n.querySelector('.product-title a, h3 a, a')?.href || '',
          }))
        );
        for (const item of items) {
          const precio = parsePrice(item.precio);
          if (item.nombre && precio) products.push({ nombre: item.nombre, precio, url: item.url, competidor: 'DemasLED' });
        }
        console.log(`  → ${catUrl.split('/').pop() || 'home'}, pág ${pageNum}: ${items.length} productos`);
        const nextLink = await page.$('a[rel="next"], .next a, li.next a');
        hasNext = !!nextLink && items.length > 0;
        pageNum++;
        if (pageNum > 30) break;
      }
    }
  } catch (err) { console.error('  ⚠️  Error DemasLED:', err.message); }
  finally { await context.close(); }
  const seen = new Set();
  const unique = products.filter(p => { if (seen.has(p.url)) return false; seen.add(p.url); return true; });
  console.log(`  ✅ DemasLED: ${unique.length} productos`);
  return unique;
}

// ── 3.3 Megabright (WooCommerce) ───────────────────────────────────────────
async function scrapeMegabright(browser) {
  const products = [];
  const baseUrl = 'https://www.megabright.cl/';
  console.log('\n🔍 Scrapeando Megabright (WooCommerce)...');
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await DELAY();
    const categoryLinks = await page.$$eval(
      'a[href*="product-category"], a[href*="categoria"]',
      links => [...new Set(links.map(a => a.href))]
    );
    const shopUrl = `${baseUrl}tienda/`;
    const urls = categoryLinks.length > 0 ? categoryLinks : [shopUrl, baseUrl];
    console.log(`  → ${urls.length} URLs de catálogo`);
    for (const catUrl of urls) {
      let pageNum = 1, hasNext = true;
      while (hasNext) {
        const url = pageNum === 1 ? catUrl : `${catUrl}page/${pageNum}/`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await DELAY();
        const items = await page.$$eval('li.product', nodes =>
          nodes.map(n => ({
            nombre: n.querySelector('.woocommerce-loop-product__title, h2, .product-title')?.innerText?.trim() || '',
            precio: n.querySelector('.price .amount, .woocommerce-Price-amount')?.innerText?.trim() || '',
            url:    n.querySelector('a.woocommerce-LoopProduct-link, a')?.href || '',
          }))
        );
        for (const item of items) {
          const precio = parsePrice(item.precio);
          if (item.nombre && precio) products.push({ nombre: item.nombre, precio, url: item.url, competidor: 'Megabright' });
        }
        console.log(`  → ${catUrl.split('/').slice(-2,-1)[0] || 'home'}, pág ${pageNum}: ${items.length} productos`);
        const nextLink = await page.$('a.next.page-numbers');
        hasNext = !!nextLink && items.length > 0;
        pageNum++;
        if (pageNum > 50) break;
      }
    }
  } catch (err) { console.error('  ⚠️  Error Megabright:', err.message); }
  finally { await context.close(); }
  const seen = new Set();
  const unique = products.filter(p => { if (seen.has(p.url)) return false; seen.add(p.url); return true; });
  console.log(`  ✅ Megabright: ${unique.length} productos`);
  return unique;
}

// ── 3.4 WantEnergia ────────────────────────────────────────────────────────
async function scrapeWantEnergia(browser) {
  const products = [];
  const baseUrl = 'https://wantenergia.cl/';
  console.log('\n🔍 Scrapeando WantEnergia...');
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await DELAY();
    const html = await page.content();
    const platform = html.includes('woocommerce') ? 'WooCommerce'
      : html.includes('Shopify') || html.includes('/cdn/shop/') ? 'Shopify'
      : html.includes('jumpseller') ? 'Jumpseller'
      : html.includes('prestashop') ? 'PrestaShop' : 'Desconocida';
    console.log(`  → Plataforma detectada: ${platform}`);

    const shopLinks = await page.$$eval(
      'a[href*="categoria"], a[href*="product-category"], a[href*="collections"], a[href*="tienda"], a[href*="productos"]',
      links => [...new Set(links.map(a => a.href))]
    ).catch(() => []);
    const urlsToScrape = shopLinks.length > 0 ? [baseUrl, ...shopLinks.slice(0, 20)] : [baseUrl];

    const selectors = [
      { c: 'li.product',                  n: '.woocommerce-loop-product__title, h2', p: '.price .amount, .woocommerce-Price-amount', l: 'a' },
      { c: '.product-item, .product-card',n: '[class*="title"], h3',                 p: '[class*="price"]',                          l: 'a' },
      { c: 'article.product-miniature',   n: '.product-title a',                     p: '.price',                                     l: '.product-title a' },
      { c: '.grid__item',                 n: '.card__heading, h3',                   p: '.price__regular, .price',                    l: 'a' },
    ];

    for (const catUrl of urlsToScrape) {
      let pageNum = 1, hasNext = true;
      while (hasNext) {
        const url = pageNum === 1 ? catUrl : `${catUrl}${catUrl.includes('?') ? '&' : '?'}page=${pageNum}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await DELAY();
        let found = 0;
        for (const sel of selectors) {
          const items = await page.$$eval(sel.c, (nodes, s) => nodes.map(n => ({
            nombre: n.querySelector(s.n)?.innerText?.trim() || '',
            precio: n.querySelector(s.p)?.innerText?.trim() || '',
            url:    n.querySelector(s.l)?.href || '',
          })), sel).catch(() => []);
          const valid = items.filter(i => i.nombre && parsePrice(i.precio));
          if (valid.length > found) {
            found = valid.length;
            for (const item of valid) products.push({ nombre: item.nombre, precio: parsePrice(item.precio), url: item.url, competidor: 'WantEnergia' });
          }
          if (found > 0) break;
        }
        console.log(`  → pág ${pageNum}: ${found} productos`);
        const nextLink = await page.$('a.next, a[rel="next"], a.next.page-numbers').catch(() => null);
        hasNext = !!nextLink && found > 0;
        pageNum++;
        if (pageNum > 30) break;
      }
    }
  } catch (err) { console.error('  ⚠️  Error WantEnergia:', err.message); }
  finally { await context.close(); }
  const seen = new Set();
  const unique = products.filter(p => { if (seen.has(p.url)) return false; seen.add(p.url); return true; });
  console.log(`  ✅ WantEnergia: ${unique.length} productos`);
  return unique;
}

// ── 3.5 LEDStudio ──────────────────────────────────────────────────────────
async function scrapeLEDStudio(browser) {
  const products = [];
  const baseUrl = 'https://www.ledstudio.cl/';
  console.log('\n🔍 Scrapeando LEDStudio...');
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await DELAY();
    const html = await page.content();
    const platform = html.includes('woocommerce') ? 'WooCommerce'
      : html.includes('Shopify') || html.includes('/cdn/shop/') ? 'Shopify'
      : html.includes('jumpseller') ? 'Jumpseller'
      : html.includes('prestashop') ? 'PrestaShop' : 'Desconocida';
    console.log(`  → Plataforma detectada: ${platform}`);

    const shopLinks = await page.$$eval(
      'a[href*="product-category"], a[href*="collections"], a[href*="tienda"], a[href*="categoria"], nav a',
      links => [...new Set(links.map(a => a.href).filter(h => h.includes('ledstudio.cl') && !h.includes('#') && h !== baseUrl))]
    ).catch(() => []);
    const urlsToScrape = shopLinks.length > 0
      ? [baseUrl, ...shopLinks.slice(0, 25)]
      : [baseUrl, `${baseUrl}tienda/`, `${baseUrl}productos/`];

    const selectors = [
      { c: 'li.product',                   n: '.woocommerce-loop-product__title, h2', p: '.price .amount, .woocommerce-Price-amount', l: 'a' },
      { c: '.product-item, .product-card', n: '[class*="title"], h3',                 p: '[class*="price"]',                          l: 'a' },
      { c: 'article.product-miniature',    n: '.product-title a',                     p: '.price',                                     l: '.product-title a' },
      { c: '.grid__item',                  n: '.card__heading, h3',                   p: '.price__regular, .price',                    l: 'a' },
    ];

    for (const catUrl of urlsToScrape) {
      let pageNum = 1, hasNext = true;
      while (hasNext) {
        const sep = catUrl.includes('?') ? '&' : (catUrl.endsWith('/') ? '' : '/');
        const url = pageNum === 1 ? catUrl : `${catUrl}${sep}page/${pageNum}/`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await DELAY();
        let found = 0;
        for (const sel of selectors) {
          const items = await page.$$eval(sel.c, (nodes, s) => nodes.map(n => ({
            nombre: n.querySelector(s.n)?.innerText?.trim() || '',
            precio: n.querySelector(s.p)?.innerText?.trim() || '',
            url:    n.querySelector(s.l)?.href || '',
          })), sel).catch(() => []);
          const valid = items.filter(i => i.nombre && parsePrice(i.precio));
          if (valid.length > found) {
            found = valid.length;
            for (const item of valid) products.push({ nombre: item.nombre, precio: parsePrice(item.precio), url: item.url, competidor: 'LEDStudio' });
          }
          if (found > 0) break;
        }
        console.log(`  → ${catUrl.split('/').slice(-2,-1)[0] || 'home'}, pág ${pageNum}: ${found} productos`);
        const nextLink = await page.$('a.next, a[rel="next"], a.next.page-numbers').catch(() => null);
        hasNext = !!nextLink && found > 0;
        pageNum++;
        if (pageNum > 30) break;
      }
    }
  } catch (err) { console.error('  ⚠️  Error LEDStudio:', err.message); }
  finally { await context.close(); }
  const seen = new Set();
  const unique = products.filter(p => { if (seen.has(p.url)) return false; seen.add(p.url); return true; });
  console.log(`  ✅ LEDStudio: ${unique.length} productos`);
  return unique;
}

// ─────────────────────────────────────────────
// 4. GENERACIÓN DEL REPORTE EXCEL
// ─────────────────────────────────────────────
function generateExcel(elightsProducts, catalogs) {
  const COMPETITORS = [
    { key: 'PowerEnergy', label: 'PowerEnergy' },
    { key: 'DemasLED',    label: 'DemasLED' },
    { key: 'Megabright',  label: 'Megabright' },
    { key: 'WantEnergia', label: 'WantEnergia' },
    { key: 'LEDStudio',   label: 'LEDStudio' },
  ];

  const rows = [];
  for (const product of elightsProducts) {
    const row = {
      'SKU':            product.sku,
      'Nombre eLights': product.name,
      'Watts':          product.watts || '',
      'Precio eLights': product.price,
    };
    const competitorPrices = [];
    for (const comp of COMPETITORS) {
      const catalog = catalogs[comp.key] || [];
      const match   = findBestMatch(product, catalog);
      if (match) {
        row[`${comp.label} precio`] = match.precio;
        row[`${comp.label} URL`]    = match.url;
        competitorPrices.push({ nombre: comp.label, precio: match.precio });
      } else {
        row[`${comp.label} precio`] = '';
        row[`${comp.label} URL`]    = '';
      }
    }
    if (competitorPrices.length > 0) {
      const minComp = competitorPrices.reduce((a, b) => a.precio < b.precio ? a : b);
      const diffPct = product.price > 0
        ? (((product.price - minComp.precio) / product.price) * 100).toFixed(1)
        : '';
      row['Más barato']        = minComp.nombre;
      row['Precio más barato'] = minComp.precio;
      row['Diferencia %']      = `${diffPct}%`;
    } else {
      row['Más barato'] = ''; row['Precio más barato'] = ''; row['Diferencia %'] = '';
    }
    rows.push(row);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 22 }, { wch: 52 }, { wch: 8 }, { wch: 15 },
    ...COMPETITORS.flatMap(() => [{ wch: 18 }, { wch: 50 }]),
    { wch: 15 }, { wch: 18 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Precios Comparativos');

  // Hoja resumen
  const summaryRows = COMPETITORS.map(comp => ({
    'Competidor':           comp.label,
    'Productos scrapeados': (catalogs[comp.key] || []).length,
    'Matches encontrados':  rows.filter(r => r[`${comp.label} precio`] !== '').length,
    'Veces más barato':     rows.filter(r => r['Más barato'] === comp.label).length,
  }));
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 15 }, { wch: 22 }, { wch: 20 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

  const outputPath = join(__dirname, 'reporte-precios.xlsx');
  XLSX.writeFile(wb, outputPath);
  console.log(`\n✅ Reporte generado: ${outputPath}`);
  console.log(`   ${rows.length} productos eLights comparados`);

  // Mini-resumen en consola
  console.log('\n📊 Resumen de matches:');
  summaryRows.forEach(r => console.log(`   ${r['Competidor'].padEnd(14)}: ${r['Productos scrapeados']} prods scrapeados | ${r['Matches encontrados']} matches | ${r['Veces más barato']} veces más barato`));
}

// ─────────────────────────────────────────────
// 5. MAIN
// ─────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  eLights — Scraper de precios competidores    ');
  console.log('═══════════════════════════════════════════════');

  console.log('\n📦 Cargando productos eLights...');
  const elightsProducts = loadELightsProducts();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const powerEnergy = await scrapePowerEnergy(browser);
    const demasLED    = await scrapeDemasLED(browser);
    const megabright  = await scrapeMegabright(browser);
    const wantEnergia = await scrapeWantEnergia(browser);
    const ledStudio   = await scrapeLEDStudio(browser);

    const catalogs = { PowerEnergy: powerEnergy, DemasLED: demasLED, Megabright: megabright, WantEnergia: wantEnergia, LEDStudio: ledStudio };

    console.log('\n📊 Resumen scraping:');
    for (const [name, cat] of Object.entries(catalogs))
      console.log(`   ${name.padEnd(14)}: ${cat.length} productos`);

    console.log('\n📝 Generando reporte Excel...');
    generateExcel(elightsProducts, catalogs);

  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error('Error fatal:', err); process.exit(1); });
