#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_ficha_pdf.py - Generador de fichas tecnicas PDF para linea BESTLED
Pipeline: JSON de producto -> PDF 3 paginas. eLIGHTS.cl
"""
import json, os, sys, argparse
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, PageBreak, KeepTogether
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY

W, H = A4

# Paleta de colores eLIGHTS
AZUL        = colors.HexColor('#1a3a5c')
AZUL_CLARO  = colors.HexColor('#2e6da4')
AZUL_MEDIO  = colors.HexColor('#3498db')
NARANJA     = colors.HexColor('#e67e22')
GRIS_OSCURO = colors.HexColor('#2c3e50')
GRIS_MEDIO  = colors.HexColor('#7f8c8d')
GRIS_CLARO  = colors.HexColor('#ecf0f1')
GRIS_BORDE  = colors.HexColor('#bdc3c7')
AMARILLO    = colors.HexColor('#f39c12')
VERDE       = colors.HexColor('#27ae60')
ROJO        = colors.HexColor('#c0392b')
BLANCO      = colors.white
NEGRO       = colors.black

def estilos():
    ss = getSampleStyleSheet()
    return {
        'titulo':    ParagraphStyle('titulo',    fontSize=22, textColor=AZUL,       fontName='Helvetica-Bold',   spaceAfter=2*mm),
        'subtitulo': ParagraphStyle('subtitulo', fontSize=14, textColor=AZUL_CLARO, fontName='Helvetica-Bold',   spaceAfter=1*mm),
        'h3':        ParagraphStyle('h3',        fontSize=10, textColor=AZUL,       fontName='Helvetica-Bold',   spaceAfter=1*mm),
        'body':      ParagraphStyle('body',      fontSize=8,  textColor=GRIS_OSCURO, fontName='Helvetica',       spaceAfter=1*mm),
        'small':     ParagraphStyle('small',     fontSize=7,  textColor=GRIS_MEDIO,  fontName='Helvetica',       spaceAfter=0.5*mm),
        'badge_val': ParagraphStyle('badge_val', fontSize=16, textColor=BLANCO,      fontName='Helvetica-Bold',  alignment=TA_CENTER),
        'badge_lbl': ParagraphStyle('badge_lbl', fontSize=7,  textColor=BLANCO,      fontName='Helvetica',       alignment=TA_CENTER),
        'tag':       ParagraphStyle('tag',       fontSize=8,  textColor=BLANCO,      fontName='Helvetica-Bold',  alignment=TA_CENTER, backColor=NARANJA),
        'header_r':  ParagraphStyle('header_r',  fontSize=7,  textColor=BLANCO,      fontName='Helvetica',       alignment=TA_RIGHT),
        'seccion':   ParagraphStyle('seccion',   fontSize=9,  textColor=AZUL,        fontName='Helvetica-Bold',  spaceAfter=1*mm, spaceBefore=2*mm),
        'tabla_hdr': ParagraphStyle('tabla_hdr', fontSize=8,  textColor=BLANCO,      fontName='Helvetica-Bold',  alignment=TA_CENTER),
        'tabla_cel': ParagraphStyle('tabla_cel', fontSize=7.5, textColor=GRIS_OSCURO, fontName='Helvetica'),
        'footer':    ParagraphStyle('footer',    fontSize=6.5, textColor=GRIS_MEDIO,  fontName='Helvetica',       alignment=TA_CENTER),
        'nota':      ParagraphStyle('nota',      fontSize=7,  textColor=GRIS_MEDIO,  fontName='Helvetica-Oblique', spaceAfter=1*mm),
        'desc':      ParagraphStyle('desc',      fontSize=8,  textColor=GRIS_OSCURO, fontName='Helvetica',       alignment=TA_JUSTIFY, spaceAfter=2*mm),
    }

def build_badge(valor, unidad, label, color_fondo=AZUL_CLARO, width=40*mm, height=22*mm):
    from reportlab.platypus import Table as T, TableStyle as TS
    data = [[Paragraph(f'<b>{valor}</b>', ParagraphStyle('bv', fontSize=14, textColor=BLANCO, fontName='Helvetica-Bold', alignment=TA_CENTER))],
            [Paragraph(unidad,  ParagraphStyle('bu', fontSize=7,  textColor=BLANCO, fontName='Helvetica',       alignment=TA_CENTER))],
            [Paragraph(label,   ParagraphStyle('bl', fontSize=6.5, textColor=BLANCO, fontName='Helvetica-Oblique', alignment=TA_CENTER))]]
    t = T(data, colWidths=[width])
    t.setStyle(TS([('BACKGROUND', (0,0), (-1,-1), color_fondo),
                   ('ALIGN',      (0,0), (-1,-1), 'CENTER'),
                   ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
                   ('TOPPADDING',    (0,0), (-1,-1), 3),
                   ('BOTTOMPADDING', (0,0), (-1,-1), 3),
                   ('LEFTPADDING',   (0,0), (-1,-1), 2),
                   ('RIGHTPADDING',  (0,0), (-1,-1), 2),
                   ('ROUNDEDCORNERS', [3]),
                   ]))
    return t

def header_canvas(c, doc, p):
    c.saveState()
    # Barra header
    c.setFillColor(AZUL)
    c.rect(0, H - 20*mm, W, 20*mm, fill=1, stroke=0)
    # Logo texto eLIGHTS
    c.setFillColor(BLANCO)
    c.setFont('Helvetica-Bold', 16)
    c.drawString(15*mm, H - 13*mm, 'eLIGHTS')
    c.setFont('Helvetica', 7)
    c.drawString(15*mm, H - 17*mm, 'Soluciones de Iluminacion Profesional')
    # Info derecha
    meta = p.get('metadata', {})
    specs = p.get('specs', {})
    qs = meta.get('quality_score', 'B')
    qs_color = VERDE if qs == 'A' else AMARILLO
    c.setFillColor(qs_color)
    c.roundRect(W - 30*mm, H - 16*mm, 18*mm, 9*mm, 2, fill=1, stroke=0)
    c.setFillColor(BLANCO)
    c.setFont('Helvetica-Bold', 7)
    c.drawCentredString(W - 21*mm, H - 11*mm, f'QS: {qs}')
    c.setFont('Helvetica', 6)
    c.drawCentredString(W - 21*mm, H - 14*mm, meta.get('fecha_generacion',''))
    # Version
    c.setFillColor(BLANCO)
    c.setFont('Helvetica', 6)
    c.drawRightString(W - 35*mm, H - 11*mm, f'v{meta.get("version_ficha",1)}')
    c.drawRightString(W - 35*mm, H - 14*mm, meta.get('fuente_datos','')[:30])
    # Footer
    c.setFillColor(AZUL)
    c.rect(0, 0, W, 10*mm, fill=1, stroke=0)
    c.setFillColor(BLANCO)
    c.setFont('Helvetica', 6)
    c.drawCentredString(W/2, 6*mm, 'eLIGHTS.cl | contacto@elights.cl | +56 2 2345 6789')
    c.drawCentredString(W/2, 3.5*mm, 'Los datos de esta ficha provienen de mediciones de laboratorio certificado VOLNIC. Sujeto a cambios sin previo aviso.')
    c.drawString(15*mm, 6*mm, f'Pag. {doc.page}')
    c.restoreState()

def pagina1(p, st):
    s = p.get('specs', {})
    m = p.get('metadata', {})
    elems = []
    # Tag categoria
    elems.append(Spacer(1, 2*mm))
    tag_data = [[Paragraph(p.get('categoria',''), st['tag'])]]
    tag_t = Table(tag_data, colWidths=[60*mm])
    tag_t.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), NARANJA), ('TOPPADDING',(0,0),(-1,-1),2), ('BOTTOMPADDING',(0,0),(-1,-1),2)]))
    elems.append(tag_t)
    elems.append(Spacer(1, 2*mm))
    # Titulo producto
    modelo = p.get('modelo', '')
    elems.append(Paragraph(modelo, st['titulo']))
    # Linea specs clave
    pot = s.get('potencia_nominal_w','')
    flu = s.get('flujo_luminoso_lm','')
    efi = s.get('eficacia_lm_w','')
    ip  = s.get('ip', '')
    ik  = s.get('ik', '')
    elems.append(Paragraph(f'<font color="#2e6da4">{pot}W</font>  |  {flu} lm  |  {efi} lm/W  |  {ip}  |  {ik}', st['body']))
    elems.append(Spacer(1, 1*mm))
    # SKU / Marca / Garantia
    sku = p.get('sku_base', '')
    marca = p.get('marca', '')
    gar = p.get('certificaciones', {}).get('garantia_anos', 5)
    elems.append(Paragraph(f'SKU: <b>{sku}</b> &nbsp;&nbsp; Marca: <b>{marca}</b> &nbsp;&nbsp; Garantia: <b>{gar} anos</b>', st['body']))
    elems.append(Spacer(1, 2*mm))
    elems.append(HRFlowable(width='100%', thickness=0.5, color=GRIS_BORDE))
    elems.append(Spacer(1, 2*mm))
    # Descripcion comercial
    desc_txt = (f'Luminaria LED de alumbrado publico de {pot}W con modulos {s.get("tipo_led","Bridgelux")}. '
               f'Flujo luminoso de {flu} lm con eficacia de {efi} lm/W. '
               f'Carcasa de {s.get("material","Aluminio")} con proteccion {ip}/{ik}. '
               f'Driver {p.get("driver",{}).get("marca","Mean Well")} con dimming {p.get("driver",{}).get("dimming","")}. '
               f'Certificada {p.get("certificaciones",{}).get("certificacion","")}.')
    elems.append(Paragraph(desc_txt, st['desc']))
    elems.append(Spacer(1, 2*mm))
    # 4 Badges
    b1 = build_badge(f'{flu:,}', 'lm', 'Flujo Luminoso', AZUL_CLARO, 41*mm)
    b2 = build_badge(f'{efi}', 'lm/W', 'Eficacia', AZUL, 41*mm)
    b3 = build_badge(f'{s.get("vida_util_h",100000)//1000}K', 'horas', 'Vida Util', GRIS_OSCURO, 41*mm)
    b4 = build_badge(f'{gar}', 'anos', 'Garantia', NARANJA, 41*mm)
    badges_t = Table([[b1, b2, b3, b4]], colWidths=[43*mm, 43*mm, 43*mm, 43*mm])
    badges_t.setStyle(TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'), ('VALIGN',(0,0),(-1,-1),'TOP'), ('LEFTPADDING',(0,0),(-1,-1),1), ('RIGHTPADDING',(0,0),(-1,-1),1)]))
    elems.append(badges_t)
    elems.append(Spacer(1, 4*mm))
    # Tabla de especificaciones tecnicas 2 columnas
    elems.append(Paragraph('Especificaciones Tecnicas', st['seccion']))
    specs_rows = [
        ('Potencia nominal', f'{pot} W'),
        ('Potencia medida', f'{s.get("potencia_medida_w",pot)} W'),
        ('Flujo luminoso', f'{flu} lm'),
        ('Eficacia luminosa', f'{efi} lm/W'),
        ('Tension de entrada', s.get('voltaje_entrada','')),
        ('Corriente', f'{s.get("amperaje_a","")} A'),
        ('Factor de potencia', f'{s.get("factor_potencia","")}'),
        ('CCT disponibles', ' / '.join(s.get('cct_opciones', []))),
        ('IRC (CRI)', s.get('cri','')),
        ('Tipo LED', s.get('tipo_led','')),
        ('Proteccion', f'{ip} / {ik}'),
        ('Material', s.get('material','')),
        ('Color cuerpo', s.get('color_cuerpo','')),
        ('Dimensiones (mm)', s.get('dimensiones_mm','')),
        ('Peso', f'{s.get("peso_kg","")} kg'),
        ('Diametro anclaje', f'{s.get("diametro_anclaje_mm","")} mm'),
        ('Tipo montaje', s.get('montaje','')),
        ('Altura recomendada', s.get('altura_montaje','')),
        ('Vida util', f'{s.get("vida_util_h",100000):,} horas'),
        ('Temperatura operacion', p.get('certificaciones',{}).get('temp_operacion','')),
    ]
    mid = len(specs_rows) // 2
    left_rows = specs_rows[:mid]
    right_rows = specs_rows[mid:]
    tbl_data = []
    for i in range(max(len(left_rows), len(right_rows))):
        row = []
        if i < len(left_rows):
            k, v = left_rows[i]
            row += [Paragraph(k, st['tabla_cel']), Paragraph(f'<b>{v}</b>', st['tabla_cel'])]
        else:
            row += [Paragraph('', st['tabla_cel']), Paragraph('', st['tabla_cel'])]
        if i < len(right_rows):
            k, v = right_rows[i]
            row += [Paragraph(k, st['tabla_cel']), Paragraph(f'<b>{v}</b>', st['tabla_cel'])]
        else:
            row += [Paragraph('', st['tabla_cel']), Paragraph('', st['tabla_cel'])]
        tbl_data.append(row)
    cw = [46*mm, 42*mm, 46*mm, 42*mm]
    tbl = Table(tbl_data, colWidths=cw, repeatRows=0)
    ts_specs = [
        ('BACKGROUND', (0,0), (1,0), GRIS_CLARO),
        ('BACKGROUND', (3,0), (4,0), GRIS_CLARO),
        ('FONTNAME',   (0,0), (-1,-1), 'Helvetica'),
        ('FONTSIZE',   (0,0), (-1,-1), 7.5),
        ('TOPPADDING',    (0,0), (-1,-1), 2),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2),
        ('LEFTPADDING',   (0,0), (-1,-1), 3),
        ('RIGHTPADDING',  (0,0), (-1,-1), 3),
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [BLANCO, GRIS_CLARO]),
        ('LINEBELOW',  (0,0), (-1,-1), 0.3, GRIS_BORDE),
        ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
    ]
    tbl.setStyle(TableStyle(ts_specs))
    elems.append(tbl)
    elems.append(Spacer(1, 3*mm))
    # Driver
    drv = p.get('driver', {})
    elems.append(Paragraph('Driver / Control', st['seccion']))
    drv_rows = [
        [Paragraph('Marca driver', st['tabla_cel']), Paragraph(f'<b>{drv.get("marca","")}</b>', st['tabla_cel'])],
        [Paragraph('Dimming', st['tabla_cel']), Paragraph(f'<b>{drv.get("dimming","")}</b>', st['tabla_cel'])],
        [Paragraph('Compartimiento', st['tabla_cel']), Paragraph(drv.get('compartimiento',''), st['tabla_cel'])],
    ]
    drv_t = Table(drv_rows, colWidths=[60*mm, 115*mm])
    drv_t.setStyle(TableStyle([('ROWBACKGROUNDS',(0,0),(-1,-1),[BLANCO, GRIS_CLARO]), ('LINEBELOW',(0,0),(-1,-1),0.3,GRIS_BORDE), ('TOPPADDING',(0,0),(-1,-1),2), ('BOTTOMPADDING',(0,0),(-1,-1),2), ('LEFTPADDING',(0,0),(-1,-1),3)]))
    elems.append(drv_t)
    elems.append(Spacer(1, 2*mm))
    # Certificaciones
    cert = p.get('certificaciones', {})
    elems.append(Paragraph('Certificaciones y Garantia', st['seccion']))
    cert_rows = [
        [Paragraph('Certificacion', st['tabla_cel']), Paragraph(f'<b>{cert.get("certificacion","")}</b>', st['tabla_cel'])],
        [Paragraph('Garantia', st['tabla_cel']), Paragraph(f'<b>{cert.get("garantia_anos",5)} anos</b>', st['tabla_cel'])],
        [Paragraph('Temp. operacion', st['tabla_cel']), Paragraph(cert.get('temp_operacion',''), st['tabla_cel'])],
    ]
    cert_t = Table(cert_rows, colWidths=[60*mm, 115*mm])
    cert_t.setStyle(TableStyle([('ROWBACKGROUNDS',(0,0),(-1,-1),[BLANCO, GRIS_CLARO]), ('LINEBELOW',(0,0),(-1,-1),0.3,GRIS_BORDE), ('TOPPADDING',(0,0),(-1,-1),2), ('BOTTOMPADDING',(0,0),(-1,-1),2), ('LEFTPADDING',(0,0),(-1,-1),3)]))
    elems.append(cert_t)
    return elems

def pagina2(p, familia, st):
    s = p.get('specs', {})
    elems = [PageBreak()]
    elems.append(Spacer(1, 2*mm))
    # Tabla de variantes CCT
    elems.append(Paragraph('Variantes por Temperatura de Color (CCT)', st['seccion']))
    variantes = p.get('variantes_cct', [])
    hdr_v = [Paragraph(h, st['tabla_hdr']) for h in ['SKU', 'CCT', 'Descripcion']]
    vrows = [hdr_v]
    for v in variantes:
        vrows.append([Paragraph(v.get('sku',''), st['tabla_cel']), Paragraph(v.get('cct',''), st['tabla_cel']), Paragraph(v.get('descripcion',''), st['tabla_cel'])])
    vt = Table(vrows, colWidths=[35*mm, 40*mm, 100*mm])
    vt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),AZUL), ('TEXTCOLOR',(0,0),(-1,0),BLANCO), ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'), ('FONTSIZE',(0,0),(-1,-1),8), ('ROWBACKGROUNDS',(0,1),(-1,-1),[BLANCO,GRIS_CLARO]), ('LINEBELOW',(0,0),(-1,-1),0.3,GRIS_BORDE), ('TOPPADDING',(0,0),(-1,-1),3), ('BOTTOMPADDING',(0,0),(-1,-1),3), ('LEFTPADDING',(0,0),(-1,-1),4)]))
    elems.append(vt)
    elems.append(Spacer(1, 4*mm))
    # Tabla linea completa
    elems.append(Paragraph('Linea Completa BESTLED - Datos de Laboratorio VOLNIC', st['seccion']))
    if familia:
        fam_hdrs = ['Modelo', 'Potencia', 'Flujo (lm)', 'Eficacia (lm/W)', 'FP', 'IP/IK', 'Garantia']
        fam_data = [[Paragraph(h, st['tabla_hdr']) for h in fam_hdrs]]
        for fm in familia:
            fs = fm.get('specs', {})
            fc = fm.get('certificaciones', {})
            fam_data.append([
                Paragraph(fm.get('modelo',''), st['tabla_cel']),
                Paragraph(f'{fs.get("potencia_nominal_w","")}W', st['tabla_cel']),
                Paragraph(f'{fs.get("flujo_luminoso_lm",""):,}', st['tabla_cel']),
                Paragraph(f'{fs.get("eficacia_lm_w","")}', st['tabla_cel']),
                Paragraph(f'{fs.get("factor_potencia","")}', st['tabla_cel']),
                Paragraph(f'{fs.get("ip","")} / {fs.get("ik","")}', st['tabla_cel']),
                Paragraph(f'{fc.get("garantia_anos",5)} anos', st['tabla_cel']),
            ])
        fam_t = Table(fam_data, colWidths=[35*mm, 22*mm, 28*mm, 32*mm, 18*mm, 25*mm, 22*mm])
        fam_t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),AZUL_CLARO), ('TEXTCOLOR',(0,0),(-1,0),BLANCO), ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'), ('FONTSIZE',(0,0),(-1,-1),7.5), ('ROWBACKGROUNDS',(0,1),(-1,-1),[BLANCO,GRIS_CLARO]), ('LINEBELOW',(0,0),(-1,-1),0.3,GRIS_BORDE), ('TOPPADDING',(0,0),(-1,-1),2.5), ('BOTTOMPADDING',(0,0),(-1,-1),2.5), ('LEFTPADDING',(0,0),(-1,-1),3)]))
        elems.append(fam_t)
    elems.append(Spacer(1, 4*mm))
    # Aplicaciones
    elems.append(Paragraph('Aplicaciones Recomendadas', st['seccion']))
    apps = ['Alumbrado vial y avenidas', 'Parques y plazas', 'Autopistas y carreteras', 'Zonas industriales', 'Puertos y aeropuertos', 'Proyectos de eficiencia energetica municipal']
    app_data = []
    for i in range(0, len(apps), 3):
        row = apps[i:i+3]
        while len(row) < 3: row.append('')
        app_data.append([Paragraph(f'• {x}', st['body']) if x else Paragraph('', st['body']) for x in row])
    app_t = Table(app_data, colWidths=[58*mm, 58*mm, 60*mm])
    app_t.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2), ('BOTTOMPADDING',(0,0),(-1,-1),2)]))
    elems.append(app_t)
    elems.append(Spacer(1, 4*mm))
    # Dimensiones y packaging
    elems.append(Paragraph('Dimensiones y Embalaje', st['seccion']))
    pkg = p.get('packaging', {})
    dim_rows = [
        [Paragraph('Dimensiones luminaria', st['tabla_cel']), Paragraph(f'<b>{s.get("dimensiones_mm","")} mm</b>', st['tabla_cel'])],
        [Paragraph('Peso luminaria', st['tabla_cel']), Paragraph(f'<b>{s.get("peso_kg","")} kg</b>', st['tabla_cel'])],
        [Paragraph('Diametro anclaje', st['tabla_cel']), Paragraph(f'<b>{s.get("diametro_anclaje_mm","")} mm</b>', st['tabla_cel'])],
        [Paragraph('Unidades por caja', st['tabla_cel']), Paragraph(f'<b>{pkg.get("cantidad_por_caja","")} un</b>', st['tabla_cel'])],
        [Paragraph('Dimensiones caja', st['tabla_cel']), Paragraph(f'<b>{pkg.get("dimensiones_caja_mm","")} mm</b>', st['tabla_cel'])],
        [Paragraph('Peso caja', st['tabla_cel']), Paragraph(f'<b>{pkg.get("peso_caja_kg","")} kg</b>', st['tabla_cel'])],
    ]
    dim_t = Table(dim_rows, colWidths=[60*mm, 116*mm])
    dim_t.setStyle(TableStyle([('ROWBACKGROUNDS',(0,0),(-1,-1),[BLANCO,GRIS_CLARO]), ('LINEBELOW',(0,0),(-1,-1),0.3,GRIS_BORDE), ('TOPPADDING',(0,0),(-1,-1),2), ('BOTTOMPADDING',(0,0),(-1,-1),2), ('LEFTPADDING',(0,0),(-1,-1),4)]))
    elems.append(dim_t)
    return elems

def pagina3(p, st):
    s  = p.get('specs', {})
    ft = p.get('fotometria', {})
    elems = [PageBreak()]
    elems.append(Spacer(1, 2*mm))
    # Detalle constructivo
    elems.append(Paragraph('Detalle Constructivo', st['seccion']))
    componentes = [
        ('1', 'Carcasa', f'Fundicion de {s.get("material","Aluminio")}. Acabado epoxi polvo. Alta resistencia a la corrosion y UV.'),
        ('2', 'Optica', 'Vidrio templado plano 4mm. Transmitancia >90%. Junta silicona EPDM para sellado IP66.'),
        ('3', 'Modulo LED', f'Chip {s.get("tipo_led","Bridgelux")} de alta eficiencia. Temperatura de color seleccionable. CRI {s.get("cri",">=80")}.'),
        ('4', 'Driver', f'Driver {p.get("driver",{}).get("marca","Mean Well")} de alta eficiencia. Dimming {p.get("driver",{}).get("dimming","")}. Compartimiento independiente.'),
        ('5', 'Sistema de anclaje', f'Compatible con brazo Ø{s.get("diametro_anclaje_mm",53)}mm. Apertura lateral para mantenimiento. Sin herramientas.'),
        ('6', 'Conexion electrica', f'Entrada {s.get("voltaje_entrada","AC 100-277V")}. Bloque de terminales IP68. Cable de entrada 1m.'),
    ]
    comp_data = []
    for num, titulo, desc in componentes:
        comp_data.append([
            Paragraph(f'<b>{num}</b>', ParagraphStyle('cn', fontSize=12, textColor=BLANCO, fontName='Helvetica-Bold', alignment=TA_CENTER)),
            Paragraph(f'<b>{titulo}</b>', st['h3']),
            Paragraph(desc, st['body']),
        ])
    comp_t = Table(comp_data, colWidths=[10*mm, 35*mm, 130*mm])
    comp_ts = [
        ('BACKGROUND', (0,0), (0,-1), AZUL_CLARO),
        ('BACKGROUND', (1,0), (-1,-1), GRIS_CLARO),
        ('ALIGN', (0,0), (0,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (1,0), (-1,-1), [BLANCO, GRIS_CLARO]),
        ('LINEBELOW', (0,0), (-1,-1), 0.5, GRIS_BORDE),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
    ]
    comp_t.setStyle(TableStyle(comp_ts))
    elems.append(comp_t)
    elems.append(Spacer(1, 4*mm))
    # Datos fotometricos
    elems.append(Paragraph('Datos Fotometricos - Laboratorio VOLNIC', st['seccion']))
    foto_rows = [
        [Paragraph('Laboratorio', st['tabla_cel']), Paragraph(f'<b>{ft.get("laboratorio","VOLNIC")}</b>', st['tabla_cel']), Paragraph('Clasificacion IES', st['tabla_cel']), Paragraph(f'<b>{s.get("clasificacion_ies","")}</b>', st['tabla_cel'])],
        [Paragraph('Equipo', st['tabla_cel']), Paragraph(f'<b>{ft.get("equipo","GON-2000")}</b>', st['tabla_cel']), Paragraph('Angulo haz 50%', st['tabla_cel']), Paragraph(f'<b>{s.get("angulo_haz_50_deg","")} deg</b>', st['tabla_cel'])],
        [Paragraph('Fecha ensayo', st['tabla_cel']), Paragraph(f'<b>{ft.get("fecha_ensayo","")}</b>', st['tabla_cel']), Paragraph('Flujo descendente', st['tabla_cel']), Paragraph(f'<b>{s.get("flujo_descendente_pct","")} %</b>', st['tabla_cel'])],
        [Paragraph('Archivo IES', st['tabla_cel']), Paragraph(f'<b>{ft.get("archivo_ies","")}</b>', st['tabla_cel']), Paragraph('Intensidad maxima', st['tabla_cel']), Paragraph(f'<b>{s.get("intensidad_max_cd","")} cd</b>', st['tabla_cel'])],
        [Paragraph('Temperatura ensayo', st['tabla_cel']), Paragraph(f'<b>{ft.get("temperatura_ensayo_c",25)} C</b>', st['tabla_cel']), Paragraph('Flujo luminoso total', st['tabla_cel']), Paragraph(f'<b>{s.get("flujo_luminoso_lm",""):,} lm</b>', st['tabla_cel'])],
        [Paragraph('Humedad ensayo', st['tabla_cel']), Paragraph(f'<b>{ft.get("humedad_ensayo_pct",68)} %</b>', st['tabla_cel']), Paragraph('Eficacia', st['tabla_cel']), Paragraph(f'<b>{s.get("eficacia_lm_w","")} lm/W</b>', st['tabla_cel'])],
    ]
    foto_t = Table(foto_rows, colWidths=[38*mm, 48*mm, 38*mm, 52*mm])
    foto_t.setStyle(TableStyle([('ROWBACKGROUNDS',(0,0),(-1,-1),[BLANCO,GRIS_CLARO]), ('LINEBELOW',(0,0),(-1,-1),0.3,GRIS_BORDE), ('TOPPADDING',(0,0),(-1,-1),2.5), ('BOTTOMPADDING',(0,0),(-1,-1),2.5), ('LEFTPADDING',(0,0),(-1,-1),4)]))
    elems.append(foto_t)
    elems.append(Spacer(1, 4*mm))
    # Placeholder diagrama fotometrico
    diag_data = [[
        Paragraph('[DIAGRAMA POLAR]\nDisponible en archivo .IES adjunto\nVer software DIALux / AGi32', ParagraphStyle('ph', fontSize=8, textColor=GRIS_MEDIO, fontName='Helvetica-Oblique', alignment=TA_CENTER)),
        Paragraph('[CURVA ISOCANDELA]\nDisponible en archivo .IES adjunto\nVer software DIALux / AGi32', ParagraphStyle('ph', fontSize=8, textColor=GRIS_MEDIO, fontName='Helvetica-Oblique', alignment=TA_CENTER)),
    ]]
    diag_t = Table(diag_data, colWidths=[87*mm, 87*mm])
    diag_t.setStyle(TableStyle([('BOX',(0,0),(0,0),0.5,GRIS_BORDE), ('BOX',(1,0),(1,0),0.5,GRIS_BORDE), ('BACKGROUND',(0,0),(-1,-1),GRIS_CLARO), ('TOPPADDING',(0,0),(-1,-1),15), ('BOTTOMPADDING',(0,0),(-1,-1),15), ('ALIGN',(0,0),(-1,-1),'CENTER'), ('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
    elems.append(diag_t)
    elems.append(Spacer(1, 4*mm))
    # Notas de instalacion
    elems.append(Paragraph('Notas de Instalacion', st['seccion']))
    notas = [
        'Verificar la resistencia estructural del poste antes de instalar. Torque de apriete: 25 Nm.',
        'Conectar a tierra de proteccion. Cable de tierra minimo 4mm2 Cu.',
        'Respetar polaridad de conexion segun etiquetado interior del compartimiento driver.',
        f'Altura de montaje recomendada: {s.get("altura_montaje","5 a 12 metros")}.',
        'Esperar 15 minutos para alcanzar temperatura de operacion estable antes de medir flujo.',
        'En caso de dimming: configurar controlador DALI segun protocolo IEC 62386.',
    ]
    for nota in notas:
        elems.append(Paragraph(f'• {nota}', st['nota']))
    elems.append(Spacer(1, 3*mm))
    # Disclaimers
    elems.append(HRFlowable(width='100%', thickness=0.3, color=GRIS_BORDE))
    elems.append(Spacer(1, 1*mm))
    meta = p.get('metadata', {})
    disc = 'FICHA TECNICA - ' + p.get('modelo','') + ' | QS:' + meta.get('quality_score','B') + ' | ' + meta.get('estado_editorial','') + ' | ' + meta.get('nota_calidad','')
    elems.append(Paragraph(disc, st['footer']))
    return elems

def generar_ficha_pdf(producto_json, output_path, familia_json=None):
    with open(producto_json, 'r', encoding='utf-8') as f:
        p = json.load(f)
    familia = []
    if familia_json and os.path.exists(familia_json):
        with open(familia_json, 'r', encoding='utf-8') as f:
            familia = json.load(f)
    st = estilos()
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=15*mm, leftMargin=15*mm,
        topMargin=25*mm, bottomMargin=15*mm,
        title=f'Ficha Tecnica {p.get("modelo","")} - eLIGHTS',
        author='eLIGHTS.cl',
        subject=f'Luminaria LED {p.get("modelo","")}',
    )
    def on_page(canvas, doc):
        header_canvas(canvas, doc, p)
    story = []
    story += pagina1(p, st)
    story += pagina2(p, familia, st)
    story += pagina3(p, st)
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f'  PDF generado: {output_path}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Genera ficha tecnica PDF desde JSON de producto')
    parser.add_argument('producto_json', help='Ruta al JSON del producto')
    parser.add_argument('--output', '-o', default=None, help='Archivo PDF de salida')
    parser.add_argument('--familia', default=None, help='JSON con lista de productos de la familia')
    args = parser.parse_args()
    out = args.output
    if not out:
        base = os.path.splitext(os.path.basename(args.producto_json))[0]
        out = f'docs/fichas-tecnicas/pdf/FT-eLIGHTS-{base.upper()}.pdf'
    os.makedirs(os.path.dirname(out), exist_ok=True)
    generar_ficha_pdf(args.producto_json, out, args.familia)