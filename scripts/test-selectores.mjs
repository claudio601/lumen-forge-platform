import { chromium } from 'playwright';

const DELAY = (ms = 2500) => new Promise(r => setTimeout(r, ms));

async function diagSite(browser, label, url) {
  console.log('\n' + '═'.repeat(65));
  console.log(`🔬 ${label}`);
  console.log(`   URL: ${url}`);
  console.log('═'.repeat(65));

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await DELAY();

    // 1. Plataforma
    const platform = await page.evaluate(() => {
      const h = document.documentElement.innerHTML;
      if (h.includes('woocommerce')) return 'WooCommerce';
      if (h.includes('prestashop') || h.includes('PrestaShop')) return 'PrestaShop';
      if (h.includes('shopify') || h.includes('/cdn/shop/')) return 'Shopify';
      if (h.includes('jumpseller')) return 'Jumpseller';
      if (h.includes('jet-listing')) return 'JetEngine+Elementor';
      return 'Desconocida';
    });
    console.log(`\n📦 Plataforma detectada: ${platform}`);

    // 2. Conteo de candidatos clave
    const counts = await page.evaluate(() => {
      const selectors = [
        'li.product', 'ul.products li', '.products li',
        'article.product-miniature', '.product-miniature',
        '.product-item', '.product-card', '.product_item',
        '.jet-listing-grid__item',
        '.woocommerce-loop-product__title',
        '[class*="product-grid"] li', '[class*="product-list"] li',
        '[class*="product-loop"] li',
        '.archive-product', '.product-wrapper',
        'div[class*="product"][class*="col"]',
        '[data-product-id]', '[data-pid]',
      ];
      return selectors.reduce((acc, s) => {
        const n = document.querySelectorAll(s).length;
        if (n > 0) acc[s] = n;
        return acc;
      }, {});
    });

    console.log('\n📊 Selectores con hits:');
    if (Object.keys(counts).length === 0) {
      console.log('   ⚠️  NINGÚN selector estándar encontró elementos');
    } else {
      Object.entries(counts).forEach(([s, n]) => console.log(`   ${n.toString().padStart(3)}x  ${s}`));
    }

    // 3. Buscar contenedor real con nombre+precio via links de producto
    const productData = await page.evaluate(() => {
      // Encontrar todos los links que huelen a producto
      const productLinks = Array.from(document.querySelectorAll('a')).filter(a => {
        const h = a.href || '';
        return h && !h.includes('#') && !h.endsWith('/') &&
          (h.includes('/producto') || h.includes('/product') ||
           h.includes('/iluminacion') || h.includes('/proyector') ||
           h.includes('/panel') || h.includes('/campana') ||
           h.includes('/tubo') || h.includes('/foco') ||
           h.includes('/led'));
      });

      // Agrupar los únicos
      const seen = new Set();
      const unique = productLinks.filter(a => {
        if (seen.has(a.href)) return false;
        seen.add(a.href);
        return true;
      }).slice(0, 5);

      return unique.map(a => {
        // Subir en el DOM hasta encontrar un contenedor con precio
        let el = a;
        let depth = 0;
        let priceEl = null;
        let nameEl = null;
        while (el && depth < 8) {
          priceEl = el.querySelector('[class*="price"], [class*="amount"], [class*="precio"]');
          nameEl = el.querySelector('h1,h2,h3,h4,h5,[class*="title"],[class*="name"],[class*="nombre"]');
          if (priceEl && nameEl) break;
          el = el.parentElement;
          depth++;
        }
        return {
          href: a.href.slice(0, 80),
          linkText: a.innerText.trim().slice(0, 50),
          containerTag: el ? el.tagName : '?',
          containerClass: el ? el.className.slice(0, 80) : '?',
          name: nameEl ? nameEl.innerText.trim().slice(0, 50) : '',
          nameSelector: nameEl ? `${nameEl.tagName.toLowerCase()}.${nameEl.className.split(' ')[0]}` : '',
          price: priceEl ? priceEl.innerText.trim().slice(0, 30) : '',
          priceSelector: priceEl ? `${priceEl.tagName.toLowerCase()}.${priceEl.className.split(' ')[0]}` : '',
          depth,
        };
      });
    });

    console.log('\n🔗 Productos detectados por links:');
    if (productData.length === 0) {
      console.log('   ⚠️  No se encontraron links con patrón de producto');
    } else {
      productData.forEach((p, i) => {
        console.log(`\n  ${i+1}. "${p.linkText || p.href.split('/').slice(-2,-1)[0]}"`);
        console.log(`     Nombre:  "${p.name}" → <${p.nameSelector}>`);
        console.log(`     Precio:  "${p.price}" → <${p.priceSelector}>`);
        console.log(`     Contenedor: <${p.containerTag} class="${p.containerClass}">`);
        console.log(`     Profundidad subida: ${p.depth} niveles`);
      });
    }

    // 4. Detectar lazy loading / paginación Ajax
    const paginationInfo = await page.evaluate(() => {
      const signals = {
        infiniteScroll: !!(window._wc_load_more_params || 
          document.querySelector('[data-infinite-scroll]') ||
          document.querySelector('.infinite-scroll-request') ||
          document.querySelector('[class*="infinite"]')),
        ajaxLoad: !!(document.querySelector('[data-ajax]') ||
          document.querySelector('.jet-filters-pagination') ||
          document.querySelector('[class*="ajax"]')),
        standardPagination: !!(document.querySelector('.page-numbers') ||
          document.querySelector('.woocommerce-pagination') ||
          document.querySelector('nav.woocommerce-pagination') ||
          document.querySelector('.pagination')),
        loadMore: !!(document.querySelector('[class*="load-more"]') ||
          document.querySelector('button[class*="more"]')),
        totalProducts: (() => {
          const c = document.querySelector('.woocommerce-result-count, .showing-results, [class*="result-count"]');
          return c ? c.innerText.trim() : '';
        })(),
      };
      return signals;
    });

    console.log('\n⚡ Paginación / carga dinámica:');
    console.log(`   Infinite scroll: ${paginationInfo.infiniteScroll ? '✅ SÍ' : '❌ No'}`);
    console.log(`   Ajax load:       ${paginationInfo.ajaxLoad ? '✅ SÍ' : '❌ No'}`);
    console.log(`   Paginación std:  ${paginationInfo.standardPagination ? '✅ SÍ' : '❌ No'}`);
    console.log(`   Botón "Load More": ${paginationInfo.loadMore ? '✅ SÍ' : '❌ No'}`);
    if (paginationInfo.totalProducts) {
      console.log(`   Conteo visible: "${paginationInfo.totalProducts}"`);
    }

    // 5. Dump del HTML del primer elemento que parece producto
    const htmlDump = await page.evaluate(() => {
      const candidates = [
        'li.product', 'article.product-miniature',
        '.product-item', '.product-card',
        '[class*="product-inner"]',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) return { selector: sel, html: el.outerHTML.slice(0, 600) };
      }
      // fallback: cualquier elemento con precio
      const priceEl = document.querySelector('[class*="price"] [class*="amount"], .woocommerce-Price-amount');
      if (priceEl) {
        let p = priceEl;
        for (let i = 0; i < 5; i++) p = p.parentElement;
        return { selector: 'precio-ancestor-5', html: p ? p.outerHTML.slice(0, 600) : '' };
      }
      return { selector: 'none', html: '' };
    });

    if (htmlDump.html) {
      console.log(`\n📄 HTML muestra (${htmlDump.selector}):`);
      console.log(htmlDump.html.replace(/\s+/g, ' ').slice(0, 500));
    }

  } catch (err) {
    console.error(`  ❌ Error: ${err.message}`);
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    await diagSite(browser, 'DemasLED (PrestaShop?)', 'https://www.demasled.cl/proyectores-led/');
    await diagSite(browser, 'Megabright (WooCommerce?)', 'https://www.megabright.cl/categoria-producto/iluminacion-ext/');
    await diagSite(browser, 'LEDStudio', 'https://www.ledstudio.cl/');
  } finally {
    await browser.close();
  }
  console.log('\n' + '═'.repeat(65));
  console.log('✅ Diagnóstico completo');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
