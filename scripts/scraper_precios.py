#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations
import json
import logging
import re
import sys
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
MD_OUTPUT = DATA_DIR / "reporte_precios.md"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
}
TIMEOUT = 25

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

@dataclass
class CategoryConfig:
    competitor: str
    category: str
    url: str
    product_selector: str
    price_selector: str

CATEGORIES: List[CategoryConfig] = [
    CategoryConfig("PowerEnergy", "Proyectores LED", "https://powerenergy.cl/seccion-producto/proyector/", ".product", ".woocommerce-Price-amount"),
    CategoryConfig("PowerEnergy", "Paneles LED", "https://powerenergy.cl/seccion-producto/led-panel/", ".product", ".woocommerce-Price-amount"),
    CategoryConfig("PowerEnergy", "Campanas LED", "https://powerenergy.cl/seccion-producto/campanas/", ".product", ".woocommerce-Price-amount"),
    CategoryConfig("PowerEnergy", "Tubos LED", "https://powerenergy.cl/seccion-producto/tubo/", ".product", ".woocommerce-Price-amount"),
    CategoryConfig("Megabright", "Proyectores LED", "https://www.megabright.cl/categoria-producto/proyectores/", ".product", ".woocommerce-Price-amount"),
    CategoryConfig("Megabright", "Paneles LED", "https://www.megabright.cl/categoria-producto/panel-led/", ".product", ".woocommerce-Price-amount"),
    CategoryConfig("Megabright", "Campanas LED", "https://www.megabright.cl/categoria-producto/campanas-led/", ".product", ".woocommerce-Price-amount"),
    CategoryConfig("TecnoIluminacion", "Inicio / m\u00FAltiples categor\u00EDas", "https://tecnoiluminacion.cl/", ".product-miniature", ".price"),
]
def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

def fetch_html(url: str) -> str:
    logger.info("Solicitando URL: %s", url)
    response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
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

def find_first_text(tag: Tag, selectors: List[str]) -> str:
    for selector in selectors:
        found = tag.select_one(selector)
        if found:
            text = clean_text(found.get_text(" ", strip=True))
            if text:
                return text
    return ""

def find_product_url(tag: Tag, base_url: str) -> str:
    for selector in ["a.woocommerce-LoopProduct-link", "a.product-thumbnail", "a.thumbnail", "a"]:
        found = tag.select_one(selector)
        if found and found.get("href"):
            return urljoin(base_url, found["href"])
    return base_url

def infer_category_from_name(name: str) -> Optional[str]:
    lowered = (name or "").lower()
    rules = {
        "Proyectores LED": ["proyector"],
        "Paneles LED": ["panel"],
        "Campanas LED": ["campana", "high bay", "ufo"],
        "Tubos LED": ["tubo t8", "tubo led", "t8 "],
    }
    for category, keywords in rules.items():
        if any(keyword in lowered for keyword in keywords):
            return category
    return None
def parse_products(html: str, config: CategoryConfig) -> List[ProductPrice]:
    soup = BeautifulSoup(html, "lxml")
    products = soup.select(config.product_selector)
    if not products:
        raise ValueError(f"No se encontraron productos con selector '{config.product_selector}' en {config.url}")
    scraped_at = datetime.now(timezone.utc).isoformat()
    results = []
    for product in products:
        if not isinstance(product, Tag):
            continue
        name = find_first_text(product, ["h2", "h3", ".woocommerce-loop-product__title", ".product-title", ".product-name", ".h3", "a"])
        price_el = product.select_one(config.price_selector)
        price_raw = clean_text(price_el.get_text(" ", strip=True)) if price_el else ""
        price_clp = extract_price_clp(price_raw)
        url = find_product_url(product, config.url)
        category = config.category
        if config.competitor == "TecnoIluminacion":
            inferred = infer_category_from_name(name)
            if inferred is None:
                continue
            category = inferred
        results.append(ProductPrice(
            competitor=config.competitor, category=category,
            name=name or "Producto sin nombre", price_clp=price_clp,
            price_raw=price_raw, url=url, scraped_at=scraped_at,
        ))
    return results

def scrape_all() -> Dict[str, List[ProductPrice]]:
    grouped = {}
    for config in CATEGORIES:
        key = f"{config.competitor}::{config.category}"
        try:
            html = fetch_html(config.url)
            products = parse_products(html, config)
            grouped[key] = products
            logger.info("Resultado %s - %s: %s productos", config.competitor, config.category, len(products))
        except Exception as exc:
            logger.exception("Error scraping %s | %s | %s", config.competitor, config.category, exc)
            grouped[key] = []
    return grouped
def build_json_payload(grouped: Dict[str, List[ProductPrice]]) -> dict:
    generated_at = datetime.now(timezone.utc).isoformat()
    competitors_summary = {}
    errors = []
    for key, products in grouped.items():
        if not products:
            competitor, category = key.split("::", 1)
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
        "## Rango de precios por categor\u00EDa\n",
        "| Categor\u00EDa | Competidor | M\u00EDnimo | M\u00E1ximo | Productos |",
        "|---|---|---:|---:|---:|",
    ]
    for category in ordered_categories:
        for competitor in all_competitors:
            items = competitors_data.get(competitor, {}).get(category, [])
            prices = [i["price_clp"] for i in items if i.get("price_clp")]
            min_p = format_clp(min(prices)) if prices else "N/D"
            max_p = format_clp(max(prices)) if prices else "N/D"
            lines.append(f"| {category} | {competitor} | {min_p} | {max_p} | {len(items)} |")
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
