#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import logging
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
JSON_OUTPUT = DATA_DIR / "precios_competencia.json"
MD_OUTPUT  = DATA_DIR / "reporte_precios.md"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}
TIMEOUT = 30

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s", stream=sys.stdout)
logger = logging.getLogger(__name__)

# ── Data classes ───────────────────────────────────────────────────────

@dataclass
class ProductPrice:
    competitor: str
    category: str
    name: str
    price_clp: Optional[int]
    price_raw: str
    url: str
    scraped_at: str
# ── WC Store API configs (PowerEnergy + Megabright) ───────────────────

PE_API_BASE = "https://powerenergy.cl/wp-json/wc/store/v1/products"
PE_CATEGORIES = {
    "Proyectores LED": 2362,
    "Paneles LED":     2357,
    "Campanas LED":    2361,
    "Tubos LED":       2359,
}

MB_API_BASE = "https://www.megabright.cl/wp-json/wc/store/v1/products"
MB_CATEGORIES = {
    "Proyectores LED": 599,   # PROYECTORES (27 productos)
    "Paneles LED":     457,   # PANEL LED (42 productos)
    "Campanas LED":    635,   # Campana (3 productos)
    "Tubos LED":       472,   # LINEAL Y TUBOS (15 productos)
}

# ── TecnoIluminacion HTML configs (PrestaShop) ──────────────────────

TECNO_CATEGORIES = {
    "Proyectores LED": "https://tecnoiluminacion.cl/54-proyector-led",
    "Paneles LED":     "https://tecnoiluminacion.cl/25-panel-led",
    "Campanas LED":    "https://tecnoiluminacion.cl/53-campana-led",
    "Tubos LED":       "https://tecnoiluminacion.cl/84-tubo-led",
}
TECNO_MAX_PAGES = 5

def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


# ── Generic WC Store API scraper ──────────────────────────────────────

def scrape_wc_api(competitor: str, api_base: str, categories: dict) -> Dict[str, List[ProductPrice]]:
    """Scrape products using WooCommerce Store API v1."""
    grouped: Dict[str, List[ProductPrice]] = {}
    scraped_at = datetime.now(timezone.utc).isoformat()
    session = requests.Session()
    session.headers.update({"Accept": "application/json", "User-Agent": HEADERS["User-Agent"]})

    for category, cat_id in categories.items():
        key = f"{competitor}::{category}"
        products = []
        page = 1
        while True:
            try:
                url = f"{api_base}?category={cat_id}&per_page=50&page={page}"
                logger.info("%s API: %s page %s", competitor, category, page)
                r = session.get(url, timeout=TIMEOUT)
                r.raise_for_status()
                data = r.json()
                if not data:
                    break
                for item in data:
                    name = item.get("name", "").strip()
                    # Decode HTML entities in name
                    if "&#" in name or "&amp;" in name:
                        from html import unescape
                        name = unescape(name)
                    price_val = int(item.get("prices", {}).get("price", 0) or 0)
                    link = item.get("permalink", "")
                    if not price_val or not name:
                        continue
                    products.append(ProductPrice(
                        competitor=competitor,
                        category=category,
                        name=name,
                        price_clp=price_val,
                        price_raw=f"${price_val:,}".replace(",", "."),
                        url=link,
                        scraped_at=scraped_at,
                    ))
                if len(data) < 50:
                    break
                page += 1
                time.sleep(0.5)
            except Exception as exc:
                logger.exception("Error %s API %s p%s: %s", competitor, category, page, exc)
                break
        grouped[key] = products
        logger.info("%s %s: %s productos", competitor, category, len(products))
        time.sleep(0.5)
    return grouped

# ── TecnoIluminacion HTML scraper (PrestaShop) ───────────────────────

def fetch_html(url: str) -> str:
    logger.info("Solicitando URL: %s", url)
    session = requests.Session()
    session.headers.update(HEADERS)
    response = session.get(url, timeout=TIMEOUT)
    response.raise_for_status()
    return response.text


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
    """Scrape TecnoIluminacion using HTML (PrestaShop with .product-miniature)."""
    grouped: Dict[str, List[ProductPrice]] = {}
    scraped_at = datetime.now(timezone.utc).isoformat()

    for category, base_url in TECNO_CATEGORIES.items():
        key = f"TecnoIluminacion::{category}"
        products = []
        seen_names: set = set()

        for page in range(1, TECNO_MAX_PAGES + 1):
            url = base_url if page == 1 else f"{base_url}?page={page}"
            try:
                time.sleep(1)
                html = fetch_html(url)
                soup = BeautifulSoup(html, "lxml")
                items = soup.select(".product-miniature")
                if not items:
                    logger.info("Tecno %s page %s: sin productos, fin.", category, page)
                    break

                for item in items:
                    # Product name
                    name_el = item.select_one(".product-title a, h3 a")
                    name = clean_text(name_el.get_text(" ", strip=True)) if name_el else ""
                    if not name or name in seen_names:
                        continue

                    # Price
                    price_el = item.select_one(".price")
                    price_raw = clean_text(price_el.get_text(" ", strip=True)) if price_el else ""
                    price_clp = extract_price_clp(price_raw)
                    if not price_clp:
                        continue

                    # URL
                    link_el = item.select_one("a[href]")
                    prod_url = link_el["href"] if link_el and link_el.get("href") else base_url
                    if not prod_url.startswith("http"):
                        prod_url = urljoin(base_url, prod_url)

                    seen_names.add(name)
                    products.append(ProductPrice(
                        competitor="TecnoIluminacion",
                        category=category,
                        name=name,
                        price_clp=price_clp,
                        price_raw=price_raw,
                        url=prod_url,
                        scraped_at=scraped_at,
                    ))

                logger.info("Tecno %s page %s: %s productos en pagina", category, page, len(items))

                # Check if there is a next page
                next_link = soup.select_one("a.next, a[rel=\"next\"]")
                if not next_link:
                    break

            except Exception as exc:
                logger.exception("Error Tecno %s page %s: %s", category, page, exc)
                break

        grouped[key] = products
        logger.info("TecnoIluminacion %s: %s productos total", category, len(products))

    return grouped

# ── Orchestration ─────────────────────────────────────────────────────

def scrape_all() -> Dict[str, List[ProductPrice]]:
    grouped = {}
    # PowerEnergy via WC Store API
    grouped.update(scrape_wc_api("PowerEnergy", PE_API_BASE, PE_CATEGORIES))
    # Megabright via WC Store API
    grouped.update(scrape_wc_api("Megabright", MB_API_BASE, MB_CATEGORIES))
    # TecnoIluminacion via HTML
    grouped.update(scrape_tecnoiluminacion())
    return grouped


# ── Output generators ────────────────────────────────────────────────

def build_json_payload(grouped: Dict[str, List[ProductPrice]]) -> dict:
    generated_at = datetime.now(timezone.utc).isoformat()
    competitors_summary: Dict = {}
    errors = []

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
    competitors_data = payload.get("competitors", {})
    errors = payload.get("errors", [])
    all_competitors = ["PowerEnergy", "Megabright", "TecnoIluminacion"]
    ordered_categories = ["Proyectores LED", "Paneles LED", "Campanas LED", "Tubos LED"]

    lines = [
        "# Reporte comparativo de precios - Competencia",
        f"\nGenerado: {generated_at}\n",
        "## Rango de precios por categoria\n",
        "| Categoria | Competidor | Minimo | Maximo | Productos |",
        "|---|---|---:|---:|---:|",
    ]

    for category in ordered_categories:
        for competitor in all_competitors:
            items = competitors_data.get(competitor, {}).get(category, [])
            prices = [i["price_clp"] for i in items if i.get("price_clp")]
            min_p = format_clp(min(prices)) if prices else "N/D"
            max_p = format_clp(max(prices)) if prices else "N/D"
            lines.append(f"| {category} | {competitor} | {min_p} | {max_p} | {len(items)} |")

    lines.append("\n## Detalle de productos\n")

    for competitor in all_competitors:
        comp_data = competitors_data.get(competitor, {})
        if not comp_data:
            continue
        lines.append(f"### {competitor}\n")
        lines.append("| Categoria | Producto | Precio |")
        lines.append("|---|---|---:|")
        for category in ordered_categories:
            for item in comp_data.get(category, []):
                lines.append(f"| {item['category']} | {item['name'][:60]} | {format_clp(item['price_clp'])} |")
        lines.append("")

    lines.append("\n## Incidencias\n")
    if errors:
        for err in errors:
            lines.append(f"- {err['competitor']} / {err['category']}: {err['error']}")
    else:
        lines.append("- Sin incidencias.")

    return "\n".join(lines)

def main() -> None:
    ensure_data_dir()
    grouped = scrape_all()
    payload = build_json_payload(grouped)

    with JSON_OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    report = generate_markdown(payload)
    with MD_OUTPUT.open("w", encoding="utf-8") as f:
        f.write(report)

    logger.info("JSON: %s", JSON_OUTPUT)
    logger.info("Markdown: %s", MD_OUTPUT)


if __name__ == "__main__":
    main()
