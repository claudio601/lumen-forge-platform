#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Scraper de precios de competidores para eLights.
Fuentes: PowerEnergy (WC API), Megabright (WC API), TecnoIluminacion (HTML).
"""
from __future__ import annotations

import json
import logging
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
JSON_OUTPUT = DATA_DIR / "precios_competencia.json"
MD_OUTPUT  = DATA_DIR / "reporte_precios.md"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
}
TIMEOUT = 30

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s", stream=sys.stdout)
logger = logging.getLogger(__name__)


@dataclass
class ProductPrice:
    competitor: str
    category: str
    name: str
    price_clp: Optional[int]
    price_raw: str
    url: str
    scraped_at: str


# ── WC Store API configs ─────────────────────────────────────────────

PE_API_BASE = "https://powerenergy.cl/wp-json/wc/store/v1/products"
PE_CATEGORIES = {
    "Proyectores LED": 2362,
    "Paneles LED":     2357,
    "Campanas LED":    2361,
    "Tubos LED":       2359,
}

MB_API_BASE = "https://www.megabright.cl/wp-json/wc/store/v1/products"
MB_CATEGORIES = {
    "Proyectores LED": 599,
    "Paneles LED":     457,
    "Campanas LED":    635,
    "Tubos LED":       472,
}

TECNO_CATEGORIES = {
    "Proyectores LED": "https://tecnoiluminacion.cl/54-proyector-led",
    "Paneles LED":     "https://tecnoiluminacion.cl/25-panel-led",
    "Campanas LED":    "https://tecnoiluminacion.cl/53-campana-led",
    "Tubos LED":       "https://tecnoiluminacion.cl/84-tubo-led",
}
TECNO_MAX_PAGES = 5

def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def scrape_wc_api(competitor: str, api_base: str, categories: dict) -> Dict[str, List[ProductPrice]]:
    """Scrape products using WooCommerce Store API v1."""
    grouped: Dict[str, List[ProductPrice]] = {}
    scraped_at = datetime.now(timezone.utc).isoformat()
    session = requests.Session()
    session.headers.update({"Accept": "application/json", "User-Agent": HEADERS["User-Agent"]})

    for category, cat_id in categories.items():
        key = f"{competitor}::{category}"
        products: List[ProductPrice] = []
        page = 1
        while True:
            try:
                url = f"{api_base}?category={cat_id}&per_page=50&page={page}"
                logger.info("%s API: %s page %s", competitor, category, page)
                r = session.get(url, timeout=TIMEOUT)
                if r.status_code == 403:
                    logger.warning("%s API %s: 403 Forbidden (WAF block)", competitor, category)
                    break
                r.raise_for_status()
                data = r.json()
                if not data:
                    break
                for item in data:
                    name = unescape(item.get("name", "").strip())
                    price_val = int(item.get("prices", {}).get("price", 0) or 0)
                    link = item.get("permalink", "")
                    if not price_val or not name:
                        continue
                    products.append(ProductPrice(
                        competitor=competitor, category=category, name=name,
                        price_clp=price_val,
                        price_raw=f"${price_val:,}".replace(",", "."),
                        url=link, scraped_at=scraped_at,
                    ))
                if len(data) < 50:
                    break
                page += 1
                time.sleep(0.5)
            except requests.exceptions.HTTPError:
                logger.warning("%s API %s p%s: HTTP error", competitor, category, page)
                break
            except Exception as exc:
                logger.exception("%s API %s p%s: %s", competitor, category, page, exc)
                break
        grouped[key] = products
        logger.info("%s %s: %s productos", competitor, category, len(products))
        time.sleep(0.5)
    return grouped

def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def extract_price_clp(price_text: str) -> Optional[int]:
    if not price_text:
        return None
    match = re.search(r"(\d[\d\.]*)", price_text)
    if not match:
        return None
    try:
        return int(match.group(1).replace(".", ""))
    except ValueError:
        return None


def scrape_tecnoiluminacion() -> Dict[str, List[ProductPrice]]:
    """Scrape TecnoIluminacion category pages (PrestaShop)."""
    grouped: Dict[str, List[ProductPrice]] = {}
    scraped_at = datetime.now(timezone.utc).isoformat()
    session = requests.Session()
    session.headers.update(HEADERS)

    # Warm up session with homepage to get cookies
    try:
        logger.info("Tecno: warming up session...")
        home_resp = session.get("https://tecnoiluminacion.cl/", timeout=TIMEOUT)
        logger.info("Tecno homepage: status=%s len=%s", home_resp.status_code, len(home_resp.text))
    except Exception as exc:
        logger.warning("Tecno homepage warmup failed: %s", exc)

    for category, base_url in TECNO_CATEGORIES.items():
        key = f"TecnoIluminacion::{category}"
        products: List[ProductPrice] = []
        seen_names: set = set()

        for page in range(1, TECNO_MAX_PAGES + 1):
            url = base_url if page == 1 else f"{base_url}?page={page}"
            try:
                time.sleep(1.5)
                logger.info("Tecno: GET %s", url)
                resp = session.get(url, timeout=TIMEOUT)
                logger.info("Tecno %s p%s: status=%s len=%s", category, page, resp.status_code, len(resp.text))

                if resp.status_code != 200:
                    break

                soup = BeautifulSoup(resp.text, "html.parser")
                title_tag = soup.title
                logger.info("Tecno %s p%s title: %s", category, page, (title_tag.string or "").strip()[:80] if title_tag else "N/A")

                items = soup.select(".product-miniature")
                if not items:
                    items = soup.select("article[data-id-product]")
                if not items:
                    items = soup.select(".js-product-miniature")
                if not items:
                    logger.info("Tecno %s p%s: no products found. Snippet: %s", category, page, resp.text[:200].replace("\n", " "))
                    break
                for item in items:
                    name_el = item.select_one(".product-title a, h3.h3 a, h2 a")
                    name = clean_text(name_el.get_text(" ", strip=True)) if name_el else ""
                    if not name or name in seen_names:
                        continue
                    price_el = item.select_one(".price, .product-price-and-shipping .price")
                    price_raw = clean_text(price_el.get_text(" ", strip=True)) if price_el else ""
                    price_clp = extract_price_clp(price_raw)
                    if not price_clp:
                        continue
                    link_el = item.select_one("a[href]")
                    prod_url = link_el["href"] if link_el and link_el.get("href") else base_url
                    if not prod_url.startswith("http"):
                        prod_url = urljoin(base_url, prod_url)
                    seen_names.add(name)
                    products.append(ProductPrice(
                        competitor="TecnoIluminacion", category=category, name=name,
                        price_clp=price_clp, price_raw=price_raw,
                        url=prod_url, scraped_at=scraped_at,
                    ))

                logger.info("Tecno %s p%s: %s items, %s total", category, page, len(items), len(products))
                next_link = soup.select_one("a.next, a[rel=\"next\"], li.pagination_next a")
                if not next_link:
                    break
            except Exception as exc:
                logger.exception("Tecno %s p%s error: %s", category, page, exc)
                break

        grouped[key] = products
        logger.info("TecnoIluminacion %s: %s productos", category, len(products))
    return grouped

def scrape_all() -> Dict[str, List[ProductPrice]]:
    grouped: Dict[str, List[ProductPrice]] = {}
    grouped.update(scrape_wc_api("PowerEnergy", PE_API_BASE, PE_CATEGORIES))
    grouped.update(scrape_wc_api("Megabright", MB_API_BASE, MB_CATEGORIES))
    grouped.update(scrape_tecnoiluminacion())
    return grouped


def build_json_payload(grouped: Dict[str, List[ProductPrice]]) -> dict:
    generated_at = datetime.now(timezone.utc).isoformat()
    competitors_summary: Dict = {}
    errors: List = []
    for key, products in grouped.items():
        competitor, category = key.split("::", 1)
        if not products:
            errors.append({"competitor": competitor, "category": category, "error": "Sin resultados"})
            continue
        for item in products:
            competitors_summary.setdefault(item.competitor, {})
            competitors_summary[item.competitor].setdefault(item.category, [])
            competitors_summary[item.competitor][item.category].append(asdict(item))
    return {"generated_at": generated_at, "currency": "CLP", "competitors": competitors_summary, "errors": errors}


def format_clp(value: Optional[int]) -> str:
    if value is None:
        return "N/D"
    return f"${value:,}".replace(",", ".")


def generate_markdown(payload: dict) -> str:
    generated_at = payload.get("generated_at", "")
    cd = payload.get("competitors", {})
    errors = payload.get("errors", [])
    comps = ["PowerEnergy", "Megabright", "TecnoIluminacion"]
    cats = ["Proyectores LED", "Paneles LED", "Campanas LED", "Tubos LED"]
    md = ["# Reporte comparativo de precios - Competencia",
          f"\nGenerado: {generated_at}\n",
          "## Resumen\n",
          "| Categoria | Competidor | Min | Max | Productos |",
          "|---|---|---:|---:|---:|"]
    for cat in cats:
        for comp in comps:
            items = cd.get(comp, {}).get(cat, [])
            prices = [i["price_clp"] for i in items if i.get("price_clp")]
            lo = format_clp(min(prices)) if prices else "N/D"
            hi = format_clp(max(prices)) if prices else "N/D"
            md.append(f"| {cat} | {comp} | {lo} | {hi} | {len(items)} |")
    md.append("\n## Detalle\n")
    for comp in comps:
        if comp not in cd:
            continue
        md.append(f"### {comp}\n")
        md.append("| Categoria | Producto | Precio |")
        md.append("|---|---|---:|")
        for cat in cats:
            for item in cd[comp].get(cat, []):
                md.append(f"| {item['category']} | {item['name'][:60]} | {format_clp(item['price_clp'])} |")
        md.append("")
    md.append("\n## Incidencias\n")
    if errors:
        for e in errors:
            md.append(f"- **{e['competitor']}** / {e['category']}: {e['error']}")
    else:
        md.append("- Sin incidencias.")
    return "\n".join(md)

def main() -> None:
    ensure_data_dir()
    grouped = scrape_all()
    payload = build_json_payload(grouped)
    with JSON_OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    report = generate_markdown(payload)
    with MD_OUTPUT.open("w", encoding="utf-8") as f:
        f.write(report)
    total = sum(len(v) for v in grouped.values())
    logger.info("Scraping finalizado. Total: %s productos", total)
    logger.info("JSON: %s", JSON_OUTPUT)
    logger.info("Markdown: %s", MD_OUTPUT)


if __name__ == "__main__":
    main()
