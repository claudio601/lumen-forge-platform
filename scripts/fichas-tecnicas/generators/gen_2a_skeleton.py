#!/usr/bin/env python3
"""Generador del esqueleto canonical BESTLED - Micro-fase 2a.

Construye docs/fichas-tecnicas/bestled-canonical.json con:
- Top-level keys completos del schema v2.1.2
- sources_consulted copiadas desde phase1 + authority_level (D1, D7)
- 8 manual_decisions (D1-D8 + md_001)
- 4 conflictos pre-resueltos (D1 VOLNIC, D3 garantia, D4 casing, D7 output_derivado)
- claims_publicables con valores null + nota
- modelos: {} vacio (micro-fases 2b-2e pobladas despues)
- brand_info, commercial_policy, construction con estructura Regla A
"""
import json
import subprocess
from datetime import datetime, timezone

PHASE1_PATH = "docs/fichas-tecnicas/bestled-phase1-sources.json"
OUTPUT_PATH = "docs/fichas-tecnicas/bestled-canonical.json"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True
        ).strip()
    except Exception:
        return "unknown"


def field(valor=None, estado="missing", auth_rule=None, winning=None,
          conf="low", fuentes=None, criterio=None, extra=None):
    """Helper Regla A - campo auditable completo."""
    d = {
        "valor_canonical": valor,
        "estado_resolucion": estado,
        "criterio_resolucion": criterio,
        "authority_rule_applied": auth_rule,
        "winning_source_id": winning,
        "confidence": conf,
        "fuentes": fuentes or [],
    }
    if extra:
        d.update(extra)
    return d


def claim(valor=None, ejemplo=None, nota=None):
    """Helper Regla D - claim publicable simplificado."""
    return {
        "valor_canonical": valor,
        "ejemplo_render_permitido": ejemplo,
        "nota": nota,
    }


def authority_level_for(source_id: str, source_status: str) -> str:
    """Asigna authority_level segun D1 (VOLNIC raw = max) y D7 (pipeline = cross_check)."""
    if source_status != "consulted":
        return source_status
    if source_id.startswith("ies_root_"):
        return "authoritative_max_fotometria"
    if source_id.startswith("ies_docs_"):
        return "reconstruction_v3_rebrand"
    if source_id == "pipeline_base_data":
        return "cross_check_only"
    if source_id.startswith("pdf_unversioned_"):
        return "pdf_historical_v4"
    if source_id == "business_ts_constants":
        return "commercial_proxy_placeholder"
    return "secondary"


def load_phase1():
    with open(PHASE1_PATH, encoding="utf-8") as f:
        return json.load(f)


def build_sources(phase1):
    enriched = []
    for s in phase1.get("sources_consulted", []):
        s2 = dict(s)
        s2["authority_level"] = authority_level_for(
            s.get("source_id", ""), s.get("source_status", "")
        )
        enriched.append(s2)
    return enriched


def build_manual_decisions():
    return [
        {
            "decision_id": "md_F1_ies_authority",
            "campo_path": "fotometria.set_autoritativo",
            "decision_valor": "VOLNIC_raw_root",
            "decidido_por": "Claudio Quero",
            "fecha": "2026-04-17",
            "motivo": (
                "Los .IES oficiales medidos en laboratorio son los VOLNIC raw "
                "del root. El set rebrand es reconstruccion del pipeline v3, "
                "no medicion."
            ),
            "override_type": "technical_clarification",
        },
        {
            "decision_id": "md_F2_pdfs_v4",
            "campo_path": "sources.pdf_historical_classification",
            "decision_valor": "tratar_como_v4",
            "decidido_por": "Claudio Quero",
            "fecha": "2026-04-17",
            "motivo": (
                "PDFs en docs/fichas-tecnicas/pdf/ sin sufijo v4 en filename "
                "declaran v4.0 en cuerpo. Tratar como pdf_historical v4."
            ),
            "override_type": "technical_clarification",
        },
        {
            "decision_id": "md_F5_garantia_bestled",
            "campo_path": "commercial_policy.garantia_anos",
            "decision_valor": 5,
            "decidido_por": "Claudio Quero",
            "fecha": "2026-04-17",
            "motivo": (
                "Garantia oficial categoria BESTLED alumbrado publico. "
                "business.ts contenia placeholder obsoleto de 1 ano; fuentes "
                "tecnicas (base_data + PDFs v4) coinciden en 5 anos."
            ),
            "override_type": "commercial_decision",
        },
        {
            "decision_id": "md_F7_volnic_casing",
            "campo_path": "modelos.*.variantes_cct.*.laboratorio",
            "decision_valor": "VOLNIC",
            "decidido_por": "Claudio Quero",
            "fecha": "2026-04-17",
            "motivo": (
                "Inconsistencia de casing VOLNIC vs Volnic IES en factory raw. "
                "Normalizar a VOLNIC (uppercase)."
            ),
            "override_type": "technical_clarification",
        },
        {
            "decision_id": "md_F8_cct_compartida",
            "campo_path": "product_family.fotometria_diferenciada_por_cct",
            "decision_valor": False,
            "decidido_por": "Claudio Quero",
            "fecha": "2026-04-17",
            "motivo": (
                "Archivos .IES VOLNIC no contienen CCT. Las 3 variantes "
                "(2700/4000/6000K) comparten misma medicion fotometrica del "
                "modelo."
            ),
            "override_type": "technical_clarification",
        },
        {
            "decision_id": "md_F9_dimensiones_confidence",
            "campo_path": "modelos.*.dimensiones_mm",
            "decision_valor": "60W=high, 40/90/120/150/200/250=low",
            "decidido_por": "Claudio Quero",
            "fecha": "2026-04-17",
            "motivo": (
                "bestled_base_data.json reporta quality_score=A solo para 60W. "
                "Otros 6 modelos con score B nota 'Dimensiones estimadas - "
                "validar con proveedor'."
            ),
            "override_type": "technical_clarification",
        },
        {
            "decision_id": "md_F10_output_derivado",
            "campo_path": "sources.pipeline_json_derived_authority",
            "decision_valor": "cross_check_only",
            "decidido_por": "Claudio Quero",
            "fecha": "2026-04-17",
            "motivo": (
                "JSONs en docs/fichas-tecnicas/json/ son output del pipeline "
                "v3. Usar solo para cross-check, no como fuente primaria."
            ),
            "override_type": "technical_clarification",
        },
        {
            "decision_id": "md_001_trayectoria_8_anos",
            "campo_path": "brand_info.trayectoria_anos",
            "decision_valor": 8,
            "decidido_por": "Claudio Quero",
            "fecha": "2026-04-17",
            "motivo": (
                "Correccion historica registrada en memoria del proyecto. "
                "Reemplaza claim anterior de 10 anos que era inexacto."
            ),
            "override_type": "corporate_fact",
        },
    ]


def build_conflictos_preresueltos():
    return [
        {
            "conflict_id": "conf_D1_ies_authority_split",
            "campo_path": "fotometria.set_autoritativo",
            "severity": "critical",
            "bloquea_publicacion": False,
            "bloquea_render_premium": False,
            "valores_encontrados": [
                {
                    "source_id": "ies_root_*",
                    "valor": "VOLNIC_raw_root (factory measured)",
                    "fecha_fuente": None,
                },
                {
                    "source_id": "ies_docs_*",
                    "valor": "rebrand_reconstructed_v3",
                    "fecha_fuente": None,
                },
            ],
            "authority_rule_applied": "fotometria",
            "resolucion_propuesta": "VOLNIC_raw_root",
            "requiere_decision_humana": False,
            "estado_resolucion": "resolved",
            "resolved_by": "md_F1_ies_authority",
            "criterio_recomendado": (
                "Mediciones de laboratorio (VOLNIC GON-2000) prevalecen sobre "
                "reconstrucciones de pipeline."
            ),
        },
        {
            "conflict_id": "conf_D3_garantia_anos",
            "campo_path": "commercial_policy.garantia_anos",
            "severity": "critical",
            "bloquea_publicacion": False,
            "bloquea_render_premium": False,
            "valores_encontrados": [
                {
                    "source_id": "business_ts_constants",
                    "valor": 1,
                    "fecha_fuente": None,
                    "estado": "placeholder_obsoleto",
                },
                {
                    "source_id": "pipeline_base_data",
                    "valor": 5,
                    "fecha_fuente": None,
                },
                {
                    "source_id": "pdf_unversioned_*",
                    "valor": 5,
                    "fecha_fuente": None,
                },
            ],
            "authority_rule_applied": "claims_comerciales",
            "resolucion_propuesta": 5,
            "requiere_decision_humana": False,
            "estado_resolucion": "resolved",
            "resolved_by": "md_F5_garantia_bestled",
            "criterio_recomendado": (
                "business.ts contenia placeholder 1 ano; fuentes tecnicas y "
                "PDFs v4 coinciden en 5 anos."
            ),
        },
        {
            "conflict_id": "conf_D4_volnic_casing",
            "campo_path": "sources.ies_root_*.laboratorio",
            "severity": "minor",
            "bloquea_publicacion": False,
            "bloquea_render_premium": False,
            "valores_encontrados": [
                {
                    "source_id": "ies_root_variant_A",
                    "valor": "VOLNIC",
                    "fecha_fuente": None,
                },
                {
                    "source_id": "ies_root_variant_B",
                    "valor": "Volnic IES",
                    "fecha_fuente": None,
                },
            ],
            "authority_rule_applied": "fotometria",
            "resolucion_propuesta": "VOLNIC",
            "requiere_decision_humana": False,
            "estado_resolucion": "resolved",
            "resolved_by": "md_F7_volnic_casing",
            "criterio_recomendado": "Normalizar casing uppercase.",
        },
        {
            "conflict_id": "conf_D7_pipeline_json_authority",
            "campo_path": "sources.pipeline_base_data.authority_level",
            "severity": "major",
            "bloquea_publicacion": False,
            "bloquea_render_premium": False,
            "valores_encontrados": [
                {
                    "source_id": "pipeline_base_data",
                    "valor": "output_derivado_v3",
                    "fecha_fuente": None,
                },
            ],
            "authority_rule_applied": "fotometria",
            "resolucion_propuesta": "cross_check_only",
            "requiere_decision_humana": False,
            "estado_resolucion": "resolved",
            "resolved_by": "md_F10_output_derivado",
            "criterio_recomendado": (
                "JSONs del pipeline son output derivado, no fuente primaria."
            ),
        },
    ]


def build_claims_publicables():
    return {
        "_comentario_regla_d": (
            "Estructura editorial simplificada segun Regla D. Solo migrar a "
            "estructura completa si se detecta conflicto real entre fuentes."
        ),
        "headline_producto": claim(
            ejemplo="Luminaria vial LED de alta eficacia",
            nota="Titulo principal de ficha premium",
        ),
        "subheadline_producto": claim(
            nota="Bajada editorial 1-2 lineas",
        ),
        "beneficios_clave": claim(
            valor=[],
            ejemplo="['IP66 sellado', 'Driver dimeable 0-10V', '50.000 h L70', 'SEC · DS-1']",
            nota="Array de 4-6 claims cortos para pagina de beneficios",
        ),
        "claim_vida_util_principal": claim(
            ejemplo="50.000 h · L70 a 25 °C",
            nota=(
                "Que vida util mostrar en fichas. Si existen dos versiones "
                "historicas (50.000 h L70 y 100.000 h L50), elegir una."
            ),
        ),
        "claim_vida_util_secundaria": claim(
            nota="Solo si se decide mostrar ambas vidas utiles",
        ),
        "claim_certificacion_principal": claim(
            ejemplo="SEC · DS-1",
        ),
        "claim_montaje_principal": claim(
            ejemplo="Poste o gancho 60 mm",
        ),
        "claim_distribucion_principal": claim(
            ejemplo="Vial Tipo II · ANSI/IES",
        ),
        "claim_aplicacion_principal": claim(
            ejemplo="Alumbrado publico vial y peatonal",
        ),
        "claim_driver": claim(
            ejemplo="Driver dimeable 0-10 V · FP > 0,93",
        ),
        "claim_fotometria": claim(
            nota="Claim sintetico de fotometria",
        ),
        "garantia_display": claim(
            ejemplo="5 anos",
            nota=(
                "Formato publicable de garantia. Debe coincidir con "
                "commercial_policy.garantia_anos."
            ),
        ),
        "mensaje_familia": claim(),
    }


def build_construction():
    return {
        "cuerpo_material": field(),
        "difusor_material": field(),
        "chip_led": {
            "marca": field(),
            "modelo": field(),
        },
        "driver": {
            "marcas_compatibles": field(valor=[]),
            "control": field(),
            "proteccion_sobretension_kV": field(),
            "factor_potencia_min": field(),
            "thd_max_pct": field(),
        },
        "ip_rating": field(),
        "ik_rating": field(),
        "rango_temp_operacion_C": field(valor=[None, None]),
        "montaje": {
            "tipo": field(valor=[]),
            "diametro_mm": field(),
            "inclinacion_grados": field(valor=[None, None]),
        },
        "acabado": field(),
        "vida_util": {
            "horas": field(),
            "criterio": field(extra={"enum_esperado": ["L50", "L70", "L80", "L90"]}),
            "temperatura_ref_C": field(),
        },
    }


def build_brand_info():
    return {
        "nombre": field(
            valor="eLIGHTS",
            estado="resolved",
            auth_rule="datos_corporativos",
            conf="high",
        ),
        "pais": "Chile",
        "trayectoria_anos": field(
            valor=8,
            estado="resolved",
            auth_rule="manual_override",
            winning="md_001_trayectoria_8_anos",
            conf="high",
            criterio=(
                "Decision humana md_001_trayectoria_8_anos reemplaza claim "
                "historico de 10 anos."
            ),
        ),
        "contacto": {
            "email": field(
                valor="ventas@elights.cl",
                estado="resolved",
                auth_rule="datos_corporativos",
                conf="high",
            ),
            "whatsapp": field(
                valor="+56 9 9127 3128",
                estado="resolved",
                auth_rule="datos_corporativos",
                conf="high",
            ),
            "web": field(
                valor="www.elights.cl",
                estado="resolved",
                auth_rule="datos_corporativos",
                conf="high",
            ),
        },
    }


def build_commercial_policy():
    return {
        "garantia_anos": field(
            valor=5,
            estado="resolved",
            auth_rule="manual_override",
            winning="md_F5_garantia_bestled",
            conf="high",
            criterio=(
                "Decision humana md_F5_garantia_bestled. Fuentes tecnicas "
                "(base_data + PDFs v4) coinciden; business.ts placeholder "
                "descartado."
            ),
        ),
        "aplicable_a_toda_la_familia": {
            "valor_canonical": None,
            "nota": (
                "La garantia es transversal a toda la familia o puede variar "
                "por modelo? Decision pendiente."
            ),
        },
        "despacho_propio_horas_rm": 48,
        "despacho_carrier_horas": 48,
        "zona_cobertura": "Region Metropolitana (propio) · todo Chile (carrier)",
    }


def build_product_family():
    return {
        "descripcion_corta": field(),
        "aplicaciones": field(valor=[]),
        "rango_potencias_W": [40, 60, 90, 120, 150, 200, 250],
        "cct_disponibles_K": [2700, 4000, 6000],
        "fotometria_diferenciada_por_cct": False,
        "cri_min_publicable": field(),
    }


def build_template_readiness():
    return {
        "v4_tecnica": {"status": None, "motivos": []},
        "v5_premium": {"status": None, "motivos": []},
        "publicacion_web": {"status": None, "motivos": []},
        "_comentario": (
            "Readiness a nivel familia. Micro-fase 2a solo esqueleto; status "
            "se recalcula al poblar modelos 2b-2e."
        ),
    }


def build_unidades():
    return {
        "_comentario": (
            "Diccionario de unidades por campo numerico. Aplicar en render, "
            "nunca en canonical."
        ),
        "flujo_lumenes": "lm",
        "eficacia_lm_W": "lm/W",
        "intensidad_max_cd": "cd",
        "potencia_W": "W",
        "peso_kg": "kg",
        "dimensiones_mm": "mm",
        "horas": "h",
        "temperatura_C": "C",
        "proteccion_sobretension_kV": "kV",
        "thd_max_pct": "%",
        "factor_potencia_min": "ratio (0-1)",
        "cri_medido": "Ra (adimensional)",
        "sdcm": "adimensional (entero)",
        "cct_nominal_K": "K",
    }


def build_aliases():
    return {
        "familia": ["BESTLED", "Bestled", "BEST-LED"],
        "modelos": {
            "40": [],
            "60": [],
            "90": [],
            "120": [],
            "150": [],
            "200": [],
            "250": [],
        },
        "skus": {},
    }


def main():
    phase1 = load_phase1()
    sha = git_sha()

    canonical = {
        "$schema": "https://elights.cl/schemas/ficha-tecnica-v2_1_2.json",
        "schema_version": "2.1.2",
        "familia": "BESTLED",
        "familia_slug": "bestled",
        "categoria": "Alumbrado Publico · Vial",
        "metadata": {
            "consolidated_at": NOW,
            "consolidated_by": "Claude Code",
            "git_commit": sha,
            "review_status": "draft",
            "reviewed_by": None,
            "review_date": None,
            "approval_status": "unapproved",
            "approved_for_templates": False,
            "micro_phase": "2a_skeleton",
            "phase1_source_file": PHASE1_PATH,
        },
        "template_readiness_global": build_template_readiness(),
        "sources_consulted": build_sources(phase1),
        "brand_info": build_brand_info(),
        "commercial_policy": build_commercial_policy(),
        "product_family": build_product_family(),
        "construction": build_construction(),
        "modelos": {},
        "claims_publicables": build_claims_publicables(),
        "aliases": build_aliases(),
        "unidades": build_unidades(),
        "conflictos_detectados": build_conflictos_preresueltos(),
        "brechas": [],
        "manual_decisions": build_manual_decisions(),
        "diff_con_v5_mockup": {
            "status": "not_consulted",
            "mockup_source": None,
            "mockup_date": None,
            "generated_by": None,
            "campos_inventados_por_claude_web": [],
        },
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(canonical, f, indent=2, ensure_ascii=False)

    size = len(json.dumps(canonical, ensure_ascii=False))
    print(f"Wrote canonical skeleton to {OUTPUT_PATH}")
    print(f"Size: {size:,} chars")
    print(f"Top-level keys: {list(canonical.keys())}")


if __name__ == "__main__":
    main()
