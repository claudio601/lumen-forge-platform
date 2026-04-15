#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_ficha_pdf.py v4 - Blueprint v4 - eLIGHTS.cl
Pipeline: JSON + familia + polar_png -> PDF 3 paginas (2 si no hay polar)
"""

import json, os, sys, argparse
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image as RLImage

# ============================================================
# PALETA CORPORATIVA eLIGHTS (src/index.css)
# ============================================================
C_PRIMARY      = colors.HexColor('#6a19d4')  # brand
C_PRIMARY_DARK = colors.HexColor('#4f12a0')  # brand-dark
C_PRIMARY_LIGHT= colors.HexColor('#9952cc')  # brand-light
C_FOREGROUND   = colors.HexColor('#2d3340')  # foreground
C_MUTED        = colors.HexColor('#6b7180')  # muted
C_BG           = colors.HexColor('#ffffff')  # background
C_SURFACE      = colors.HexColor('#f8f9fa')  # surface
C_SECONDARY    = colors.HexColor('#f2f0f7')  # secondary
C_ACCENT       = colors.HexColor('#ede9f7')  # accent
C_BORDER       = colors.HexColor('#e2e4e9')  # border
C_INFO         = colors.HexColor('#1b85e8')  # info

# Contacto correcto
CONTACT_EMAIL  = 'ventas@elights.cl'
CONTACT_TEL    = '+56 9 9127 3128'
CONTACT_WEB    = 'www.elights.cl'
CONTACT_WEB2   = 'nuevo.elights.cl'

# Medidas A4
PW, PH = A4  # 595.28 x 841.89 pt
MARGIN = 15 * mm
CONTENT_W = PW - 2 * MARGIN
MAX_DESC = 280

# Helpers de dibujo
def rect(c, x, y, w, h, fill_color=None, stroke_color=None, stroke_width=0.5):
    if fill_color:
        c.setFillColor(fill_color)
    if stroke_color:
        c.setStrokeColor(stroke_color)
        c.setLineWidth(stroke_width)
    c.rect(x, y, w, h, fill=1 if fill_color else 0, stroke=1 if stroke_color else 0)

def grad_rect(c, x, y, w, h, col1, col2):
    """Simula gradiente horizontal con rectangulos de ancho 1px"""
    steps = int(w) + 1
    for i in range(steps):
        t = i / max(steps - 1, 1)
        r = col1.red   + t * (col2.red   - col1.red)
        g = col1.green + t * (col2.green - col1.green)
        b_c = col1.blue  + t * (col2.blue  - col1.blue)
        c.setFillColorRGB(r, g, b_c)
        c.rect(x + i, y, 1, h, fill=1, stroke=0)

def text_line(c, x, y, txt, font='Helvetica', size=8, color=None, align='left', max_w=None):
    if color:
        c.setFillColor(color)
    c.setFont(font, size)
    if max_w:
        txt = trunc_text(c, txt, font, size, max_w)
    if align == 'right':
        c.drawRightString(x, y, txt)
    elif align == 'center':
        c.drawCentredString(x, y, txt)
    else:
        c.drawString(x, y, txt)

def trunc_text(c, txt, font, size, max_w):
    c.setFont(font, size)
    while txt and c.stringWidth(txt, font, size) > max_w:
        txt = txt[:-1]
    return txt

def pill_tag(c, x, y, w, h, text, bg=None, fg=None, fontsize=7):
    bg = bg or C_PRIMARY
    fg = fg or C_BG
    c.setFillColor(bg)
    c.roundRect(x, y, w, h, h/2, fill=1, stroke=0)
    c.setFillColor(fg)
    c.setFont('Helvetica-Bold', fontsize)
    c.drawCentredString(x + w/2, y + h/2 - fontsize*0.35, text)

def draw_line(c, x1, y1, x2, y2, color=None, width=0.5):
    if color:
        c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x1, y1, x2, y2)

def draw_dashed_rect(c, x, y, w, h, color=None):
    c.saveState()
    if color:
        c.setStrokeColor(color)
    c.setLineWidth(0.5)
    c.setDash(3, 3)
    c.rect(x, y, w, h, fill=0, stroke=1)
    c.restoreState()


# ============================================================
# HEADER / FOOTER COMPONENTES
# ============================================================

def draw_header_full(c, data):
    """Header completo pagina 1: barra superior + banda con logo."""
    modelo = data.get('modelo', 'BESTLED')
    # Barra superior gradiente 3.5mm
    bar_h = 3.5 * mm
    grad_rect(c, 0, PH - bar_h, PW, bar_h, C_PRIMARY, C_PRIMARY_LIGHT)
    # Header band 18mm
    hdr_h = 18 * mm
    hdr_y = PH - bar_h - hdr_h
    grad_rect(c, 0, hdr_y, PW, hdr_h, C_PRIMARY, C_PRIMARY_LIGHT)
    # Logo eLIGHTS
    c.setFillColor(C_BG)
    c.setFont('Helvetica-Bold', 18)
    c.drawString(MARGIN, hdr_y + 6*mm, 'eLIGHTS')
    # FICHA TECNICA
    c.setFont('Helvetica-Bold', 10)
    c.drawRightString(PW - MARGIN, hdr_y + 10*mm, 'FICHA TÉCNICA')
    c.setFont('Helvetica', 7)
    c.drawRightString(PW - MARGIN, hdr_y + 5*mm, CONTACT_WEB)
    c.drawRightString(PW - MARGIN, hdr_y + 2*mm, 'v4.0')
    return PH - bar_h - hdr_h  # y bottom of header

def draw_header_mini(c, data, page_num):
    """Mini header paginas 2 y 3."""
    modelo = data.get('modelo', 'BESTLED')
    specs  = data.get('specs', {})
    sku    = data.get('sku_base', '')
    hdr_h  = 14 * mm
    hdr_y  = PH - hdr_h
    rect(c, 0, hdr_y, PW, hdr_h, fill_color=C_PRIMARY)
    c.setFillColor(C_BG)
    c.setFont('Helvetica-Bold', 11)
    c.drawString(MARGIN, hdr_y + 7*mm, modelo)
    c.setFont('Helvetica', 7)
    variantes = data.get('variantes_cct', [])
    skus_txt = '  |  '.join(v.get('sku', '') for v in variantes[:3])
    c.drawString(MARGIN, hdr_y + 3.5*mm, skus_txt)
    c.setFont('Helvetica', 8)
    c.drawRightString(PW - MARGIN, hdr_y + 6*mm, f'Página {page_num}')
    return PH - hdr_h

def draw_footer_page(c, page_num, total_pages):
    """Footer ligero (6mm) en todas las paginas."""
    foot_h = 6 * mm
    foot_y = 0
    rect(c, 0, foot_y, PW, foot_h, fill_color=None, stroke_color=C_BORDER, stroke_width=0.3)
    draw_line(c, 0, foot_h, PW, foot_h, C_BORDER, 0.3)
    c.setFillColor(C_MUTED)
    c.setFont('Helvetica', 6)
    c.drawString(MARGIN, 2*mm, f'eLIGHTS.cl — {CONTACT_WEB} — {CONTACT_EMAIL}')
    c.drawRightString(PW - MARGIN, 2*mm, f'Página {page_num} de {total_pages}')

def draw_footer_dark(c, data):
    """Footer oscuro exclusivo de ultima pagina."""
    foot_h = 12 * mm
    foot_y = 0
    rect(c, 0, foot_y, PW, foot_h, fill_color=C_FOREGROUND)
    c.setFillColor(C_PRIMARY_LIGHT)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(MARGIN, foot_h/2 + 1*mm, 'eLIGHTS')
    c.setFillColor(C_BG)
    c.setFont('Helvetica', 7)
    c.drawString(MARGIN + 28*mm, foot_h/2 + 2.5*mm, CONTACT_WEB)
    c.drawString(MARGIN + 28*mm, foot_h/2 - 0.5*mm, CONTACT_WEB2)
    c.setFillColor(C_MUTED)
    c.drawRightString(PW - MARGIN, foot_h/2 + 2.5*mm, CONTACT_EMAIL)
    c.drawRightString(PW - MARGIN, foot_h/2 - 0.5*mm, CONTACT_TEL)

# ============================================================
# TABLAS GENÉRICAS
# ============================================================

def draw_spec_table_2col(c, x, y, rows, col_w_label, col_w_val,
                          row_h=5.5*mm, alt=True):
    """Tabla de 2 columnas: label | value. Filas alternadas."""
    for i, (label, value) in enumerate(rows):
        bg = C_SECONDARY if (alt and i % 2 == 0) else C_BG
        rect(c, x, y - row_h, col_w_label + col_w_val, row_h, fill_color=bg)
        # Borde inferior
        draw_line(c, x, y - row_h, x + col_w_label + col_w_val, y - row_h,
                  C_BORDER, 0.3)
        # Texto label
        c.setFillColor(C_FOREGROUND)
        c.setFont('Helvetica-Bold', 7.5)
        c.drawString(x + 2*mm, y - row_h + 1.5*mm, str(label))
        # Texto value
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 7.5)
        val_str = trunc_text(c, str(value), 'Helvetica', 7.5, col_w_val - 4*mm)
        c.drawString(x + col_w_label + 2*mm, y - row_h + 1.5*mm, val_str)
        y -= row_h
    # Borde exterior
    total_h = row_h * len(rows)
    rect(c, x, y, col_w_label + col_w_val, total_h,
         fill_color=None, stroke_color=C_BORDER, stroke_width=0.3)
    # Divisor columnas
    draw_line(c, x + col_w_label, y, x + col_w_label, y + total_h, C_BORDER, 0.3)
    return y  # y bottom

def draw_section_title(c, x, y, title, underline=True):
    """Titulo de seccion con underline brand."""
    c.setFillColor(C_PRIMARY)
    c.setFont('Helvetica-Bold', 11)
    c.drawString(x, y, title)
    if underline:
        tw = c.stringWidth(title, 'Helvetica-Bold', 11)
        draw_line(c, x, y - 1.5*mm, x + CONTENT_W, y - 1.5*mm, C_PRIMARY, 0.8)
    return y - 3.5*mm  # y after title+line

def draw_badges_row(c, x, y, badges, badge_w=38*mm, badge_h=14*mm, gap=3*mm):
    """4 badges horizontales: [valor, label] x 4"""
    for i, (val, lbl) in enumerate(badges):
        bx = x + i * (badge_w + gap)
        # Fondo badge
        rect(c, bx, y - badge_h, badge_w, badge_h, fill_color=C_PRIMARY)
        # Valor
        c.setFillColor(C_BG)
        c.setFont('Helvetica-Bold', 12)
        c.drawCentredString(bx + badge_w/2, y - badge_h + badge_h*0.45, str(val))
        # Label
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 6.5)
        c.drawCentredString(bx + badge_w/2, y - badge_h + 1.5*mm, str(lbl))
    return y - badge_h


# ============================================================
# PAGINA 1 - Identidad + Especificaciones
# ============================================================

def draw_page1(c, data, total_pages):
    specs  = data.get('specs', {})
    fotom  = data.get('fotometria', {})
    driver = data.get('driver', {})
    certs  = data.get('certificaciones', {})
    modelo = data.get('modelo', 'BESTLED')
    marca  = data.get('marca', 'eLIGHTS')
    sku    = data.get('sku_base', '')
    cat    = data.get('categoria', 'Alumbrado Público / Vial')
    variantes = data.get('variantes_cct', [])

    potencia  = specs.get('potencia_W', 0)
    flujo     = specs.get('flujo_lm', 0)
    eficacia  = specs.get('eficacia_lmW', 0)
    cri       = specs.get('cri', '>=80')
    ip        = specs.get('ip', 'IP66')
    ik        = specs.get('ik', 'IK08')
    fp        = specs.get('factor_potencia', 0)
    voltaje   = specs.get('voltaje_nominal_V', 220)
    garantia  = specs.get('garantia_anos', 5)
    tipo_led  = specs.get('tipo_led', 'Bridgelux')
    material  = specs.get('material', 'N/D')
    montaje   = specs.get('montaje', 'N/D')
    dim       = specs.get('dimensiones_mm', 'N/D')
    peso      = specs.get('peso_kg', 'N/D')
    anclaje   = specs.get('diametro_anclaje_mm', 'N/D')
    clasif    = fotom.get('clasificacion_ies', 'Type I')

    # CCT lista (sin bug de caracteres separados)
    cct_vals = [str(v.get('cct_K', '')) for v in variantes] if variantes else ['N/D']
    cct_str  = ' / '.join(cct_vals)

    # Descripcion (max 280 chars)
    desc_raw = (f'Luminaria LED de alumbrado público y vial de alta eficiencia. '
                f'Homologada SEC para el mercado chileno. '
                f'Datos fotométricos medidos por laboratorio VOLNIC con gonioradómetro GON-2000. '
                f'Chip {tipo_led}, driver Mean Well regulable 0-10V, cuerpo {material}.')
    desc = (desc_raw[:MAX_DESC] + '...') if len(desc_raw) > MAX_DESC else desc_raw

    # ---- HEADER ----
    y = draw_header_full(c, data)
    y -= 4*mm  # aire bajo header

    # ---- CATEGORY TAG ----
    tag_h = 5.5 * mm
    tag_w = c.stringWidth(cat.upper(), 'Helvetica-Bold', 7) + 12*mm
    pill_tag(c, MARGIN, y - tag_h, tag_w, tag_h, cat.upper(), fontsize=7)
    y -= tag_h + 2*mm

    # ---- NOMBRE PRODUCTO ----
    c.setFillColor(C_FOREGROUND)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(MARGIN, y, modelo)
    y -= 8*mm

    # ---- SPECS CLAVE ----
    specs_line = f'{potencia}W  |  {flujo} lm  |  {eficacia} lm/W  |  CRI {cri}  |  {ip}  |  {ik}'
    text_line(c, MARGIN, y, specs_line, 'Helvetica', 10, C_MUTED)
    y -= 5.5*mm

    # ---- SKU LINE ----
    sku_line = f'SKU: {sku}   Marca: {marca}   Garantía: {garantia} años'
    text_line(c, MARGIN, y, sku_line, 'Helvetica', 8, C_MUTED)
    y -= 4.5*mm

    # ---- DIVIDER ----
    draw_line(c, MARGIN, y, MARGIN + CONTENT_W, y, C_PRIMARY, 1.2)
    y -= 3*mm

    # ---- ZONA FOTO + DESC + BADGES ----
    zone_h = 48*mm
    photo_w = CONTENT_W * 0.38
    desc_w  = CONTENT_W * 0.58
    gap     = CONTENT_W * 0.04

    # Foto placeholder
    photo_x = MARGIN
    photo_y = y - zone_h
    rect(c, photo_x, photo_y, photo_w, zone_h, fill_color=C_SURFACE)
    draw_dashed_rect(c, photo_x, photo_y, photo_w, zone_h, C_BORDER)
    c.setFillColor(C_MUTED)
    c.setFont('Helvetica', 7)
    c.drawCentredString(photo_x + photo_w/2, photo_y + zone_h/2, '[Foto no disponible]')

    # Descripcion + Badges
    desc_x = MARGIN + photo_w + gap
    dy = y - 2*mm

    # Descripcion 4 lineas max
    c.setFillColor(C_MUTED)
    c.setFont('Helvetica', 8.5)
    words = desc.split()
    line_buf = ''
    lines_drawn = 0
    for word in words:
        test = (line_buf + ' ' + word).strip()
        if c.stringWidth(test, 'Helvetica', 8.5) > desc_w and line_buf:
            c.drawString(desc_x, dy, line_buf)
            dy -= 4.5*mm
            lines_drawn += 1
            line_buf = word
            if lines_drawn >= 4: break
        else:
            line_buf = test
    if line_buf and lines_drawn < 4:
        c.drawString(desc_x, dy, line_buf)
        dy -= 4.5*mm

    dy -= 2*mm

    # Badges: flujo | eficacia | vida util | garantia
    badge_w = (desc_w - 9*mm) / 4
    badge_h = 13*mm
    badges_data = [
        (f'{flujo:,} lm'.replace(',', '.'), 'Flujo Luminoso'),
        (f'{eficacia} lm/W', 'Eficacia'),
        ('50.000 h', 'Vida Útil L70'),
        (f'{garantia} años', 'Garantía'),
    ]
    for i, (val, lbl) in enumerate(badges_data):
        bx = desc_x + i * (badge_w + 3*mm)
        rect(c, bx, dy - badge_h, badge_w, badge_h, fill_color=C_PRIMARY)
        c.setFillColor(C_BG)
        c.setFont('Helvetica-Bold', 11)
        c.drawCentredString(bx + badge_w/2, dy - badge_h + badge_h*0.45, str(val))
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 6)
        c.drawCentredString(bx + badge_w/2, dy - badge_h + 1.8*mm, str(lbl))

    y -= zone_h + 5*mm

    # ---- TABLA DESEMPENO (6 filas x 2 bloques) ----
    y = draw_section_title(c, MARGIN, y, 'DESEMPEÑO')
    col_lbl = 28*mm
    col_val = 32*mm
    block_w = col_lbl + col_val
    gap_b   = CONTENT_W - 2 * block_w
    if gap_b < 0: gap_b = 5*mm

    rows_left = [
        ('Potencia nominal', f'{potencia} W'),
        ('Flujo luminoso',   f'{flujo} lm'),
        ('Eficacia',         f'{eficacia} lm/W'),
        ('Voltaje entrada',  str(specs.get('voltaje_entrada', 'AC 100-277V'))),
        ('Factor potencia',  str(fp)),
        ('Clasificación IES', str(clasif)),
    ]
    rows_right = [
        ('Temp. color (CCT)', cct_str),
        ('CRI',               str(cri)),
        ('Tipo LED',          str(tipo_led)),
        ('Protección IP',      str(ip)),
        ('Resistencia IK',    str(ik)),
        ('Material cuerpo',   str(material)),
    ]

    y_tbl = y
    draw_spec_table_2col(c, MARGIN, y_tbl, rows_left, col_lbl, col_val)
    draw_spec_table_2col(c, MARGIN + block_w + gap_b, y_tbl, rows_right, col_lbl, col_val)
    y -= 6 * 5.5*mm + 5*mm

    # ---- TABLA CONSTRUCCION (4 filas x 2 bloques) ----
    y = draw_section_title(c, MARGIN, y, 'CONSTRUCCIÓN')
    rows_c_left = [
        ('Dimensiones (mm)', str(dim)),
        ('Peso',             f'{peso} kg'),
        ('Anclaje (mm)',     str(anclaje)),
        ('Montaje',          str(montaje)),
    ]
    rows_c_right = [
        ('Altura montaje',   'N/D'),
        ('Vida útil',         '>50.000 h L70'),
        ('Color cuerpo',     'Gris RAL 7035'),
        ('',                 ''),
    ]
    y_tc = y
    draw_spec_table_2col(c, MARGIN, y_tc, rows_c_left,  col_lbl, col_val)
    draw_spec_table_2col(c, MARGIN + block_w + gap_b, y_tc, rows_c_right, col_lbl, col_val)
    y -= 4 * 5.5*mm + 5*mm

    # ---- DRIVER + CERTIFICACIONES (lado a lado) ----
    drv_w  = CONTENT_W * 0.48
    cert_w = CONTENT_W * 0.48
    drv_x  = MARGIN
    cert_x = MARGIN + drv_w + CONTENT_W * 0.04

    # Driver
    c.setFillColor(C_PRIMARY)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(drv_x, y, 'DRIVER')
    draw_line(c, drv_x, y - 1.5*mm, drv_x + drv_w, y - 1.5*mm, C_PRIMARY, 0.6)
    y_drv = y - 3*mm
    drv_rows = [
        ('Marca',         driver.get('marca', 'Mean Well')),
        ('Tipo',          driver.get('tipo', 'Regulable 0-10V')),
        ('Voltaje',       driver.get('rango_voltaje', 'AC 100-277V')),
        ('PF',            driver.get('factor_potencia', '>0.95')),
        ('Protección',     driver.get('proteccion', 'OCP, OVP, OTP')),
    ]
    for label, value in drv_rows:
        c.setFillColor(C_FOREGROUND)
        c.setFont('Helvetica-Bold', 7)
        c.drawString(drv_x, y_drv, label + ':')
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 7)
        c.drawString(drv_x + 22*mm, y_drv, str(value))
        y_drv -= 4.5*mm

    # Certificaciones
    c.setFillColor(C_PRIMARY)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(cert_x, y, 'CERTIFICACIONES')
    draw_line(c, cert_x, y - 1.5*mm, cert_x + cert_w, y - 1.5*mm, C_PRIMARY, 0.6)
    y_cert = y - 3*mm
    sec_cert = certs.get('sec', 'SEC — PE Nº5/07 y DS1')
    normas   = certs.get('normas', ['IEC 60598-1', 'IEC 60598-2-3', 'IEC 62471'])
    c.setFillColor(C_FOREGROUND)
    c.setFont('Helvetica-Bold', 7)
    c.drawString(cert_x, y_cert, '✓ ' + sec_cert)
    y_cert -= 4.5*mm
    for n in normas[:4]:
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 7)
        c.drawString(cert_x, y_cert, '• ' + n)
        y_cert -= 4*mm

    # ---- FOOTER ----
    draw_footer_page(c, 1, total_pages)


# ============================================================
# PAGINA 2 - Familia + Aplicaciones + Dimensiones
# ============================================================

def draw_family_table(c, x, y, familia, sku_current, compact=False):
    """Tabla familia con modo compacto si no cabe en ancho."""
    row_h = 5.5 * mm
    if compact:
        headers = ['Modelo', 'Potencia', 'Flujo (lm)', 'Eficacia']
        col_ws  = [50*mm, 30*mm, 35*mm, 35*mm]
    else:
        headers = ['Modelo', 'Potencia', 'Flujo (lm)', 'Eficacia', 'FP', 'Anclaje']
        col_ws  = [45*mm, 24*mm, 28*mm, 26*mm, 18*mm, 21*mm]

    total_w = sum(col_ws)
    if total_w > CONTENT_W:
        return draw_family_table(c, x, y, familia, sku_current, compact=True)

    # Header row
    cx = x
    for i, (hdr, cw) in enumerate(zip(headers, col_ws)):
        rect(c, cx, y - row_h, cw, row_h, fill_color=C_PRIMARY)
        c.setFillColor(C_BG)
        c.setFont('Helvetica-Bold', 6.5)
        c.drawCentredString(cx + cw/2, y - row_h + 1.5*mm, hdr)
        cx += cw
    y -= row_h

    # Data rows
    for model in familia:
        m_specs = model.get('specs', {})
        is_cur  = model.get('sku_base', '') == sku_current
        bg = C_ACCENT if is_cur else None
        cx = x

        row_data_full = [
            model.get('modelo', ''),
            f"{m_specs.get('potencia_W', '')} W",
            f"{m_specs.get('flujo_lm', '')} lm",
            f"{m_specs.get('eficacia_lmW', '')} lm/W",
            str(m_specs.get('factor_potencia', '')),
            f"ø{m_specs.get('diametro_anclaje_mm', '')}",
        ]
        if compact:
            row_data = row_data_full[:4]
        else:
            row_data = row_data_full

        for i, (val, cw) in enumerate(zip(row_data, col_ws)):
            if bg:
                rect(c, cx, y - row_h, cw, row_h, fill_color=bg)
            # Borde celda
            draw_line(c, cx, y - row_h, cx + cw, y - row_h, C_BORDER, 0.3)
            draw_line(c, cx, y, cx, y - row_h, C_BORDER, 0.2)
            c.setFillColor(C_PRIMARY_DARK if is_cur else C_MUTED)
            c.setFont('Helvetica-Bold' if is_cur else 'Helvetica', 6.5)
            c.drawString(cx + 1.5*mm, y - row_h + 1.5*mm,
                         trunc_text(c, str(val), 'Helvetica-Bold' if is_cur else 'Helvetica', 6.5, cw - 3*mm))
            cx += cw
        # Linea borde derecho
        draw_line(c, x + total_w, y, x + total_w, y - row_h, C_BORDER, 0.2)
        y -= row_h

    # Borde exterior
    total_rows = len(familia) + 1
    rect(c, x, y, total_w, total_rows * row_h,
         fill_color=None, stroke_color=C_BORDER, stroke_width=0.4)
    return y


def draw_page2(c, data, familia, total_pages, has_polar):
    specs     = data.get('specs', {})
    modelo    = data.get('modelo', 'BESTLED')
    sku_base  = data.get('sku_base', '')
    variantes = data.get('variantes_cct', [])

    # ---- MINI HEADER ----
    y = draw_header_mini(c, data, 2)
    y -= 5*mm

    # ---- VARIANTES CCT ----
    y = draw_section_title(c, MARGIN, y, 'VARIANTES DE TEMPERATURA DE COLOR')
    # Tabla 4 col: SKU | CCT | Descripcion | Flujo
    cct_headers = ['SKU', 'CCT (K)', 'Descripción', 'Flujo (lm)']
    cct_col_ws  = [50*mm, 25*mm, 60*mm, 35*mm]
    row_h       = 5.5 * mm
    cx = MARGIN
    for hdr, cw in zip(cct_headers, cct_col_ws):
        rect(c, cx, y - row_h, cw, row_h, fill_color=C_PRIMARY)
        c.setFillColor(C_BG)
        c.setFont('Helvetica-Bold', 6.5)
        c.drawCentredString(cx + cw/2, y - row_h + 1.5*mm, hdr)
        cx += cw
    y -= row_h

    cct_desc = {'2200-2700K': 'Blanco cálido - Ambientes residenciales', '4000K': 'Blanco neutro - Vial y urbano', '5000K': 'Blanco frío - Industrial'}
    for i, v in enumerate(variantes[:4]):
        is_cur = True  # Resaltar todas (mismo modelo, CCT variante)
        bg = C_SECONDARY if i % 2 == 0 else C_BG
        cx = MARGIN
        row_data = [
            v.get('sku', ''),
            str(v.get('cct_K', '')),
            cct_desc.get(str(v.get('cct_K', '')), v.get('aplicacion', '')),
            f"{v.get('flujo_lm', specs.get('flujo_lm',''))} lm",
        ]
        for val, cw in zip(row_data, cct_col_ws):
            rect(c, cx, y - row_h, cw, row_h, fill_color=bg)
            draw_line(c, cx, y - row_h, cx + cw, y - row_h, C_BORDER, 0.3)
            c.setFillColor(C_MUTED)
            c.setFont('Helvetica', 6.5)
            c.drawString(cx + 1.5*mm, y - row_h + 1.5*mm,
                         trunc_text(c, str(val), 'Helvetica', 6.5, cw - 3*mm))
            cx += cw
        y -= row_h

    total_cct_w = sum(cct_col_ws)
    rect(c, MARGIN, y, total_cct_w, (len(variantes[:4])+1)*row_h,
         fill_color=None, stroke_color=C_BORDER, stroke_width=0.3)

    # Footnote VOLNIC
    y -= 1.5*mm
    fotom = data.get('fotometria', {})
    c.setFillColor(C_MUTED)
    c.setFont('Helvetica-Oblique', 6)
    c.drawString(MARGIN, y, f'Datos medidos por laboratorio {fotom.get("laboratorio","VOLNIC")} — Equipo {fotom.get("equipo","GON-2000")} — {fotom.get("fecha_ensayo","2024-03-08")}')
    y -= 6*mm

    # ---- TABLA FAMILIA COMPLETA ----
    y = draw_section_title(c, MARGIN, y, 'LÍNEA COMPLETA BESTLED')
    if familia:
        y = draw_family_table(c, MARGIN, y, familia, sku_base)
        y -= 2*mm
        # Nota si hay quality_score B
        has_b = any(m.get('metadata', {}).get('quality_score', 'B') == 'B' for m in familia)
        if has_b:
            c.setFillColor(C_MUTED)
            c.setFont('Helvetica-Oblique', 6)
            c.drawString(MARGIN, y, 'Nota: datos marcados • son estimaciones pendientes de validación con proveedor.')
            y -= 4*mm
    else:
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 8)
        c.drawString(MARGIN, y, 'Línea BESTLED: 40W a 250W. Consultar disponibilidad.')
        y -= 8*mm
    y -= 4*mm

    # ---- APLICACIONES ----
    y = draw_section_title(c, MARGIN, y, 'APLICACIONES RECOMENDADAS')
    apps = [
        'Alumbrado público vial (vías urbanas y avenidas principales)',
        'Parques, plazas y espacios públicos',
        'Estacionamientos y pérgolas',
        'Perimetrales industriales y comerciales',
        'Zonas residenciales y condominios',
    ]
    for app in apps:
        # Circulo bullet brand
        c.setFillColor(C_PRIMARY)
        c.circle(MARGIN + 2*mm, y + 1.5*mm, 1.2*mm, fill=1, stroke=0)
        c.setFillColor(C_FOREGROUND)
        c.setFont('Helvetica', 7.5)
        c.drawString(MARGIN + 5*mm, y, app)
        y -= 5*mm
    y -= 4*mm

    # ---- DIMENSIONES Y PACKAGING ----
    y = draw_section_title(c, MARGIN, y, 'DIMENSIONES Y PACKAGING')
    pkg = data.get('packaging', {})
    dim = specs.get('dimensiones_mm', 'N/D')
    peso = specs.get('peso_kg', 'N/D')
    anclaje = specs.get('diametro_anclaje_mm', 'N/D')

    # Layout: izquierda 50% diagrama dimensional, derecha 50% datos
    half_w = CONTENT_W / 2 - 3*mm
    left_x  = MARGIN
    right_x = MARGIN + half_w + 6*mm
    zone_top = y

    # Diagrama dimensional (placeholder esquematico)
    diag_h = 40*mm
    rect(c, left_x, y - diag_h, half_w, diag_h, fill_color=C_SURFACE)
    draw_dashed_rect(c, left_x, y - diag_h, half_w, diag_h, C_BORDER)
    c.setFillColor(C_MUTED)
    c.setFont('Helvetica', 7)
    c.drawCentredString(left_x + half_w/2, y - diag_h/2 + 5*mm, '[Diagrama dimensional]')
    c.setFont('Helvetica', 6)
    c.drawCentredString(left_x + half_w/2, y - diag_h/2, str(dim))
    c.drawCentredString(left_x + half_w/2, y - diag_h/2 - 4*mm, f'Peso: {peso} kg')

    # Datos derecha
    yr = y
    pkg_data = []
    if pkg:
        pkg_data = [
            ('Unidades/caja',  str(pkg.get('unidades_caja', 1))),
            ('Peso con caja',  f"{pkg.get('peso_caja_kg', 'N/D')} kg"),
            ('Caja (mm)',      str(pkg.get('caja_mm', 'N/D'))),
        ]
    prod_data = [
        ('Dimensiones (mm)', str(dim)),
        ('Peso luminaria',   f'{peso} kg'),
        ('Anclaje',          f'ø{anclaje} mm'),
        ('Montaje',          str(specs.get('montaje', 'N/D'))),
    ] + pkg_data

    col_lbl_r = 32*mm
    col_val_r = half_w - col_lbl_r
    draw_spec_table_2col(c, right_x, yr, prod_data, col_lbl_r, col_val_r, row_h=5.5*mm)
    y -= max(diag_h, len(prod_data) * 5.5*mm) + 5*mm

    # ---- NOTA si no hay polar ----
    if not has_polar:
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica-Oblique', 7)
        c.drawString(MARGIN, y, 'Fotometría disponible bajo solicitud: ventas@elights.cl')
        y -= 5*mm

    # ---- FOOTER ----
    draw_footer_page(c, 2, total_pages)


# ============================================================
# PAGINA 3 - Fotometria + Detalle Constructivo
# ============================================================

def draw_page3(c, data, polar_png_path, total_pages):
    """Pagina 3 solo si hay diagrama polar PNG."""
    specs  = data.get('specs', {})
    fotom  = data.get('fotometria', {})
    modelo = data.get('modelo', 'BESTLED')

    # ---- MINI HEADER ----
    y = draw_header_mini(c, data, 3)
    y -= 5*mm

    # ---- DIAGRAMA POLAR ----
    y = draw_section_title(c, MARGIN, y, 'DISTRIBUCIÓN LUMINOSA — DIAGRAMA POLAR')
    polar_zone_h = PH * 0.42  # ~42% de la pagina
    polar_w = CONTENT_W * 0.60

    if polar_png_path and os.path.exists(polar_png_path):
        # Subtitulo
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 7)
        c.drawString(MARGIN, y, 'Distribución de intensidad luminosa (cd) — Planos C0/C180 y C90/C270')
        y -= 4*mm

        # Imagen PNG del diagrama
        img_w = polar_w
        img_h = img_w * (400/380)
        if img_h > polar_zone_h: img_h = polar_zone_h; img_w = img_h * (380/400)
        try:
            c.drawImage(polar_png_path, MARGIN, y - img_h, width=img_w, height=img_h,
                        preserveAspectRatio=True)
        except Exception as e:
            rect(c, MARGIN, y - img_h, img_w, img_h, fill_color=C_SURFACE)
            c.setFillColor(C_MUTED)
            c.setFont('Helvetica', 7)
            c.drawCentredString(MARGIN + img_w/2, y - img_h/2, f'[Polar: {e}]')

        # Leyenda
        leg_y = y - img_h - 3*mm
        c.setFillColor(C_PRIMARY)
        c.setLineWidth(1.5)
        c.setStrokeColor(C_PRIMARY)
        c.line(MARGIN, leg_y, MARGIN + 15*mm, leg_y)
        c.setFillColor(C_FOREGROUND)
        c.setFont('Helvetica', 7)
        c.drawString(MARGIN + 17*mm, leg_y - 1.5*mm, 'C0-C180 (Longitudinal)')
        c.setStrokeColor(C_INFO)
        c.setDash(4, 2)
        c.line(MARGIN + 75*mm, leg_y, MARGIN + 90*mm, leg_y)
        c.setDash()
        c.drawString(MARGIN + 92*mm, leg_y - 1.5*mm, 'C90-C270 (Transversal)')

        int_max = fotom.get('intensidad_max_cd', 'N/D')
        lab     = fotom.get('laboratorio', 'VOLNIC')
        fecha_e = fotom.get('fecha_ensayo', '2024-03-08')
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 6)
        c.drawString(MARGIN, leg_y - 5*mm, f'Intensidad máx: {int_max} cd  |  Laboratorio {lab}  |  {fecha_e}')
        y = leg_y - 8*mm
    else:
        rect(c, MARGIN, y - polar_zone_h, polar_w, polar_zone_h, fill_color=C_SURFACE)
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 7)
        c.drawCentredString(MARGIN + polar_w/2, y - polar_zone_h/2, '[Diagrama polar no disponible]')
        y -= polar_zone_h + 4*mm

    y -= 4*mm

    # ---- DOS BLOQUES LADO A LADO: Fotometria + Componentes ----
    half_w  = CONTENT_W / 2 - 3*mm
    left_x  = MARGIN
    right_x = MARGIN + half_w + 6*mm

    # Bloque izquierdo: Datos fotometricos
    c.setFillColor(C_PRIMARY)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(left_x, y, 'DATOS FOTOMÉTRICOS (VOLNIC)')
    draw_line(c, left_x, y - 1.5*mm, left_x + half_w, y - 1.5*mm, C_PRIMARY, 0.6)
    y_fot = y - 3*mm
    fot_rows = [
        ('Laboratorio',    fotom.get('laboratorio', 'VOLNIC')),
        ('Equipo',         fotom.get('equipo', 'GON-2000')),
        ('Fecha ensayo',   fotom.get('fecha_ensayo', '2024-03-08')),
        ('Ángulo haz 50%', f"{fotom.get('angulo_haz_50_deg', 'N/D')}°"),
        ('Clasif. IES',    fotom.get('clasificacion_ies', 'Type I / Short')),
        ('Intensidad máx', f"{fotom.get('intensidad_max_cd', 'N/D')} cd"),
        ('Flujo desc.',    f"{fotom.get('flujo_descendente_pct', 'N/D')}%"),
    ]
    col_lbl_f = 28*mm
    col_val_f = half_w - col_lbl_f
    draw_spec_table_2col(c, left_x, y_fot, fot_rows, col_lbl_f, col_val_f, row_h=5.5*mm)

    # Bloque derecho: Componentes
    c.setFillColor(C_PRIMARY)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(right_x, y, 'COMPONENTES PRINCIPALES')
    draw_line(c, right_x, y - 1.5*mm, right_x + half_w, y - 1.5*mm, C_PRIMARY, 0.6)
    y_comp = y - 5*mm
    componentes = [
        ('1', 'Carcasa / Disipador', 'Aluminio fundido A380, antioxidante'),
        ('2', 'LED',                  'Bridgelux BXEM, >50.000h L70'),
        ('3', 'Driver',               'Mean Well, regulable 0-10V, PF>0.95'),
        ('4', 'Óptica',               'PC premium, transmitancia >92%'),
        ('5', 'Junta',                'Silicona doble sello, IP66'),
        ('6', 'Conector',             'Glands PG, conector rápido 2P+T'),
    ]
    for num, nombre, desc in componentes:
        # Circulo numerado brand
        c.setFillColor(C_PRIMARY)
        c.circle(right_x + 3*mm, y_comp + 2*mm, 2.5*mm, fill=1, stroke=0)
        c.setFillColor(C_BG)
        c.setFont('Helvetica-Bold', 6)
        c.drawCentredString(right_x + 3*mm, y_comp + 1.2*mm, num)
        c.setFillColor(C_FOREGROUND)
        c.setFont('Helvetica-Bold', 7)
        c.drawString(right_x + 7.5*mm, y_comp + 2.5*mm, nombre + ':')
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 7)
        c.drawString(right_x + 7.5*mm, y_comp - 0.5*mm, desc)
        y_comp -= 8*mm

    y -= max(len(fot_rows) * 5.5*mm, len(componentes) * 8*mm) + 8*mm

    # ---- NOTAS DE INSTALACION ----
    c.setFillColor(C_PRIMARY)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(MARGIN, y, 'NOTAS DE INSTALACIÓN')
    draw_line(c, MARGIN, y - 1.5*mm, MARGIN + CONTENT_W, y - 1.5*mm, C_PRIMARY, 0.6)
    y -= 5*mm
    notas = [
        'Instalar por personal eléctrico calificado con puesta a tierra correcta.',
        'Respetar rango de voltaje de entrada (AC 100-277V). No invertir polaridad.',
        'Sellado IP66 requiere ajuste correcto de junta antes de energizar.',
        'Montaje en poste: usar abrazadera incluida ø26-60mm. Apretar a 8 Nm.',
    ]
    for nota in notas:
        c.setFillColor(C_PRIMARY)
        c.circle(MARGIN + 2*mm, y + 1.5*mm, 1*mm, fill=1, stroke=0)
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica', 7)
        c.drawString(MARGIN + 5*mm, y, nota)
        y -= 5*mm
    y -= 3*mm

    # ---- DISCLAIMERS ----
    draw_line(c, MARGIN, y, MARGIN + CONTENT_W, y, C_BORDER, 0.3)
    y -= 3*mm
    disclaimers = [
        'Los datos fotométricos son resultados de mediciones de laboratorio y pueden variar ±5% en producción serie.',
        'Dimensiones y pesos marcados como estimación deben validarse con proveedor antes de publicar.',
        'Certificación SEC vigente. Verificar número de resolución en www.sec.cl.',
    ]
    for d in disclaimers:
        c.setFillColor(C_MUTED)
        c.setFont('Helvetica-Oblique', 6)
        c.drawString(MARGIN, y, d)
        y -= 4*mm

    # ---- FOOTER OSCURO (exclusivo ultima pagina) ----
    draw_footer_dark(c, data)
    # Footer pagina ligero (numero de pagina)
    # El footer oscuro ya ocupa la parte inferior, no se duplica con draw_footer_page
    c.setFillColor(C_MUTED)
    c.setFont('Helvetica', 6)
    c.drawRightString(PW - MARGIN, 13*mm, f'Página {total_pages} de {total_pages}')


# ============================================================
# FUNCION PRINCIPAL
# ============================================================

def generar_ficha_pdf(json_path, output_pdf, familia_json_path=None, polar_png_path=None):
    """
    Genera PDF v4 desde JSON de producto.
    Si hay polar_png_path -> 3 paginas. Si no -> 2 paginas con nota.
    """
    with open(json_path, encoding='utf-8') as f:
        data = json.load(f)

    familia = []
    if familia_json_path and os.path.exists(familia_json_path):
        with open(familia_json_path, encoding='utf-8') as f:
            familia = json.load(f)

    has_polar = bool(polar_png_path and os.path.exists(polar_png_path))
    total_pages = 3 if has_polar else 2

    os.makedirs(os.path.dirname(output_pdf), exist_ok=True)

    c = rl_canvas.Canvas(output_pdf, pagesize=A4)
    c.setTitle(f"Ficha Tecnica {data.get('modelo','BESTLED')} - eLIGHTS.cl")
    c.setAuthor('eLIGHTS.cl')
    c.setSubject('Ficha Tecnica LED - v4')

    # --- PAGINA 1 ---
    draw_page1(c, data, total_pages)
    c.showPage()

    # --- PAGINA 2 ---
    draw_page2(c, data, familia, total_pages, has_polar)

    if has_polar:
        c.showPage()
        # --- PAGINA 3 ---
        draw_page3(c, data, polar_png_path, total_pages)

    c.save()
    print(f'  PDF v4 generado: {output_pdf} ({total_pages} paginas)')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='gen_ficha_pdf.py v4')
    ap.add_argument('json_path',   help='JSON del producto')
    ap.add_argument('output_pdf',  help='Ruta de salida PDF')
    ap.add_argument('--familia',   default=None, help='JSON familia completa')
    ap.add_argument('--polar',     default=None, help='PNG diagrama polar')
    args = ap.parse_args()
    generar_ficha_pdf(args.json_path, args.output_pdf, args.familia, args.polar)
