#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_all.py - Orquestador del pipeline de fichas tecnicas BESTLED
Uso: python3 scripts/fichas-tecnicas/generate_all.py [--model 60]
eLIGHTS.cl
"""
import os, sys, json, argparse, glob
from datetime import date

BASE_DIR   = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IES_DIR    = os.path.join(BASE_DIR, 'docs', 'fotometrias', 'bestled')
JSON_DIR   = os.path.join(BASE_DIR, 'docs', 'fichas-tecnicas', 'json')
PDF_DIR    = os.path.join(BASE_DIR, 'docs', 'fichas-tecnicas', 'pdf')
BASE_DATA  = os.path.join(BASE_DIR, 'scripts', 'fichas-tecnicas', 'bestled_base_data.json')
SCRIPTS_DIR = os.path.join(BASE_DIR, 'scripts', 'fichas-tecnicas')

sys.path.insert(0, SCRIPTS_DIR)

def run_pipeline(ies_files):
    from parse_ies    import build_product_json
    from gen_ficha_pdf import generar_ficha_pdf

    os.makedirs(JSON_DIR, exist_ok=True)
    os.makedirs(PDF_DIR,  exist_ok=True)

    today = date.today().isoformat()
    productos = []

    print(f'\n=== Pipeline Fichas Tecnicas BESTLED - eLIGHTS.cl ===')
    print(f'Fecha: {today} | Archivos IES: {len(ies_files)}')
    print('-' * 50)

    for ies_path in sorted(ies_files):
        fname = os.path.basename(ies_path)
        print(f'\n[1/2] Parseando: {fname}')
        try:
            producto = build_product_json(ies_path, BASE_DATA, today=today)
            modelo_w = producto['specs']['potencia_nominal_w']
            json_name = f'bestled_{modelo_w}w.json'
            json_path = os.path.join(JSON_DIR, json_name)
            with open(json_path, 'w', encoding='utf-8') as jf:
                json.dump(producto, jf, ensure_ascii=False, indent=2)
            print(f'     JSON: {json_path}')
            productos.append(producto)
        except Exception as e:
            print(f'     ERROR: {e}')
            import traceback; traceback.print_exc()

    # Guardar familia consolidada
    familia_path = os.path.join(JSON_DIR, 'bestled_familia.json')
    with open(familia_path, 'w', encoding='utf-8') as ff:
        json.dump(sorted(productos, key=lambda x: x['specs']['potencia_nominal_w']), ff, ensure_ascii=False, indent=2)
    print(f'\nFamilia consolidada: {familia_path}')

    # Generar PDFs
    print('\n=== Generando PDFs ===')
    familia_sorted = sorted(productos, key=lambda x: x['specs']['potencia_nominal_w'])

    for producto in familia_sorted:
        modelo = producto.get('modelo', '')
        modelo_w = producto['specs']['potencia_nominal_w']
        json_name = f'bestled_{modelo_w}w.json'
        json_path = os.path.join(JSON_DIR, json_name)
        pdf_name  = f'FT-eLIGHTS-BESTLED-{modelo_w}W.pdf'
        pdf_path  = os.path.join(PDF_DIR, pdf_name)
        print(f'[2/2] Generando PDF: {pdf_name}')
        try:
            generar_ficha_pdf(json_path, pdf_path, familia_path)
        except Exception as e:
            print(f'     ERROR generando PDF: {e}')
            import traceback; traceback.print_exc()

    print(f'\n=== Pipeline completado ===')
    print(f'JSONs: {JSON_DIR}')
    print(f'PDFs:  {PDF_DIR}')
    print(f'Total modelos procesados: {len(productos)}')
    for p in sorted(productos, key=lambda x: x['specs']['potencia_nominal_w']):
        qs = p.get('metadata', {}).get('quality_score', 'B')
        print(f'  {p["modelo"]:20s} {p["specs"]["flujo_luminoso_lm"]:6,} lm  {p["specs"]["eficacia_lm_w"]:5.1f} lm/W  QS:{qs}')

def main():
    parser = argparse.ArgumentParser(
        description='Genera fichas tecnicas PDF para linea BESTLED desde archivos .IES'
    )
    parser.add_argument('--model', '-m', default=None,
                        help='Potencia del modelo a procesar (ej: 60). Sin argumento procesa todos.')
    args = parser.parse_args()

    if args.model:
        pattern = os.path.join(IES_DIR, f'bestled{args.model}.IES')
        ies_files = glob.glob(pattern)
        if not ies_files:
            ies_files = glob.glob(os.path.join(IES_DIR, f'bestled{args.model}.ies'))
        if not ies_files:
            print(f'ERROR: No se encontro bestled{args.model}.IES en {IES_DIR}')
            sys.exit(1)
    else:
        ies_files = glob.glob(os.path.join(IES_DIR, '*.IES'))
        ies_files += glob.glob(os.path.join(IES_DIR, '*.ies'))
        if not ies_files:
            print(f'ERROR: No se encontraron archivos .IES en {IES_DIR}')
            sys.exit(1)

    run_pipeline(ies_files)

if __name__ == '__main__':
    main()