import { chromium } from 'playwright';

const DELAY = () => new Promise(r => setTimeout(r, 1200 + Math.random() * 800));

// Parsea precios chilenos incluyendo "Desde $7.130 + IVA" → 7130
function parsePrice(text) {
  if (!text) return null;
  const clean = text.replace(/[^\d]/g, '');
  return clean ? parseInt(clean, 10) : null;
}

async function testPowerEnergy() {
  console.log('🧪 Test scraping — PowerEnergy (máx 2 páginas)\n');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();
  const allProducts = [];

  try {
    for (let pageNum = 1; pageNum <= 2; pageNum++) {
      const url = pageNum === 1
        ? 'https://www.powerenergy.cl/tienda/'
        : 'https://www.powerenergy.cl/tienda/page/2/';

      console.log(`📄 Cargando página ${pageNum}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await DELAY();

      // PowerEnergy: JetEngine + Elementor — contenedor: .jet-listing-grid__item
      const jetCount = await page.$$eval('.jet-listing-grid__item', els => els.length).catch(() => 0);
      console.log(`   .jet-listing-grid__item encontrados: ${jetCount}`);

      const items = await page.$$eval('.jet-listing-grid__item', nodes =>
        nodes.map(n => {
          // Nombre: buscar en campos dinámicos de JetEngine o headings
          const nameEl = n.querySelector(
            '.jet-listing-dynamic-field__content, h1, h2, h3, h4, h5, [class*="title"], [class*="name"]'
          );
          // Precio: puede ser .precio-tiered o .woocommerce-Price-amount
          const priceEl = n.querySelector('.precio-tiered, .woocommerce-Price-amount, [class*="price"]');
          // URL: primer link con /producto/ en href
          const linkEl = n.querySelector('a[href*="/producto/"], a[href*="/product/"], a');
          return {
            nombre: nameEl?.innerText?.trim() || '',
            precio: priceEl?.innerText?.trim() || '',
            url: linkEl?.href || '',
          };
        })
      ).catch(() => []);

      // Deduplicar por URL y filtrar los que tienen nombre + precio
      const seen = new Set();
      for (const item of items) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        const precio = parsePrice(item.precio);
        if (item.nombre && precio) {
          allProducts.push({ ...item, precioNum: precio });
        }
      }

      console.log(`   → ${items.length} items raw, ${allProducts.length} acumulados con nombre+precio`);

      // Verificar si hay página siguiente
      const nextLink = await page.$('a.next, a.next.page-numbers, [aria-label="Next page"], .jet-filters-pagination__next').catch(() => null);
      if (!nextLink && pageNum === 1) {
        console.log('   (no hay botón "siguiente" visible — puede ser página única)');
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log('\n' + '═'.repeat(60));
  if (allProducts.length > 0) {
    console.log(`✅ ÉXITO — ${allProducts.length} productos encontrados en total\n`);
    console.log('Primeros 5:\n');
    allProducts.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i+1}. ${p.nombre}`);
      console.log(`     Precio raw: "${p.precio}"`);
      console.log(`     Precio num: $${p.precioNum.toLocaleString('es-CL')}`);
      console.log(`     URL: ${p.url}`);
      console.log();
    });
    console.log('✅ SELECTORES OK — listo para correr el scraper completo');
  } else {
    console.log('❌ FALLÓ — 0 productos con nombre+precio encontrados');
    console.log('   Revisar selectores antes de correr el script completo.');
  }
}

testPowerEnergy().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
