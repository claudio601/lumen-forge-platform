#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_ficha_pdf.py v2 - Pipeline: JSON -> PDF 3 paginas. eLIGHTS.cl
Colores corporativos desde src/index.css. Diagramas polares reales.
"""

import json, os, sys, argparse
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, PageBreak, KeepTogether
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.lib.utils import ImageReader

W, H = A4

# ============================================================
# PALETA CORPORATIVA eLIGHTS (src/index.css)
# ============================================================
PRIMARY      = colors.HexColor('#6a19d4')
PRIMARY_DARK = colors.HexColor('#4f12a0')
PRIMARY_GRAD = colors.HexColor('#9952cc')
FOREGROUND   = colors.HexColor('#2d3340')
MUTED_FG     = colors.HexColor('#6b7180')
BG_WHITE     = colors.HexColor('#ffffff')
SURFACE      = colors.HexColor('#f8f9fa')
SECONDARY    = colors.HexColor('#f2f0f7')
ACCENT       = colors.HexColor('#ede9f7')
BORDER       = colors.HexColor('#e2e4e9')
INFO         = colors.HexColor('#1b85e8')
SUCCESS      = colors.HexColor('#29b35b')
DESTRUCTIVE  = colors.HexColor('#f23c3c')


def estilos():
    ss = getSampleStyleSheet()
    return {
        'titulo':    ParagraphStyle('titulo',    fontSize=20, textColor=FOREGROUND,   fontName='Helvetica-Bold',    spaceAfter=2*mm),
        'subtitulo': ParagraphStyle('subtitulo', fontSize=13, textColor=PRIMARY,      fontName='Helvetica-Bold',    spaceAfter=1*mm),
        'h3':        ParagraphStyle('h3',        fontSize=9,  textColor=FOREGROUND,   fontName='Helvetica-Bold',    spaceAfter=1*mm),
        'body':      ParagraphStyle('body',      fontSize=8,  textColor=FOREGROUND,   fontName='Helvetica',         spaceAfter=1*mm),
        'small':     ParagraphStyle('small',     fontSize=7,  textColor=MUTED_FG,     fontName='Helvetica',         spaceAfter=0.5*mm),
        'badge_val': ParagraphStyle('badge_val', fontSize=15, textColor=BG_WHITE,     fontName='Helvetica-Bold',    alignment=TA_CENTER),
        'badge_lbl': ParagraphStyle('badge_lbl', fontSize=7,  textColor=BG_WHITE,     fontName='Helvetica',         alignment=TA_CENTER),
        'tag':       ParagraphStyle('tag',       fontSize=8,  textColor=BG_WHITE,     fontName='Helvetica-Bold',    alignment=TA_CENTER, backColor=PRIMARY),
        'seccion':   ParagraphStyle('seccion',   fontSize=9,  textColor=PRIMARY,      fontName='Helvetica-Bold',    spaceAfter=1*mm, spaceBefore=2*mm),
        'tabla_hdr': ParagraphStyle('tabla_hdr', fontSize=8,  textColor=BG_WHITE,     fontName='Helvetica-Bold',    alignment=TA_CENTER),
        'tabla_cel': ParagraphStyle('tabla_cel', fontSize=7.5,textColor=FOREGROUND,   fontName='Helvetica'),
        'footer':    ParagraphStyle('footer',    fontSize=6.5,textColor=MUTED_FG,     fontName='Helvetica',         alignment=TA_CENTER),
        'nota':      ParagraphStyle('nota',      fontSize=7,  textColor=MUTED_FG,     fontName='Helvetica-Oblique', spaceAfter=1*mm),
        'desc':      ParagraphStyle('desc',      fontSize=8,  textColor=FOREGROUND,   fontName='Helvetica',         alignment=TA_JUSTIFY, spaceAfter=2*mm),
        'contacto':  ParagraphStyle('contacto',  fontSize=8,  textColor=BG_WHITE,     fontName='Helvetica',         alignment=TA_CENTER),
        'marca_c':   ParagraphStyle('marca_c',   fontSize=10, textColor=PRIMARY,      fontName='Helvetica-Bold',    alignment=TA_CENTER),
    }


def hr(color=BORDER, thickness=0.5):
    return HRFlowable(width='100%', thickness=thickness, color=color, spaceAfter=1*mm, spaceBefore=1*mm)


def hr_primary():
    return HRFlowable(width='100%', thickness=1.5, color=PRIMARY, spaceAfter=2*mm, spaceBefore=0.5*mm)


def tabla_specs(datos, st):
    filas = []
    for i, (k, v) in enumerate(datos):
        bg = SECONDARY if i % 2 == 0 else BG_WHITE
        filas.append([
            Paragraph(k, st['tabla_cel']),
            Paragraph(str(v), st['tabla_cel']),
        ])
    col_w = [70*mm, 80*mm]
    t = Table(filas, colWidths=col_w)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), BG_WHITE),
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [SECONDARY, BG_WHITE]),
        ('GRID', (0,0), (-1,-1), 0.4, BORDER),
        ('TOPPADDING', (0,0), (-1,-1), 2),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
    ]))
    return t


def badge(valor, label, st, color=PRIMARY):
    data = [[Paragraph(str(valor), st['badge_val'])],
            [Paragraph(label,      st['badge_lbl'])]]
    t = Table(data, colWidths=[38*mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), color),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('ROUNDEDCORNERS', [3]),
    ]))
    return t


def row_badges(data_list, st):
    cols = [badge(v, l, st) for v, l in data_list]
    t = Table([cols], colWidths=[40*mm]*len(cols))
    t.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),2),('RIGHTPADDING',(0,0),(-1,-1),2)]))
    return t


def pagina1(data, st, story):
    specs   = data['specs']
    driver  = data.get('driver', {})
    certs   = data.get('certificaciones', {})
    modelo  = data.get('modelo', '')
    marca   = data.get('marca', 'eLIGHTS')
    sku     = data.get('sku_base', '')
    cat     = data.get('categoria', '')
    fotom   = data.get('fotometria', {})
    variantes = data.get('variantes_cct', [])
    # TAG CATEGORIA
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(cat.upper(), st['tag']))
    story.append(Spacer(1, 2*mm))
    # TITULO MODELO
    story.append(Paragraph(modelo, st['titulo']))
    story.append(hr_primary())
    # LINEA SPECS CLAVE
    flujo   = specs.get('flujo_lm', 0)
    eficacia= specs.get('eficacia_lmW', 0)
    potencia= specs.get('potencia_W', 0)
    cri     = specs.get('cri', '>=80')
    ip      = specs.get('ip', 'IP66')
    specs_line = f'{potencia}W | {flujo} lm | {eficacia} lm/W | CRI {cri} | {ip}'
    story.append(Paragraph(specs_line, st['h3']))
    # SKU / MARCA / GARANTIA
    garantia = specs.get('garantia_anos', 5)
    sku_line = f'SKU: {sku}  |  Marca: {marca}  |  Garantía: {garantia} años'
    story.append(Paragraph(sku_line, st['small']))
    story.append(Spacer(1, 2*mm))
    # DESCRIPCION COMERCIAL
    desc = (f'Luminaria LED de alumbrado público y vial de alta eficiencia. Diseñada para ',
            f'vías urbanas, avenidas y espacios públicos. Certificada SEC para el mercado chileno. ',
            f'Datos fotométricos medidos por laboratorio VOLNIC con gonioradómetro GON-2000.')
    story.append(Paragraph(' '.join(desc), st['desc']))
    # BADGES
    story.append(row_badges([
        (f'{flujo} lm',    'Flujo Luminoso'),
        (f'{eficacia}',    'lm/W Eficacia'),
        ('50.000 h',       'Vida Útil'),
        (f'{garantia} años', 'Garantía'),
    ], st))
    story.append(Spacer(1, 3*mm))
    # TABLA ESPECIFICACIONES
    story.append(Paragraph('ESPECIFICACIONES TÉCNICAS', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    voltaje_in = specs.get('voltaje_entrada', 'AC 100-277V 50-60Hz')
    fp         = specs.get('factor_potencia', '')
    tipo_led   = specs.get('tipo_led', 'Bridgelux')
    material   = specs.get('material', 'Aluminio fundido')
    montaje    = specs.get('montaje', 'Poste ø26-60mm')
    dim        = specs.get('dimensiones_mm', '')
    peso       = specs.get('peso_kg', '')
    volt_nom   = specs.get('voltaje_nominal_V', '')
    corriente  = specs.get('corriente_A', '')
    tabla_data = [
        ('Potencia nominal',         f'{potencia} W'),
        ('Flujo luminoso',           f'{flujo} lm'),
        ('Eficacia',                 f'{eficacia} lm/W'),
        ('Tensión de entrada',        voltaje_in),
        ('Factor de potencia',       str(fp)),
        ('Chip LED',                 tipo_led),
        ('CRI',                      str(cri)),
        ('Grado de protección',       ip),
        ('Temperatura de color',     ', '.join(str(v) for v in data.get('variantes_cct', [{}])[0].get('cct_K', ['4000K'])) if variantes else '4000K'),
        ('Material carcasa',         material),
        ('Montaje',                  montaje),
        ('Dimensiones (mm)',         str(dim)),
        ('Peso',                     f'{peso} kg'),
    ]
    story.append(tabla_specs(tabla_data, st))
    story.append(Spacer(1, 2*mm))
    # DRIVER
    story.append(Paragraph('DRIVER / FUENTE DE PODER', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    drv_data = [
        ('Marca driver',    driver.get('marca', 'Mean Well')),
        ('Tipo',            driver.get('tipo', 'Regulable 0-10V')),
        ('Rango voltaje',   driver.get('rango_voltaje', 'AC 100-277V')),
        ('Factor potencia', driver.get('factor_potencia', '>0.95')),
        ('Protección',       driver.get('proteccion', 'OCP, OVP, OTP, SCP')),
    ]
    story.append(tabla_specs(drv_data, st))
    story.append(Spacer(1, 2*mm))
    # CERTIFICACIONES
    story.append(Paragraph('CERTIFICACIONES', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    cert_text = certs.get('sec', 'SEC — PE Nº5/07 y DS1')
    normas    = certs.get('normas', [])
    story.append(Paragraph(f'<font color="#29b35b">✓</font> {cert_text}', st['body']))
    for n in normas:
        story.append(Paragraph(f'• {n}', st['small']))


def pagina2(data, familia, st, story):
    story.append(PageBreak())
    specs    = data['specs']
    modelo   = data.get('modelo', '')
    sku_base = data.get('sku_base', '')
    # VARIANTES CCT
    story.append(Paragraph('VARIANTES DE TEMPERATURA DE COLOR', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    variantes = data.get('variantes_cct', [])
    if variantes:
        hdr = [Paragraph(h, st['tabla_hdr']) for h in ['CCT', 'SKU', 'Flujo (lm)', 'Eficacia (lm/W)', 'Aplicación']]
        filas_v = [hdr]
        for v in variantes:
            filas_v.append([
                Paragraph(str(v.get('cct_K', '')), st['tabla_cel']),
                Paragraph(str(v.get('sku', '')),   st['tabla_cel']),
                Paragraph(str(v.get('flujo_lm', specs.get('flujo_lm',''))), st['tabla_cel']),
                Paragraph(str(v.get('eficacia_lmW', specs.get('eficacia_lmW',''))), st['tabla_cel']),
                Paragraph(str(v.get('aplicacion', '')), st['tabla_cel']),
            ])
        tv = Table(filas_v, colWidths=[25*mm, 35*mm, 30*mm, 35*mm, 45*mm])
        tv.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), PRIMARY),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [SECONDARY, BG_WHITE]),
            ('GRID', (0,0), (-1,-1), 0.4, BORDER),
            ('TOPPADDING', (0,0), (-1,-1), 2),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ('LEFTPADDING', (0,0), (-1,-1), 3),
        ]))
        story.append(tv)
    story.append(Spacer(1, 3*mm))
    # TABLA LINEA COMPLETA
    story.append(Paragraph('LÍNEA COMPLETA BESTLED', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    if familia:
        hdr_f = [Paragraph(h, st['tabla_hdr']) for h in ['Modelo', 'Potencia', 'Flujo (lm)', 'Eficacia', 'FP', 'Voltaje']]
        filas_f = [hdr_f]
        for m in familia:
            m_specs = m.get('specs', {})
            is_current = m.get('sku_base', '') == sku_base
            row_bg = ACCENT if is_current else None
            row = [
                Paragraph(('<b>' + m.get('modelo','') + '</b>') if is_current else m.get('modelo',''), st['tabla_cel']),
                Paragraph(str(m_specs.get('potencia_W','')), st['tabla_cel']),
                Paragraph(str(m_specs.get('flujo_lm','')), st['tabla_cel']),
                Paragraph(str(m_specs.get('eficacia_lmW','')), st['tabla_cel']),
                Paragraph(str(m_specs.get('factor_potencia','')), st['tabla_cel']),
                Paragraph(str(m_specs.get('voltaje_nominal_V','')), st['tabla_cel']),
            ]
            filas_f.append(row)
        tf = Table(filas_f, colWidths=[42*mm, 22*mm, 28*mm, 24*mm, 14*mm, 22*mm])
        style_cmds = [
            ('BACKGROUND', (0,0), (-1,0), PRIMARY),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [SECONDARY, BG_WHITE]),
            ('GRID', (0,0), (-1,-1), 0.4, BORDER),
            ('TOPPADDING', (0,0), (-1,-1), 2),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ('LEFTPADDING', (0,0), (-1,-1), 3),
        ]
        for i, m in enumerate(familia):
            if m.get('sku_base','') == sku_base:
                style_cmds.append(('BACKGROUND', (0, i+1), (-1, i+1), ACCENT))
        tf.setStyle(TableStyle(style_cmds))
        story.append(tf)
    story.append(Spacer(1, 3*mm))
    # APLICACIONES RECOMENDADAS
    story.append(Paragraph('APLICACIONES RECOMENDADAS', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    aplicaciones = [
        '• Alumbrado público vial (vías urbanas y avenidas)',
        '• Parques y plazas públicas',
        '• Estacionamientos y pérgolas',
        '• Perimetrales industriales y comerciales',
        '• Zonas residenciales y condominios',
    ]
    for a in aplicaciones:
        story.append(Paragraph(a, st['body']))
    story.append(Spacer(1, 2*mm))
    # DIMENSIONES Y PACKAGING
    story.append(Paragraph('DIMENSIONES Y PACKAGING', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    pkg = data.get('packaging', {})
    dim = specs.get('dimensiones_mm', 'N/D')
    peso = specs.get('peso_kg', 'N/D')
    diam = specs.get('diametro_anclaje_mm', 'N/D')
    pkg_data = [
        ('Dimensiones (L x An x Al)', str(dim)),
        ('Peso luminaria',            f'{peso} kg'),
        ('Diámetro anclaje',           f'{diam} mm'),
        ('Unidades por caja',         str(pkg.get('unidades_caja', 1))),
        ('Peso con caja',             f'{pkg.get("peso_caja_kg", "N/D")} kg'),
        ('Caja (mm)',                 str(pkg.get('caja_mm', 'N/D'))),
    ]
    story.append(tabla_specs(pkg_data, st))


def pagina3(data, st, story, polar_png_path=None):
    story.append(PageBreak())
    fotom  = data.get('fotometria', {})
    specs  = data.get('specs', {})
    modelo = data.get('modelo', '')
    # DISTRIBUCION LUMINOSA
    story.append(Paragraph('DISTRIBUCIÓN LUMINOSA / FOTOMETRÍA', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    # DIAGRAMA POLAR REAL
    if polar_png_path and os.path.exists(polar_png_path):
        try:
            img = ImageReader(polar_png_path)
            img_w = 150*mm
            img_h = img_w * (400/380)
            from reportlab.platypus import Image as RLImage
            story.append(RLImage(polar_png_path, width=img_w, height=img_h))
            story.append(Spacer(1, 2*mm))
        except Exception as e:
            story.append(Paragraph(f'[Diagrama polar: {polar_png_path}]', st['small']))
    else:
        story.append(Paragraph('[Diagrama polar: pendiente generación PNG]', st['small']))
        story.append(Spacer(1, 4*mm))
    # DATOS FOTOMETRICOS
    story.append(Paragraph('DATOS FOTOMÉTRICOS (VOLNIC GON-2000)', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    ang_haz   = fotom.get('angulo_haz_50_deg', 'N/D')
    clasif    = fotom.get('clasificacion_ies', 'Type I / Short / Cutoff')
    int_max   = fotom.get('intensidad_max_cd', 'N/D')
    flujo_d   = fotom.get('flujo_descendente_pct', 'N/D')
    lab       = fotom.get('laboratorio', 'VOLNIC')
    equipo    = fotom.get('equipo', 'GON-2000')
    fecha_e   = fotom.get('fecha_ensayo', '2024-03-08')
    fot_data  = [
        ('Laboratorio',               lab),
        ('Equipo de medición',         equipo),
        ('Fecha de ensayo',           fecha_e),
        ('Ángulo de haz (50%)',         f'{ang_haz}°'),
        ('Clasificación IES',           clasif),
        ('Intensidad máxima',           f'{int_max} cd'),
        ('Flujo descendente',         f'{flujo_d}%'),
    ]
    story.append(tabla_specs(fot_data, st))
    story.append(Spacer(1, 2*mm))
    # 6 COMPONENTES
    story.append(Paragraph('COMPONENTES PRINCIPALES', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    componentes = [
        ('1', 'Carcasa / Disipador', 'Aluminio fundido A380, tratamiento antioxidante'),
        ('2', 'LED', 'Chip Bridgelux BXEM, vida útil >50.000h L70'),
        ('3', 'Driver', 'Mean Well, regulable 0-10V, PF>0.95'),
        ('4', 'Óptica', 'PC premium, transmitancia >92%, IK08'),
        ('5', 'Junta', 'Silicona doble sello, IP66 certificado'),
        ('6', 'Conector', 'Glands PG, conector rápido 2P+T'),
    ]
    for num, nombre, desc in componentes:
        story.append(Paragraph(f'<font color="#6a19d4"><b>{num}.</b></font> <b>{nombre}:</b> {desc}', st['body']))
    story.append(Spacer(1, 2*mm))
    # NOTAS DE INSTALACION
    story.append(Paragraph('NOTAS DE INSTALACIÓN', st['seccion']))
    story.append(hr(PRIMARY, 0.8))
    notas = [
        'La luminaria debe ser instalada por personal eléctrico calificado.',
        'Asegurar puesta a tierra correcta antes de energizar.',
        'Respetar rango de voltaje de entrada (AC 100-277V).',
        'No exponer al agua durante la instalación (antes de sellado).',
        'Para montaje en poste, usar abrazadera ø26-60mm incluida.',
    ]
    for n in notas:
        story.append(Paragraph(f'• {n}', st['small']))
    story.append(Spacer(1, 2*mm))
    # DISCLAIMER
    story.append(hr())
    disclaimers = [
        'Los datos fotométricos son resultados de mediciones de laboratorio y pueden variar ±5% en producción serie.',
        'Dimensiones y pesos marcados B son estimaciones; validar con proveedor antes de publicar.',
        'Certificación SEC vigente. Verificar número de resolución en www.sec.cl.',
    ]
    for d in disclaimers:
        story.append(Paragraph(d, st['nota']))


def on_page(canvas, doc, data):
    """Header y footer en cada pagina."""
    canvas.saveState()
    margin = 15*mm
    # --- HEADER ---
    # Barra superior degradado (simulado con rectangulo primary)
    canvas.setFillColor(PRIMARY)
    canvas.rect(0, H - 14*mm, W, 14*mm, fill=1, stroke=0)
    # Nombre marca
    canvas.setFillColor(colors.white)
    canvas.setFont('Helvetica-Bold', 14)
    canvas.drawString(margin, H - 9*mm, 'eLIGHTS')
    canvas.setFont('Helvetica', 8)
    canvas.drawString(margin + 42*mm, H - 9*mm, 'www.elights.cl  |  Alumbrado Público LED')
    # Numero de pagina (derecha)
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(W - margin, H - 9*mm, f'Página {doc.page}')
    # --- FOOTER ---
    canvas.setFillColor(FOREGROUND)
    canvas.rect(0, 0, W, 10*mm, fill=1, stroke=0)
    canvas.setFillColor(PRIMARY)
    canvas.setFont('Helvetica-Bold', 9)
    canvas.drawString(margin, 3.5*mm, 'eLIGHTS.cl')
    canvas.setFillColor(colors.white)
    canvas.setFont('Helvetica', 7)
    canvas.drawString(margin + 28*mm, 3.5*mm, 'contacto@elights.cl  |  +56 2 2345 6789  |  Santiago, Chile')
    canvas.drawRightString(W - margin, 3.5*mm, 'Ficha Técnica v2.0')
    canvas.restoreState()


def generar_ficha_pdf(json_path, output_pdf, familia_json_path=None, polar_png_path=None):
    with open(json_path, encoding='utf-8') as f:
        data = json.load(f)
    familia = []
    if familia_json_path and os.path.exists(familia_json_path):
        with open(familia_json_path, encoding='utf-8') as f:
            familia = json.load(f)
    os.makedirs(os.path.dirname(output_pdf), exist_ok=True)
    margin = 15*mm
    doc = SimpleDocTemplate(
        output_pdf,
        pagesize=A4,
        leftMargin=margin, rightMargin=margin,
        topMargin=20*mm, bottomMargin=15*mm,
    )
    st = estilos()
    story = []
    pagina1(data, st, story)
    pagina2(data, familia, st, story)
    pagina3(data, st, story, polar_png_path=polar_png_path)
    doc.build(story, onFirstPage=lambda c,d: on_page(c,d,data),
                     onLaterPages=lambda c,d: on_page(c,d,data))
    print(f'  PDF generado: {output_pdf}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('json_path')
    ap.add_argument('output_pdf')
    ap.add_argument('--familia', default=None)
    ap.add_argument('--polar',   default=None)
    args = ap.parse_args()
    generar_ficha_pdf(args.json_path, args.output_pdf, args.familia, args.polar)
