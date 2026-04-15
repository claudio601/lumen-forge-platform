#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
render_polar.py - Renderizador de diagramas polares desde datos IES
Genera SVG con colores corporativos eLIGHTS desde src/index.css
"""

import sys
import os
import math

# ============================================================
# PALETA CORPORATIVA eLIGHTS (desde src/index.css)
# ============================================================
COLOR_PRIMARY    = "#6a19d4"   # primary violeta - curva C0-C180
COLOR_INFO       = "#1b85e8"   # info azul       - curva C90-C270
COLOR_FOREGROUND = "#2d3340"   # texto principal, titulo
COLOR_MUTED_FG   = "#6b7180"   # labels angulos, pie
COLOR_SURFACE    = "#f8f9fa"   # fondo diagrama
COLOR_BORDER     = "#e2e4e9"   # grilla

SVG_W = 380
SVG_H = 400


def parse_ies_for_polar(ies_path):
    """Extrae datos de candela por plano C del .IES"""
    with open(ies_path, encoding="latin-1") as f:
        content = f.read()
    lines_in = [l.strip() for l in content.splitlines()]
    tilt_idx = next(i for i, l in enumerate(lines_in) if l.startswith('TILT='))
    photom_line = lines_in[tilt_idx + 1]
    parts = photom_line.split()
    n_vert  = int(parts[3])
    n_horiz = int(parts[4])
    cd_mult = float(parts[2])
    data_lines = []
    idx = tilt_idx + 2
    while idx < len(lines_in):
        data_lines.extend(lines_in[idx].split())
        idx += 1
    ptr = 0
    vert_angles  = [float(data_lines[ptr + i]) for i in range(n_vert)]
    ptr += n_vert
    horiz_angles = [float(data_lines[ptr + i]) for i in range(n_horiz)]
    ptr += n_horiz
    planes = {}
    for h_angle in horiz_angles:
        cd_vals = [float(data_lines[ptr + i]) * cd_mult for i in range(n_vert)]
        ptr += n_vert
        planes[h_angle] = cd_vals
    return {'vert_angles': vert_angles, 'horiz_angles': horiz_angles, 'planes': planes}


def get_plane_data(planes, target_angle):
    best = min(planes.keys(), key=lambda a: abs(a - target_angle))
    return planes[best]


def polar_to_xy(ang_deg, cd, max_cd, cx, cy, radius, side):
    rad = math.radians(ang_deg)
    r = (cd / max_cd) * radius if max_cd > 0 else 0
    x = cx + r * math.sin(rad) if side == 'right' else cx - r * math.sin(rad)
    y = cy + r * math.cos(rad)
    return x, y


def build_split_curve(cd_right, cd_left, vert_angles, max_cd, cx, cy, radius):
    pts_right, pts_left = [], []
    for i, ang in enumerate(vert_angles):
        if ang < 0 or ang > 90: continue
        pts_right.append(polar_to_xy(ang, cd_right[i], max_cd, cx, cy, radius, 'right'))
        pts_left.append(polar_to_xy(ang, cd_left[i],  max_cd, cx, cy, radius, 'left'))
    return list(reversed(pts_left)) + pts_right


def pts_str(pts):
    return ' '.join(f'{x:.2f},{y:.2f}' for x, y in pts)


def render_polar_svg(ies_data, model_name, output_path):
    """Genera SVG de diagrama polar."""
    vert_angles = ies_data['vert_angles']
    planes      = ies_data['planes']
    cd_c0   = get_plane_data(planes, 0)
    cd_c90  = get_plane_data(planes, 90)
    cd_c180 = get_plane_data(planes, 180)
    cd_c270 = get_plane_data(planes, 270)
    filtered = []
    for i, ang in enumerate(vert_angles):
        if 0 <= ang <= 90:
            filtered += [cd_c0[i], cd_c90[i], cd_c180[i], cd_c270[i]]
    max_cd  = max(filtered) if filtered else 1.0
    margin_top = 50; margin_bottom = 70; margin_sides = 40
    cx      = SVG_W // 2
    radius  = min((SVG_W - 2*margin_sides)//2, SVG_H - margin_top - margin_bottom) - 5
    cy      = margin_top + radius + 5
    curve0  = build_split_curve(cd_c0, cd_c180, vert_angles, max_cd, cx, cy, radius)
    curve90 = build_split_curve(cd_c90, cd_c270, vert_angles, max_cd, cx, cy, radius)
    out = []
    W, H = SVG_W, SVG_H
    out.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">')
    out.append(f'  <rect width="{W}" height="{H}" rx="8" ry="8" fill="{COLOR_SURFACE}"/>')
    out.append(f'  <text x="{W//2}" y="22" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="{COLOR_FOREGROUND}" text-anchor="middle">Diagrama Polar — {model_name}</text>')
    out.append(f'  <text x="{W//2}" y="38" font-family="Arial,sans-serif" font-size="9" fill="{COLOR_MUTED_FG}" text-anchor="middle">Distribución de Intensidad Luminosa (cd)</text>')
    for lvl in range(1, 6):
        r_lvl = radius * lvl / 5
        out.append(f'  <circle cx="{cx}" cy="{cy}" r="{r_lvl:.1f}" fill="none" stroke="{COLOR_BORDER}" stroke-width="0.8" stroke-dasharray="3,3"/>')
        pct = int(100 * lvl / 5)
        out.append(f'  <text x="{cx+3:.1f}" y="{cy - r_lvl - 2:.1f}" font-family="Arial,sans-serif" font-size="7" fill="{COLOR_MUTED_FG}">{pct}%</text>')
    for ang_deg in range(0, 91, 15):
        rad = math.radians(ang_deg)
        x1r = cx + radius * math.sin(rad)
        y1r = cy + radius * math.cos(rad)
        x1l = cx - radius * math.sin(rad)
        out.append(f'  <line x1="{cx}" y1="{cy}" x2="{x1r:.2f}" y2="{y1r:.2f}" stroke="{COLOR_BORDER}" stroke-width="0.8"/>')
        if ang_deg > 0:
            out.append(f'  <line x1="{cx}" y1="{cy}" x2="{x1l:.2f}" y2="{y1r:.2f}" stroke="{COLOR_BORDER}" stroke-width="0.8"/>')
        lr = radius + 14
        lx = cx + lr * math.sin(rad); ly = cy + lr * math.cos(rad)
        out.append(f'  <text x="{lx:.1f}" y="{ly:.1f}" font-family="Arial,sans-serif" font-size="8" fill="{COLOR_MUTED_FG}" text-anchor="middle">{ang_deg}°</text>')
        if ang_deg > 0:
            lxl = cx - lr * math.sin(rad)
            out.append(f'  <text x="{lxl:.1f}" y="{ly:.1f}" font-family="Arial,sans-serif" font-size="8" fill="{COLOR_MUTED_FG}" text-anchor="middle">{ang_deg}°</text>')
    out.append(f'  <line x1="{cx - radius}" y1="{cy}" x2="{cx + radius}" y2="{cy}" stroke="{COLOR_BORDER}" stroke-width="1.0"/>')
    out.append(f'  <line x1="{cx}" y1="{cy}" x2="{cx}" y2="{cy + radius}" stroke="{COLOR_BORDER}" stroke-width="1.0" stroke-dasharray="4,2"/>')
    if len(curve90) > 1:
        out.append(f'  <polyline points="{pts_str(curve90)}" fill="none" stroke="{COLOR_INFO}" stroke-width="1.8" stroke-dasharray="5,3" opacity="0.9"/>')
    if len(curve0) > 1:
        out.append(f'  <polyline points="{pts_str(curve0)}" fill="{COLOR_PRIMARY}" fill-opacity="0.08" stroke="{COLOR_PRIMARY}" stroke-width="2.2"/>')
    out.append(f'  <circle cx="{cx}" cy="{cy}" r="3" fill="{COLOR_FOREGROUND}"/>')
    leg_y = SVG_H - margin_bottom + 12
    out.append(f'  <line x1="30" y1="{leg_y}" x2="50" y2="{leg_y}" stroke="{COLOR_PRIMARY}" stroke-width="2.2"/>')
    out.append(f'  <text x="54" y="{leg_y+4}" font-family="Arial,sans-serif" font-size="9" fill="{COLOR_FOREGROUND}">C0-C180 (Longitudinal)</text>')
    lx2 = W // 2 + 10
    out.append(f'  <line x1="{lx2}" y1="{leg_y}" x2="{lx2+20}" y2="{leg_y}" stroke="{COLOR_INFO}" stroke-width="1.8" stroke-dasharray="5,3"/>')
    out.append(f'  <text x="{lx2+24}" y="{leg_y+4}" font-family="Arial,sans-serif" font-size="9" fill="{COLOR_FOREGROUND}">C90-C270 (Transversal)</text>')
    pie_y = SVG_H - 20
    out.append(f'  <text x="{W//2}" y="{pie_y}" font-family="Arial,sans-serif" font-size="8" fill="{COLOR_MUTED_FG}" text-anchor="middle">Intensidad máx: {max_cd:.0f} cd  |  Laboratorio VOLNIC — GON-2000 — 2024/03/08</text>')
    out.append('</svg>')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    print(f'  SVG generado: {output_path}')


def render_polar_from_ies(ies_path, model_name, output_svg_path):
    """Funcion principal: parsea IES y genera SVG."""
    ies_data = parse_ies_for_polar(ies_path)
    render_polar_svg(ies_data, model_name, output_svg_path)


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print('Uso: python3 render_polar.py <archivo.IES> <nombre_modelo> <salida.svg>')
        sys.exit(1)
    render_polar_from_ies(sys.argv[1], sys.argv[2], sys.argv[3])
