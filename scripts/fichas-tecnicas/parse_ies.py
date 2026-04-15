#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_ies.py - Parser de archivos .IES (IESNA:LM-63-2002) a JSON
Pipeline de Fichas Tecnicas BESTLED - eLIGHTS.cl
"""

import re
import json
import math
import sys
import os
from datetime import date

def parse_ies_file(filepath):
    """
    Lee un archivo .IES y extrae todos los datos fotometricos y de cabecera.
    Retorna un diccionario con los datos crudos del IES.
    """
    with open(filepath, 'r', encoding='latin-1', errors='replace') as f:
        raw = f.read()

    lines = [l.rstrip() for l in raw.splitlines()]
    
    data = {
        'header': {},
        'photometric': {},
        'candela': {}
    }
    
    # --- Parsear header IESNA ---
    header_map = {
        'TEST': 'test',
        'TESTLAB': 'laboratorio',
        'ISSUEDATE': 'fecha_ensayo',
        'MANUFAC': 'fabricante',
        'LUMCAT': 'lumcat',
        'LUMINAIRE': 'luminaire',
        'LAMPCAT': 'lampcat',
        'LAMP': 'lamp',
        'BALLAST': 'ballast',
        'BALLASTCAT': 'ballastcat',
        'MAINTCAT': 'maintcat',
        'OTHER': 'other',
        'MORE': 'more',
    }
    
    for line in lines:
        m = re.match(r'^\[(\w+)\]\s*(.*)', line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if key in header_map:
                data['header'][header_map[key]] = val
    
    # --- Extraer datos del campo MORE (voltaje, corriente, FP) ---
    more = data['header'].get('more', '')
    
    # Voltaje
    vm = re.search(r'Voltaje medido:\s*([\d.]+)V', more)
    data['header']['voltaje_v'] = float(vm.group(1)) if vm else None
    
    # Corriente
    am = re.search(r'Corriente:\s*([\d.]+)A', more)
    data['header']['corriente_a'] = float(am.group(1)) if am else None
    
    # Factor de potencia
    fpm = re.search(r'FP:\s*([\d.]+)', more)
    data['header']['factor_potencia'] = float(fpm.group(1)) if fpm else None
    
    # --- Encontrar linea TILT ---
    tilt_idx = None
    for i, line in enumerate(lines):
        if line.strip().startswith('TILT='):
            tilt_idx = i
            break
    
    if tilt_idx is None:
        raise ValueError(f"No se encontro TILT en el archivo {filepath}")
    
    # La linea de parametros fotometricos viene despues de TILT
    phot_idx = tilt_idx + 1
    phot_tokens = []
    idx = phot_idx
    while len(phot_tokens) < 13 and idx < len(lines):
        phot_tokens.extend(lines[idx].split())
        idx += 1
    
    if len(phot_tokens) < 13:
        raise ValueError(f"Linea de parametros fotometricos incompleta en {filepath}")
    
    # IESNA LM-63 photometric line format:
    # num_lamps  lumens_lamp  cd_multiplier  num_vert  num_horiz
    # photometric_type  units_type  width  length  height
    # ballast_factor  future_use  input_watts
    n_lamps    = int(phot_tokens[0])
    lumens_lamp = float(phot_tokens[1])
    cd_mult    = float(phot_tokens[2])
    n_vert     = int(phot_tokens[3])
    n_horiz    = int(phot_tokens[4])
    phot_type  = int(phot_tokens[5])
    units_type = int(phot_tokens[6])
    width      = float(phot_tokens[7])
    length     = float(phot_tokens[8])
    height     = float(phot_tokens[9])
    ballast_f  = float(phot_tokens[10])
    # phot_tokens[11] = future_use
    input_watts = float(phot_tokens[12])
    
    data['photometric'] = {
        'n_lamps': n_lamps,
        'lumens_per_lamp': lumens_lamp,
        'cd_multiplier': cd_mult,
        'n_vert_angles': n_vert,
        'n_horiz_angles': n_horiz,
        'photometric_type': phot_type,
        'units_type': units_type,
        'width_m': width,
        'length_m': length,
        'height_m': height,
        'ballast_factor': ballast_f,
        'input_watts': input_watts,
    }
    
    # --- Leer angulos y valores de candela ---
    # Acumular todos los tokens de datos despues de la linea de parametros
    all_data_tokens = []
    for line in lines[phot_idx:]:
        all_data_tokens.extend(line.split())
    
    # Avanzar mas alla de los 13 tokens de parametros
    consumed = len(' '.join(phot_tokens[:13]).split())
    # Re-hacer: leer tokens numericos en orden
    numeric_tokens = []
    start = phot_idx
    # Saltar los tokens de la linea de parametros
    param_count = 0
    for line in lines[phot_idx:]:
        toks = line.split()
        if param_count < 13:
            remaining = 13 - param_count
            if len(toks) <= remaining:
                param_count += len(toks)
                continue
            else:
                # parte de esta linea son parametros, parte son datos
                numeric_tokens.extend(toks[remaining:])
                param_count = 13
        else:
            numeric_tokens.extend(toks)
    
    ptr = 0
    # Angulos verticales
    v_angles = [float(numeric_tokens[ptr + i]) for i in range(n_vert)]
    ptr += n_vert
    # Angulos horizontales
    h_angles = [float(numeric_tokens[ptr + i]) for i in range(n_horiz)]
    ptr += n_horiz
    # Valores de candela: n_horiz sets de n_vert valores
    candela_table = {}
    for hi, ha in enumerate(h_angles):
        row = [float(numeric_tokens[ptr + i]) for i in range(n_vert)]
        candela_table[ha] = row
        ptr += n_vert
    
    data['candela'] = {
        'v_angles': v_angles,
        'h_angles': h_angles,
        'table': candela_table,
        'cd_multiplier': cd_mult,
    }
    
    return data


def calculate_photometrics(raw):
    """
    Calcula metricas fotometricas derivadas desde los datos crudos del IES.
    """
    phot = raw['photometric']
    cand = raw['candela']
    
    lumens_total = phot['n_lamps'] * phot['lumens_per_lamp']
    input_watts  = phot['input_watts']
    
    # Eficacia
    eficacia = round(lumens_total / input_watts, 1) if input_watts > 0 else 0.0
    
    # Candela maxima (con multiplicador aplicado)
    max_cd = 0.0
    for ha, row in cand['table'].items():
        for cd in row:
            val = cd * cand['cd_multiplier']
            if val > max_cd:
                max_cd = val
    max_cd = round(max_cd, 0)
    
    # Angulo de haz al 50% (half-peak) en plano 0deg
    half_peak = max_cd * 0.5
    v_angles = cand['v_angles']
    row_0 = [cd * cand['cd_multiplier'] for cd in cand['table'].get(0, cand['table'][list(cand['table'].keys())[0]])]
    
    beam_angle = 0.0
    for i in range(len(v_angles) - 1):
        if row_0[i] >= half_peak and row_0[i+1] < half_peak:
            # Interpolacion lineal
            frac = (row_0[i] - half_peak) / (row_0[i] - row_0[i+1])
            beam_angle = v_angles[i] + frac * (v_angles[i+1] - v_angles[i])
            break
    beam_angle_total = round(beam_angle * 2, 1)
    
    # Flujo descendente (downward flux %) - angulos 0 a 90
    # Integracion numerica simple (metodo del punto medio en angulos verticales)
    total_flux_down = 0.0
    total_flux_all  = 0.0
    
    h_angles = cand['h_angles']
    
    # Para calcular el flujo necesitamos integrar sobre la esfera
    # Usamos la formula: Phi = sum over h,v of: I(h,v) * sin(v) * delta_v * delta_h
    for hi, ha in enumerate(h_angles):
        row = [cd * cand['cd_multiplier'] for cd in cand['table'][ha]]
        for vi, va in enumerate(v_angles):
            if vi == 0:
                delta_v = (v_angles[1] - v_angles[0]) / 2
            elif vi == len(v_angles) - 1:
                delta_v = (v_angles[-1] - v_angles[-2]) / 2
            else:
                delta_v = (v_angles[vi+1] - v_angles[vi-1]) / 2
            
            if hi == 0:
                delta_h = (h_angles[1] - h_angles[0]) / 2 if len(h_angles) > 1 else 360
            elif hi == len(h_angles) - 1:
                delta_h = (h_angles[-1] - h_angles[-2]) / 2
            else:
                delta_h = (h_angles[hi+1] - h_angles[hi-1]) / 2
            
            va_rad = math.radians(va)
            dv_rad = math.radians(delta_v)
            dh_rad = math.radians(delta_h)
            
            flux_element = row[vi] * math.sin(va_rad) * dv_rad * dh_rad
            total_flux_all += flux_element
            if va <= 90:
                total_flux_down += flux_element
    
    if total_flux_all > 0:
        flujo_descendente_pct = round(100 * total_flux_down / total_flux_all, 2)
    else:
        flujo_descendente_pct = 99.0
    
    # Clasificacion IES (Type I Short para street lights tipicos)
    clasificacion_ies = "Type I / Short / Cutoff"
    
    return {
        'lumens_total': lumens_total,
        'eficacia_lm_w': eficacia,
        'intensidad_max_cd': int(max_cd),
        'angulo_haz_50_deg': beam_angle_total,
        'flujo_descendente_pct': flujo_descendente_pct,
        'clasificacion_ies': clasificacion_ies,
    }


def build_product_json(ies_filepath, base_data_path, today=None):
    """
    Parsea un archivo .IES y lo combina con datos base para generar JSON de producto.
    """
    if today is None:
        today = date.today().isoformat()
    
    # Cargar datos base
    with open(base_data_path, 'r', encoding='utf-8') as f:
        base = json.load(f)
    
    common = base['bestled_common']
    
    # Determinar modelo desde nombre del archivo
    fname = os.path.basename(ies_filepath)
    m = re.search(r'bestled(\d+)', fname, re.IGNORECASE)
    if not m:
        raise ValueError(f"No se puede determinar potencia desde: {fname}")
    model_w = m.group(1)
    
    if model_w not in base['bestled_by_model']:
        raise ValueError(f"Modelo {model_w}W no encontrado en datos base")
    
    model_data = base['bestled_by_model'][model_w]
    quality_score = model_data.get('quality_score', 'B')
    
    # Parsear IES
    raw = parse_ies_file(ies_filepath)
    calc = calculate_photometrics(raw)
    
    phot = raw['photometric']
    hdr  = raw['header']
    
    # Datos del laboratorio
    lab  = hdr.get('laboratorio', 'VOLNIC - Laboratorio de Fotometria')
    lab_short = 'VOLNIC'
    if 'VOLNIC' in lab:
        lab_short = 'VOLNIC'
    
    fecha_str = hdr.get('fecha_ensayo', '')
    
    # Equipo de medicion
    other = hdr.get('other', '')
    equipo_m = re.search(r'Equipo:\s*([\w\-]+)', other)
    equipo   = equipo_m.group(1) if equipo_m else 'GON-2000'
    
    temp_m = re.search(r'Temperatura:\s*(\d+)', other)
    temp   = int(temp_m.group(1)) if temp_m else 25
    
    hum_m = re.search(r'Humedad:\s*(\d+)', other)
    hum   = int(hum_m.group(1)) if hum_m else 68
    
    # SKU base y variantes CCT
    sku_base = model_data['sku_base']
    cct_opts = common['cct_opciones']
    cct_codes = {'2200-2700K': 'C', '4000K': 'N', '5000K': 'F'}
    cct_descs = {'2200-2700K': 'Luz c\u00e1lida', '4000K': 'Luz neutra', '5000K': 'Luz fr\u00eda'}
    variantes = [
        {
            'sku': sku_base + cct_codes.get(c, ''),
            'cct': c,
            'descripcion': cct_descs.get(c, '')
        }
        for c in cct_opts
    ]
    
    potencia_nominal = int(round(phot['input_watts'] / 10) * 10)
    
    product = {
        'sku_base': sku_base,
        'modelo': f"BESTLED {model_w}W",
        'marca': common['marca'],
        'categoria': common['categoria'],
        'familia_plantilla': common['familia_plantilla'],
        
        'specs': {
            'potencia_nominal_w': potencia_nominal,
            'potencia_medida_w': phot['input_watts'],
            'flujo_luminoso_lm': int(calc['lumens_total']),
            'eficacia_lm_w': calc['eficacia_lm_w'],
            'cct_opciones': cct_opts,
            'cri': common['cri'],
            'tipo_led': common['tipo_led'],
            'voltaje_entrada': common['voltaje_entrada'],
            'amperaje_a': hdr.get('corriente_a'),
            'factor_potencia': hdr.get('factor_potencia'),
            'ip': common['ip'],
            'ik': common['ik'],
            'material': common['material'],
            'color_cuerpo': common['color_cuerpo'],
            'dimensiones_mm': model_data['dimensiones_mm'],
            'peso_kg': model_data['peso_kg'],
            'diametro_anclaje_mm': model_data['diametro_anclaje_mm'],
            'montaje': common['montaje'],
            'altura_montaje': common['altura_montaje'],
            'vida_util_h': common['vida_util_h'],
            'clasificacion_ies': calc['clasificacion_ies'],
            'angulo_haz_50_deg': calc['angulo_haz_50_deg'],
            'flujo_descendente_pct': calc['flujo_descendente_pct'],
            'intensidad_max_cd': calc['intensidad_max_cd'],
        },
        
        'variantes_cct': variantes,
        
        'driver': {
            'marca': common['driver_marca'],
            'dimming': common['driver_dimming'],
            'compartimiento': common['driver_compartimiento'],
        },
        
        'certificaciones': {
            'certificacion': common['certificacion'],
            'garantia_anos': common['garantia_anos'],
            'temp_operacion': common['temp_operacion'],
        },
        
        'packaging': {
            'cantidad_por_caja': model_data['packaging_cantidad'],
            'dimensiones_caja_mm': model_data['packaging_dimensiones_mm'],
            'peso_caja_kg': model_data['packaging_peso_kg'],
        },
        
        'fotometria': {
            'laboratorio': lab_short,
            'equipo': equipo,
            'fecha_ensayo': fecha_str,
            'archivo_ies': fname,
            'temperatura_ensayo_c': temp,
            'humedad_ensayo_pct': hum,
        },
        
        'metadata': {
            'version_ficha': 1,
            'fecha_generacion': today,
            'quality_score': quality_score,
            'estado_editorial': 'READY' if quality_score == 'A' else 'BORRADOR',
            'fuente_datos': 'IES VOLNIC + datos base eLIGHTS',
            'clasificacion_datos': 'FC',
            'nota_calidad': model_data.get('nota', ''),
        }
    }
    
    return product


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Parsea archivo .IES a JSON de producto')
    parser.add_argument('ies_file', help='Ruta al archivo .IES')
    parser.add_argument('--base-data', default='scripts/fichas-tecnicas/bestled_base_data.json',
                        help='Ruta al archivo de datos base JSON')
    parser.add_argument('--output', '-o', help='Archivo JSON de salida (default: stdout)')
    args = parser.parse_args()
    
    result = build_product_json(args.ies_file, args.base_data)
    
    output_json = json.dumps(result, ensure_ascii=False, indent=2)
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output_json)
        print(f"Generado: {args.output}")
    else:
        print(output_json)
