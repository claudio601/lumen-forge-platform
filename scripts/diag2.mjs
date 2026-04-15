import { chromium } from 'playwright';
const DELAY = (ms=2500) => new Promise(r => setTimeout(r, ms));
const br = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

// === MEGABRIGHT ===
console.log('\n=== MEGABRIGHT ===');
{
  const ctx = await br.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const pg = await ctx.newPage();
  await pg.goto('https://www.megabright.cl/categoria-producto/iluminacion-ext/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await DELAY();
  const info = await pg.evaluate(() => {
    return {
      jet: document.querySelectorAll('.jet-listing-grid__item').length,
      liProd: document.querySelectorAll('li.product').length,
      dataProd: document.querySelectorAll('[data-product-id]').length,
      links: Array.from(document.querySelectorAll('a'))
        .filter(a => a.href && !a.href.endsWith('/') && a.href.split('/').length > 4 && a.href.includes('megabright'))
        .slice(0, 4).map(a => ({ href: a.href.slice(0,80), text: a.innerText?.trim()?.slice(0,40), pc: a.parentElement?.className?.slice(0,50) })),
      jetHtml: document.querySelector('.jet-listing-grid__item')?.outerHTML?.replace(/\s+/g,' ')?.slice(0,400) || 'none'
    };
  });
  console.log('jet:', info.jet, 'li.product:', info.liProd, '[data-product-id]:', info.dataProd);
  console.log('Links:', JSON.stringify(info.links, null, 2));
  console.log('JetHTML:', info.jetHtml);
  await ctx.close();
}

// === LEDSTUDIO VTEX ===
console.log('\n=== LEDSTUDIO (VTEX) ===');
{
  const ctx = await br.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const pg = await ctx.newPage();
  await pg.goto('https://www.ledstudio.cl/iluminacion-hogar', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await DELAY(4000);
  const info = await pg.evaluate(() => {
    const sels = ['article', '[class*="ProductSummary"]', '[class*="productSummary"]', '[class*="product-summary"]',
      '[class*="shelf"]', '[data-testid]', '[class*="vtex"]'];
    const counts = {};
    sels.forEach(s => { const n = document.querySelectorAll(s).length; if(n>0) counts[s]=n; });
    const links = Array.from(document.querySelectorAll('a'))
      .filter(a => a.href && a.href.includes('ledstudio') && a.href.endsWith('/p'))
      .slice(0,3).map(a => ({ href: a.href.slice(0,80), text: a.innerText?.trim()?.slice(0,40) }));
    const art = document.querySelector('article');
    const artHtml = art ? art.outerHTML.replace(/\s+/g,' ').slice(0,400) : 'no article';
    return { counts, links, artHtml };
  });
  console.log('Counts:', JSON.stringify(info.counts));
  console.log('Links /p:', JSON.stringify(info.links, null, 2));
  console.log('ArticleHTML:', info.artHtml);
  await ctx.close();
}

// === DEMASLED detail ===
console.log('\n=== DEMASLED detail ===');
{
  const ctx = await br.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const pg = await ctx.newPage();
  await pg.goto('https://www.demasled.cl/proyectores-led/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await DELAY();
  const info = await pg.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-product-id]')).slice(0,3);
    return items.map(el => ({
      tag: el.tagName,
      cls: el.className.slice(0,80),
      id: el.getAttribute('data-product-id'),
      name: el.querySelector('h3,h2,h4,[class*="title"],[class*="name"]')?.innerText?.trim()?.slice(0,50) || '',
      price: el.querySelector('[class*="price"],[class*="amount"]')?.innerText?.trim()?.slice(0,30) || '',
      link: el.querySelector('a')?.href?.slice(0,70) || '',
      html: el.outerHTML.replace(/\s+/g,' ').slice(0,400)
    }));
  });
  console.log(JSON.stringify(info, null, 2));
  await ctx.close();
}

await br.close();
console.log('\n=== FIN ===');
