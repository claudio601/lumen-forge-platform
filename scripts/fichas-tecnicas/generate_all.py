#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_all.py - Orquestador pipeline IES -> JSON -> Polar -> PDF
Uso: python3 scripts/fichas-tecnicas/generate_all.py
"""

import os, sys, json, argparse
import cairosvg

# Asegurar que el directorio raiz del repo esta en el path
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'fichas-tecnicas'))

from parse_ies import parse_ies_file as parse_ies
from gen_ficha_pdf import generar_ficha_pdf
from render_polar import render_polar_from_ies

IES_DIR     = os.path.join(ROOT, 'docs', 'fotometrias', 'bestled')
POLAR_DIR   = os.path.join(ROOT, 'docs', 'fotometrias', 'bestled', 'polar')
JSON_DIR    = os.path.join(ROOT, 'docs', 'fichas-tecnicas', 'json')
PDF_DIR     = os.path.join(ROOT, 'docs', 'fichas-tecnicas', 'pdf')
BASE_DATA_F = os.path.join(ROOT, 'scripts', 'fichas-tecnicas', 'bestled_base_data.json')

# Datos IES conocidos por modelo (de PDFs VOLNIC)
FOTOM_EXTRA = {
    40:  {'clasificacion_ies': 'Semi-Direct',              'angulo_haz_50_deg': 92.4,  'flujo_descendente_pct': 98.90},
    60:  {'clasificacion_ies': 'Type I / Short / Cutoff',  'angulo_haz_50_deg': 119.3, 'flujo_descendente_pct': 99.24},
    90:  {'clasificacion_ies': 'Type I / Short / Cutoff',  'angulo_haz_50_deg': 130.0, 'flujo_descendente_pct': 99.10},
    120: {'clasificacion_ies': 'Type I / Short / Cutoff',  'angulo_haz_50_deg': 135.0, 'flujo_descendente_pct': 99.15},
    150: {'clasificacion_ies': 'Type I / Short / Cutoff',  'angulo_haz_50_deg': 141.0, 'flujo_descendente_pct': 99.17},
    200: {'clasificacion_ies': 'Type I / Short / Cutoff',  'angulo_haz_50_deg': 143.0, 'flujo_descendente_pct': 99.20},
    250: {'clasificacion_ies': 'Type I / Short / Cutoff',  'angulo_haz_50_deg': 145.0, 'flujo_descendente_pct': 99.22},
}


def load_base_data():
    with open(BASE_DATA_F, encoding='utf-8') as f:
        return json.load(f)


def build_product_json(ies_path, base_data, watt):
    ies = parse_ies(ies_path)
    common = base_data.get('bestled_common', {})
    model_key = str(watt)
    by_model = base_data.get('bestled_by_model', {}).get(model_key, {})
    hdr   = ies.get('header', ies)
    phot  = ies.get('photometric', ies)
    cand  = ies.get('candela', {})
    flujo    = phot.get('lumens_per_lamp', hdr.get('flujo_lm', 0))
    potencia = round(phot.get('input_watts', hdr.get('potencia_W', watt)), 1)
    eficacia = round(flujo / potencia, 1) if potencia > 0 else 0
    fp       = hdr.get('factor_potencia', hdr.get('fp', 0.95))
    voltaje  = hdr.get('voltaje_v', hdr.get('voltaje_V', 220))
    corriente= hdr.get('corriente_a', hdr.get('corriente_A', 0))
    # Intensidad maxima desde datos de candela
    max_cd = 0
    table = cand.get('table', {})
    if isinstance(table, dict):
        for row in table.values():
            if isinstance(row, list) and row:
                row_max = max(row)
                if row_max > max_cd: max_cd = row_max
    elif isinstance(table, list):
        for row in table:
            if isinstance(row, list) and row:
                row_max = max(row)
                if row_max > max_cd: max_cd = row_max
    int_max  = round(max_cd, 1)
    extra    = FOTOM_EXTRA.get(watt, {})
    is_60    = (watt == 60)
    sku_base = f'APB{watt}'
    variantes = []
    for cct in common.get('cct_opciones', ['4000K']):
        variantes.append({
            'cct_K':        cct,
            'sku':          f'{sku_base}-{cct.replace("-","_")}',
            'flujo_lm':     flujo,
            'eficacia_lmW': eficacia,
            'aplicacion':   'Urbano/Vial' if '4000' in cct else ('Ambiental' if '2700' in cct or '2200' in cct else 'Industrial'),
        })
    prod = {
        'sku_base':          sku_base,
        'modelo':            f'BESTLED {watt}W',
        'marca':             'eLIGHTS',
        'categoria':         'Alumbrado Público / Vial',
        'familia_plantilla': 'industrial',
        'specs': {
            'potencia_W':        potencia,
            'flujo_lm':          flujo,
            'eficacia_lmW':      eficacia,
            'voltaje_nominal_V': voltaje,
            'corriente_A':       corriente,
            'factor_potencia':   fp,
            'cri':               common.get('cri', '>=80'),
            'ip':                common.get('ip', 'IP66'),
            'ik':                common.get('ik', 'IK08'),
            'tipo_led':          common.get('tipo_led', 'Bridgelux'),
            'material':          common.get('material', 'Aluminio fundido'),
            'voltaje_entrada':   common.get('voltaje_entrada', 'AC 100-277V 50-60Hz'),
            'montaje':           common.get('montaje', 'Poste ø26-60mm'),
            'garantia_anos':     common.get('garantia_anos', 5),
            'dimensiones_mm':    by_model.get('dimensiones_mm', 'N/D'),
            'peso_kg':           by_model.get('peso_kg', 'N/D'),
            'diametro_anclaje_mm': by_model.get('diametro_anclaje_mm', 42),
        },
        'variantes_cct': variantes,
        'driver': {
            'marca':           common.get('driver_marca', 'Mean Well'),
            'tipo':            'Regulable 0-10V',
            'rango_voltaje':   'AC 100-277V 50-60Hz',
            'factor_potencia': '>0.95',
            'proteccion':      'OCP, OVP, OTP, SCP',
        },
        'certificaciones': {
            'sec':    common.get('certificacion', 'SEC — PE Nº5/07 y DS1'),
            'normas': ['IEC 60598-1', 'IEC 60598-2-3', 'IEC 62471', 'IESNA LM-63-2002'],
        },
        'packaging': by_model.get('packaging', {}),
        'fotometria': {
            'laboratorio':           'VOLNIC',
            'equipo':                'GON-2000',
            'fecha_ensayo':          '2024-03-08',
            'archivo_ies':           os.path.basename(ies_path),
            'angulo_haz_50_deg':     extra.get('angulo_haz_50_deg', 'N/D'),
            'clasificacion_ies':     extra.get('clasificacion_ies', 'Type I / Short / Cutoff'),
            'intensidad_max_cd':     int_max,
            'flujo_descendente_pct': extra.get('flujo_descendente_pct', 'N/D'),
            'polar_svg':             f'docs/fotometrias/bestled/polar/polar_bestled{watt}.svg',
            'polar_png':             f'docs/fotometrias/bestled/polar/polar_bestled{watt}.png',
        },
        'metadata': {
            'version_ficha':    2,
            'quality_score':    'A' if is_60 else 'B',
            'estado_editorial': 'READY' if is_60 else 'BORRADOR',
            'nota':             '' if is_60 else 'Dimensiones y peso pendientes de validación con proveedor.',
        },
    }
    return prod


def main():
    ap = argparse.ArgumentParser(description='Pipeline IES -> JSON -> Polar -> PDF')
    ap.add_argument('--model', type=int, default=None, help='Generar solo este wattage (ej: 60)')
    args = ap.parse_args()

    os.makedirs(POLAR_DIR, exist_ok=True)
    os.makedirs(JSON_DIR,  exist_ok=True)
    os.makedirs(PDF_DIR,   exist_ok=True)

    base_data = load_base_data()

    # Encontrar archivos IES
    ies_files = {}
    for fname in sorted(os.listdir(IES_DIR)):
        if not fname.endswith('.IES') and not fname.endswith('.ies'): continue
        for w in [40, 60, 90, 120, 150, 200, 250]:
            if str(w) in fname:
                ies_files[w] = os.path.join(IES_DIR, fname)
                break

    if args.model:
        if args.model not in ies_files:
            print(f'ERROR: No se encontro IES para {args.model}W')
            sys.exit(1)
        ies_files = {args.model: ies_files[args.model]}

    # --- PASO 1: Parsear IES y generar JSONs ---
    print('\n=== PASO 1: Parseando IES y generando JSONs ===')
    products = []
    json_paths = {}
    for watt, ies_path in sorted(ies_files.items()):
        print(f'  Procesando {watt}W: {os.path.basename(ies_path)}')
        prod = build_product_json(ies_path, base_data, watt)
        json_path = os.path.join(JSON_DIR, f'bestled_{watt}w.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(prod, f, ensure_ascii=False, indent=2)
        print(f'    JSON: {json_path}')
        products.append(prod)
        json_paths[watt] = json_path

    # JSON familia consolidado
    familia_path = os.path.join(JSON_DIR, 'bestled_familia.json')
    if not args.model:
        with open(familia_path, 'w', encoding='utf-8') as f:
            json.dump(products, f, ensure_ascii=False, indent=2)
        print(f'  Familia JSON: {familia_path}')
    elif os.path.exists(familia_path):
        with open(familia_path, encoding='utf-8') as f:
            existing = json.load(f)
        # Actualizar el modelo en la familia
        new_fam = [p for p in existing if p.get('specs',{}).get('potencia_W') != args.model]
        new_fam.append(products[0])
        new_fam.sort(key=lambda p: p.get('specs',{}).get('potencia_W', 0))
        with open(familia_path, 'w', encoding='utf-8') as f:
            json.dump(new_fam, f, ensure_ascii=False, indent=2)

    # --- PASO 2: Generar diagramas polares (SVG + PNG) ---
    print('\n=== PASO 2: Generando diagramas polares SVG + PNG ===')
    polar_pngs = {}
    for watt, ies_path in sorted(ies_files.items()):
        svg_path = os.path.join(POLAR_DIR, f'polar_bestled{watt}.svg')
        png_path = os.path.join(POLAR_DIR, f'polar_bestled{watt}.png')
        print(f'  {watt}W: generando polar...')
        render_polar_from_ies(ies_path, f'BESTLED {watt}W', svg_path)
        cairosvg.svg2png(url=svg_path, write_to=png_path, output_width=760)
        print(f'    PNG: {png_path}')
        polar_pngs[watt] = png_path

    # --- PASO 3: Generar PDFs ---
    print('\n=== PASO 3: Generando PDFs ===')
    for watt, json_path in sorted(json_paths.items()):
        pdf_path  = os.path.join(PDF_DIR, f'FT-eLIGHTS-BESTLED-{watt}W.pdf')
        polar_png = polar_pngs.get(watt)
        fam_path  = familia_path if os.path.exists(familia_path) else None
        print(f'  {watt}W: generando PDF...')
        generar_ficha_pdf(json_path, pdf_path, fam_path, polar_png)

    print('\n=== PIPELINE COMPLETO ===')
    print(f'  {len(json_paths)} JSONs en {JSON_DIR}')
    print(f'  {len(polar_pngs)*2} archivos polares en {POLAR_DIR}')
    print(f'  {len(json_paths)} PDFs en {PDF_DIR}')


if __name__ == '__main__':
    main()
