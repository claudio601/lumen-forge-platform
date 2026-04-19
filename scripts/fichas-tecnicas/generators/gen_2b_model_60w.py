#!/usr/bin/env python3
"""Generador del modelo 60W canonical BESTLED - Micro-fase 2b.

Pobla modelos["60"] en bestled-canonical.json con las 3 variantes CCT
(2700/4000/6000K) compartiendo la fotometria VOLNIC (D5).

Reglas aplicadas:
  D1 - Fotometria desde .IES VOLNIC raw (root_factory_raw, no rebrand).
  D4 - laboratorio normalizado a "VOLNIC".
  D5 - 3 CCTs comparten misma medicion (fotometria_origen="compartida_modelo").
  D6 - Dimensiones del 60W con confidence="high" (quality_score A).
  R1 - Sin inventar: campos sin fuente autoritativa quedan null/low.
  R11 - garantia_override_anos=null (hereda commercial_policy.garantia_anos=5).
  R12 - 3 variantes CCT expandidas explicitamente.
  Regla A - Cada campo auditable con valor_canonical/estado/fuentes/confidence.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CANONICAL_PATH = ROOT / "docs" / "fichas-tecnicas" / "bestled-canonical.json"
PHASE1_PATH = ROOT / "docs" / "fichas-tecnicas" / "bestled-phase1-sources.json"

IES_SOURCE_ID = "ies_root_60W"
PIPELINE_SOURCE_ID = "pipeline_base_data"
MODEL_KEY = "60"
MODEL_POWER_W = 60


def field(
    valor=None,
    estado="missing",
    criterio=None,
    auth_rule=None,
    winning=None,
    conf="low",
    fuentes=None,
):
    return {
        "valor_canonical": valor,
        "estado_resolucion": estado,
        "criterio_resolucion": criterio,
        "authority_rule_applied": auth_rule,
        "winning_source_id": winning,
        "confidence": conf,
        "fuentes": fuentes or [],
    }


def fuente(source_id, valor_bruto, extracted_at, sha256=None, notes=None):
    entry = {
        "source_id": source_id,
        "valor_bruto": valor_bruto,
        "extracted_at": extracted_at,
    }
    if sha256 is not None:
        entry["sha256"] = sha256
    if notes is not None:
        entry["notes"] = notes
    return entry


def locate_ies_volnic_60w(phase1):
    """Busca el IES VOLNIC raw del 60W (D1: root_factory_raw, no rebrand)."""
    for rec in phase1.get("raw_ies_data", []):
        if rec.get("source_set") == "root_factory_raw" and rec.get("model") == "60W":
            return rec
    raise SystemExit("ABORT: no se encontro IES VOLNIC raw para 60W en phase1.")


def locate_pipeline_60w(phase1):
    pj = phase1.get("raw_pipeline_json", {})
    by_model = pj.get("bestled_by_model", {})
    data = by_model.get(MODEL_KEY)
    if data is None:
        raise SystemExit("ABORT: no se encontro entrada 60W en raw_pipeline_json.")
    return data


def parse_mm_triple(texto):
    """Convierte '500 x 210 x 75' a (500, 210, 75) enteros."""
    partes = [p.strip() for p in texto.lower().replace("×", "x").split("x")]
    if len(partes) != 3:
        raise ValueError(f"Formato inesperado de dimensiones: {texto!r}")
    return tuple(int(round(float(p))) for p in partes)


def ies_extracted_at(canonical, source_id):
    for s in canonical.get("sources_consulted", []):
        if s.get("source_id") == source_id:
            return s.get("extracted_at")
    return None


def build_variante_cct(cct_nominal, cct_label, ies_rec, ies_extracted, ies_source_id):
    variant_id = f"BESTLED-060-{cct_nominal}K"
    photo = ies_rec.get("photometric_data", {})
    headers = ies_rec.get("headers", {})
    sha = ies_rec.get("sha256")
    ies_filename = ies_rec.get("filename")
    ies_abspath = ies_rec.get("absolute_path_relative")

    flujo = photo.get("flujo_lumenes")
    imax = photo.get("intensidad_max_cd")
    watts = photo.get("input_watts")
    eficacia = round(flujo / watts, 2) if flujo and watts else None

    ies_fecha = headers.get("issuedate")  # "2024/03/08"

    fuente_ies = fuente(
        ies_source_id,
        {"filename": ies_filename, "path": ies_abspath},
        ies_extracted,
        sha256=sha,
        notes="IES VOLNIC raw, autoritativo D1. Fotometria compartida por las 3 CCTs (D5).",
    )

    criterio_foto = (
        "Valor extraido del .IES VOLNIC raw del 60W. Misma medicion aplica a las 3 "
        "variantes CCT (D5 fotometria_origen=compartida_modelo)."
    )

    return {
        "variant_id": variant_id,
        "cct_nominal_K": cct_nominal,
        "cct_label": cct_label,
        "sku": field(
            valor=variant_id,
            estado="resolved",
            criterio="Construido como BESTLED-060-{CCT}K siguiendo convencion familia.",
            auth_rule="sku_construccion",
            winning="derived_from_family_convention",
            conf="high",
            fuentes=[],
        ),
        "ies_file": ies_abspath,
        "ies_filename_exacto": ies_filename,
        "ies_hash_sha256": sha,
        "ies_fecha_medicion": ies_fecha,
        "laboratorio": field(
            valor="VOLNIC",
            estado="resolved",
            criterio="Normalizacion casing D4: 'VOLNIC' del header testlab.",
            auth_rule="fotometria",
            winning=ies_source_id,
            conf="high",
            fuentes=[
                fuente(
                    ies_source_id,
                    headers.get("testlab"),
                    ies_extracted,
                    sha256=sha,
                )
            ],
        ),
        "lab_test_id": headers.get("test"),
        "measurement_context": {
            "valor_canonical": "compartida_modelo",
            "nota": (
                "Los .IES VOLNIC del 60W no diferencian CCT. Una misma medicion "
                "fotometrica aplica a las 3 variantes 2700/4000/6000K (D5)."
            ),
        },
        "flujo_lumenes": field(
            valor=flujo,
            estado="resolved",
            criterio=criterio_foto,
            auth_rule="fotometria",
            winning=ies_source_id,
            conf="high",
            fuentes=[fuente_ies],
        ),
        "eficacia_lm_W": field(
            valor=eficacia,
            estado="resolved",
            criterio=(
                "Derivado flujo_lumenes / input_watts del .IES VOLNIC raw "
                f"({flujo} / {watts})."
            ),
            auth_rule="fotometria",
            winning=ies_source_id,
            conf="high",
            fuentes=[fuente_ies],
        ),
        "intensidad_max_cd": field(
            valor=imax,
            estado="resolved",
            criterio=criterio_foto,
            auth_rule="fotometria",
            winning=ies_source_id,
            conf="high",
            fuentes=[fuente_ies],
        ),
        "distribucion": field(
            valor=None,
            estado="missing",
            criterio=(
                "Clasificacion IES (Type I/II/III/short/medium/long) no extraida "
                "en Fase 1. Pendiente analisis de angulos en Fase 3."
            ),
            auth_rule=None,
            winning=None,
            conf="low",
            fuentes=[],
        ),
        "angulo_apertura_50pct": {
            "longitudinal_grados": field(
                valor=None,
                estado="missing",
                criterio=(
                    "Calculo de FWHM longitudinal requiere procesar curva C0. "
                    "Pendiente para Fase 3."
                ),
                conf="low",
            ),
            "transversal_grados": field(
                valor=None,
                estado="missing",
                criterio=(
                    "Calculo de FWHM transversal requiere procesar curva C90. "
                    "Pendiente para Fase 3."
                ),
                conf="low",
            ),
        },
        "cri_medido": field(
            valor=None,
            estado="missing",
            criterio=(
                "El .IES no reporta CRI medido. bestled_common declara cri>=80 "
                "como especificacion (no medicion por CCT). R1: no se asume valor."
            ),
            conf="low",
        ),
        "sdcm": field(
            valor=None,
            estado="missing",
            criterio="SDCM no reportado en fuentes autoritativas consultadas.",
            conf="low",
        ),
        "bug_rating": {
            "B": field(valor=None, estado="missing", criterio="B-U-G no computado en Fase 1.", conf="low"),
            "U": field(valor=None, estado="missing", criterio="B-U-G no computado en Fase 1.", conf="low"),
            "G": field(valor=None, estado="missing", criterio="B-U-G no computado en Fase 1.", conf="low"),
        },
        "fotometria_origen": "compartida_modelo",
        "nota_fotometrica": (
            "Los datos fotometricos aplican a todas las CCT del modelo. No hay "
            "medicion diferenciada por temperatura de color en los .IES VOLNIC del 60W."
        ),
    }


def main():
    canonical = json.loads(CANONICAL_PATH.read_text(encoding="utf-8"))
    phase1 = json.loads(PHASE1_PATH.read_text(encoding="utf-8"))

    modelos = canonical.setdefault("modelos", {})
    if modelos:
        raise SystemExit(
            f"ABORT: canonical.modelos ya tiene entradas {list(modelos.keys())}. "
            "Esta fase solo debe poblar el 60W sobre un modelos vacio."
        )

    ies_rec = locate_ies_volnic_60w(phase1)
    pipe = locate_pipeline_60w(phase1)
    ies_extracted = ies_extracted_at(canonical, IES_SOURCE_ID)
    pipe_extracted = ies_extracted_at(canonical, PIPELINE_SOURCE_ID)

    # Fisicas desde pipeline (D6: quality_score A -> confidence high).
    largo, ancho, alto = parse_mm_triple(pipe["dimensiones_mm"])
    pk_largo, pk_ancho, pk_alto = parse_mm_triple(pipe["packaging_dimensiones_mm"])

    fuente_pipe_dims = fuente(
        PIPELINE_SOURCE_ID,
        {"dimensiones_mm": pipe["dimensiones_mm"], "quality_score": pipe.get("quality_score")},
        pipe_extracted,
        notes="bestled_base_data.json, datos confirmados con ficha de agencia.",
    )
    fuente_pipe_peso = fuente(
        PIPELINE_SOURCE_ID,
        {"peso_kg": pipe["peso_kg"], "quality_score": pipe.get("quality_score")},
        pipe_extracted,
    )
    fuente_pipe_pack_dims = fuente(
        PIPELINE_SOURCE_ID,
        {"packaging_dimensiones_mm": pipe["packaging_dimensiones_mm"]},
        pipe_extracted,
    )
    fuente_pipe_pack_peso = fuente(
        PIPELINE_SOURCE_ID,
        {"packaging_peso_kg": pipe["packaging_peso_kg"]},
        pipe_extracted,
    )
    fuente_pipe_pack_cant = fuente(
        PIPELINE_SOURCE_ID,
        {"packaging_cantidad": pipe["packaging_cantidad"]},
        pipe_extracted,
    )

    criterio_dims_60w = (
        "bestled_base_data.json quality_score=A para 60W (D6). Datos confirmados con "
        "ficha de agencia segun nota en pipeline; unico modelo con confidence high en dimensiones."
    )

    variante_2700 = build_variante_cct(
        2700, "Calido", ies_rec, ies_extracted, IES_SOURCE_ID
    )
    variante_4000 = build_variante_cct(
        4000, "Neutro", ies_rec, ies_extracted, IES_SOURCE_ID
    )
    variante_6000 = build_variante_cct(
        6000, "Frio", ies_rec, ies_extracted, IES_SOURCE_ID
    )

    modelo_60 = {
        "codigo_modelo": field(
            valor="BESTLED-060",
            estado="resolved",
            criterio="Convencion familia BESTLED + potencia 060 (3 digitos, padding).",
            auth_rule="sku_construccion",
            winning="derived_from_family_convention",
            conf="high",
        ),
        "nombre_comercial": field(
            valor="BESTLED 60W",
            estado="resolved",
            criterio="Marca BESTLED + potencia. Coincide con header IES rebrand y pipeline sku_base APB60.",
            auth_rule="nombre_comercial_construccion",
            winning="derived_from_family_convention",
            conf="high",
        ),
        "slug": field(
            valor="bestled-60w",
            estado="resolved",
            criterio="Slug kebab-case derivado de nombre_comercial.",
            auth_rule="slug_construccion",
            winning="derived_from_family_convention",
            conf="high",
        ),
        "potencia_W": MODEL_POWER_W,
        "estado_comercial": field(
            valor="activo",
            estado="resolved",
            criterio="Modelo de referencia de la familia BESTLED, vigente en catalogo.",
            auth_rule="manual_default",
            winning="family_reference_model",
            conf="medium",
        ),
        "publicable": field(
            valor=None,
            estado="missing",
            criterio="Se determina en Fase 3 segun template_readiness (aprobacion humana).",
            conf="low",
        ),
        "visible_en_web": field(
            valor=None,
            estado="missing",
            criterio="Se determina en Fase 3 segun estado de assets y aprobacion.",
            conf="low",
        ),
        "sku_base_proveedor": field(
            valor=pipe.get("sku_base"),
            estado="resolved",
            criterio="sku_base desde bestled_base_data.json (APB60).",
            auth_rule="especificaciones_mecanicas",
            winning=PIPELINE_SOURCE_ID,
            conf="high",
            fuentes=[
                fuente(
                    PIPELINE_SOURCE_ID,
                    {"sku_base": pipe.get("sku_base")},
                    pipe_extracted,
                )
            ],
        ),
        "dimensiones_mm": {
            "largo": field(
                valor=largo,
                estado="resolved",
                criterio=criterio_dims_60w,
                auth_rule="especificaciones_mecanicas",
                winning=PIPELINE_SOURCE_ID,
                conf="high",
                fuentes=[fuente_pipe_dims],
            ),
            "ancho": field(
                valor=ancho,
                estado="resolved",
                criterio=criterio_dims_60w,
                auth_rule="especificaciones_mecanicas",
                winning=PIPELINE_SOURCE_ID,
                conf="high",
                fuentes=[fuente_pipe_dims],
            ),
            "alto": field(
                valor=alto,
                estado="resolved",
                criterio=criterio_dims_60w,
                auth_rule="especificaciones_mecanicas",
                winning=PIPELINE_SOURCE_ID,
                conf="high",
                fuentes=[fuente_pipe_dims],
            ),
        },
        "diametro_anclaje_mm": field(
            valor=pipe.get("diametro_anclaje_mm"),
            estado="resolved",
            criterio="diametro_anclaje_mm desde bestled_base_data.json para 60W.",
            auth_rule="especificaciones_mecanicas",
            winning=PIPELINE_SOURCE_ID,
            conf="high",
            fuentes=[
                fuente(
                    PIPELINE_SOURCE_ID,
                    {"diametro_anclaje_mm": pipe.get("diametro_anclaje_mm")},
                    pipe_extracted,
                )
            ],
        ),
        "peso_kg": field(
            valor=pipe.get("peso_kg"),
            estado="resolved",
            criterio="bestled_base_data.json quality_score=A para 60W (D6).",
            auth_rule="especificaciones_mecanicas",
            winning=PIPELINE_SOURCE_ID,
            conf="high",
            fuentes=[fuente_pipe_peso],
        ),
        "embalaje": {
            "unidades_por_caja": field(
                valor=pipe.get("packaging_cantidad"),
                estado="resolved",
                criterio="packaging_cantidad desde bestled_base_data.json.",
                auth_rule="especificaciones_mecanicas",
                winning=PIPELINE_SOURCE_ID,
                conf="high",
                fuentes=[fuente_pipe_pack_cant],
            ),
            "dimensiones_caja_mm": {
                "largo": field(
                    valor=pk_largo,
                    estado="resolved",
                    criterio="packaging_dimensiones_mm desde bestled_base_data.json.",
                    auth_rule="especificaciones_mecanicas",
                    winning=PIPELINE_SOURCE_ID,
                    conf="high",
                    fuentes=[fuente_pipe_pack_dims],
                ),
                "ancho": field(
                    valor=pk_ancho,
                    estado="resolved",
                    criterio="packaging_dimensiones_mm desde bestled_base_data.json.",
                    auth_rule="especificaciones_mecanicas",
                    winning=PIPELINE_SOURCE_ID,
                    conf="high",
                    fuentes=[fuente_pipe_pack_dims],
                ),
                "alto": field(
                    valor=pk_alto,
                    estado="resolved",
                    criterio="packaging_dimensiones_mm desde bestled_base_data.json.",
                    auth_rule="especificaciones_mecanicas",
                    winning=PIPELINE_SOURCE_ID,
                    conf="high",
                    fuentes=[fuente_pipe_pack_dims],
                ),
            },
            "peso_bruto_kg": field(
                valor=pipe.get("packaging_peso_kg"),
                estado="resolved",
                criterio="packaging_peso_kg desde bestled_base_data.json.",
                auth_rule="especificaciones_mecanicas",
                winning=PIPELINE_SOURCE_ID,
                conf="high",
                fuentes=[fuente_pipe_pack_peso],
            ),
        },
        "garantia_override_anos": {
            "valor_canonical": None,
            "nota": (
                "Hereda commercial_policy.garantia_anos=5 (R11). No override especifico "
                "para el modelo 60W."
            ),
        },
        "variantes_cct": {
            "2700": variante_2700,
            "4000": variante_4000,
            "6000": variante_6000,
        },
        "assets": {
            "product_photos": [],
            "hero_image": None,
            "dimension_drawing": None,
            "polar_diagram_svg": None,
            "polar_diagram_png": None,
            "component_callout_image": None,
            "datasheet_pdf": None,
            "certificates_files": [],
        },
        "template_readiness": {
            "v4_tecnica": {"status": None, "motivos": []},
            "v5_premium": {"status": None, "motivos": []},
            "publicacion_web": {"status": None, "motivos": []},
        },
    }

    modelos[MODEL_KEY] = modelo_60

    meta = canonical.setdefault("metadata", {})
    meta["consolidated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta["micro_phase"] = "2b_model_60w"

    CANONICAL_PATH.write_text(
        json.dumps(canonical, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    variantes = modelo_60["variantes_cct"]
    print("OK Modelo 60W insertado en canonical.modelos['60']")
    print(f"  Variantes CCT keys: {list(variantes.keys())}")
    print(f"  Variant IDs: {[v['variant_id'] for v in variantes.values()]}")
    print(
        f"  Dimensiones: {largo}x{ancho}x{alto} mm "
        f"(confidence={modelo_60['dimensiones_mm']['largo']['confidence']})"
    )
    print(f"  Peso: {pipe.get('peso_kg')} kg")
    print(
        f"  Fotometria VOLNIC: flujo={variantes['4000']['flujo_lumenes']['valor_canonical']} lm, "
        f"imax={variantes['4000']['intensidad_max_cd']['valor_canonical']} cd, "
        f"eficacia={variantes['4000']['eficacia_lm_W']['valor_canonical']} lm/W"
    )
    print(f"  Laboratorio: {variantes['4000']['laboratorio']['valor_canonical']}")
    print(f"  Tamano canonical: {len(json.dumps(canonical)):,} chars")


if __name__ == "__main__":
    main()
