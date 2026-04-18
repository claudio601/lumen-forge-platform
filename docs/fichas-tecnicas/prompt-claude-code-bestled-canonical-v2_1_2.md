# Prompt para Claude Code · Consolidación BESTLED Canonical v2.1.2

**Versión:** 2.1.2 (aprobación final tras cuarta revisión de ChatGPT)
**Fecha:** 2026-04-17
**Autor:** Claudio Cortés · eLIGHTS
**Revisión:** ChatGPT (4 rondas · veredicto: ejecutable)
**Target:** Claude Code en Codespace del repo `lumen-forge-platform`

**Cambios v2.1.1 → v2.1.2:**
- Corrección de `v2.1.0` → `v2.1.2` en §12
- Aclaración formal de `commercial_policy_repo` en matriz y fuentes
- Criterios concretos de `template_readiness` (ready / partial / blocked)

**Cambios v2.1 → v2.1.1:**
- R11: regla de herencia modelo/familia
- R12: regla de expansión de placeholders `"..."`
- R13: reglas operativas de `aliases`
- §5.1: criterios explícitos de `confidence`
- §5.2: aclaración sobre `enum_esperado` vs enum controlado
- §6.1: `template_readiness` agregado a metadata top-level y por modelo
- §3 Regla D: claims_publicables simplificado formalmente

---

## Contexto

La ficha técnica v5 editorial premium de BESTLED 60W detectó ruptura de fuente de verdad: datos inconsistentes entre la v4 del pipeline, la ficha comercial publicada, Jumpseller y los supuestos que Claude Web hizo en la v5 mockup. Antes de parametrizar las 7 fichas de la familia, necesitamos **una sola verdad por campo, con trazabilidad, política de resolución explícita y sin espacio para que Claude Code improvise lógica de consolidación**.

---

## Objetivo

Consolidar todos los datos técnicos de la familia BESTLED (40, 60, 90, 120, 150, 200, 250 W) con sus variantes de CCT (2.700 / 4.000 / 6.000 K) en:

1. **`docs/fichas-tecnicas/bestled-canonical.json`** — Fuente de verdad machine-readable
2. **`docs/fichas-tecnicas/bestled-datos-maestros.md`** — Reporte legible para auditoría humana

---

## Reglas duras (leer antes de empezar · no ejecutar sin leer)

### R1 · Prohibido inventar
Si un campo no está en ninguna fuente autoritativa → `valor_canonical: null` + entrada en `brechas` con `severity` y `accion_requerida`. **No inferir, no adivinar, no completar con valores "razonables".**

### R2 · Números como números
El JSON canonical guarda `9167`, no `"9.167 lm"`. La norma editorial (punto miles, coma decimal, espacio antes de unidad) se aplica **solo en render**, nunca en el canonical. Excepción: strings que son identificadores (SKUs, códigos modelo).

### R3 · Todo conflicto se registra con severidad
No silenciar diferencias, aunque sean 30 lm. Clasificar según tabla de severidad (sección §4).

### R4 · No modificar fuentes
No alterar `.ies`, JSONs del repo, PDFs ni nada existente. **Solo leer y consolidar.**

### R5 · Decisiones humanas previas van a `manual_decisions`
No hardcodear en campos. Ejemplo: "trayectoria 8 años" va a `manual_decisions`, no directo en `brand_info.trayectoria_anos`.

### R6 · Regla de acceso web
- **Jumpseller:** no intentar acceso en vivo bajo ninguna circunstancia. Solo dumps locales presentes en el repo. Si no hay dump → `source_status: not_consulted`.
- **elights.cl:** si hay acceso HTTP permitido desde Codespace → scraper, registrar `source_url` + `fetched_at`. Si no hay acceso → `source_status: not_consulted`. No inventar.

### R7 · Scrape web NO aplica a specs técnicas
El scrape de elights.cl solo puede poblar campos de estas categorías:
- `claims_publicables.*`
- `product_family.descripcion_corta`
- `modelos.<W>.nombre_comercial`
- `modelos.<W>.slug`
- `modelos.<W>.estado_comercial`
- `commercial_policy.garantia_display`
- `brand_info.contacto.*`

El scrape **nunca** es fuente autoritativa para: peso, dimensiones, flujo, intensidad, chip, driver, THD, SPD, IP, IK, montaje, temperatura de operación, CRI, SDCM, BUG, rango de operación. Para esos campos, el scrape como máximo entra como fuente de menor autoridad en la matriz.

### R8 · Fallback de autoridad
Si la fuente de máxima autoridad para un campo **fue consultada pero no contiene valor utilizable** (vacío, NaN, malformado, ausente), se recurre a la siguiente fuente de la matriz y se registra explícitamente en `criterio_resolucion` con formato: `"Fuente primaria [X] consultada sin valor utilizable → fallback a [Y]"`.

### R9 · Diff con mockup NO es bloqueante
Si el PDF mockup v5 no está accesible en el repo, registrar `diff_con_v5_mockup.status: not_consulted` y continuar con la consolidación canonical. La ausencia del mockup **no debe abortar la tarea**.

### R10 · Consistencia estructural
Ver §3 (Reglas estructurales). Todo campo auditable es objeto con estructura estándar. Todo valor libre que pueda normalizar va como enum controlado (§5).

### R11 · Herencia modelo/familia
Campos con sufijo `_override` a nivel de modelo (ej: `modelos.<W>.garantia_override_anos`) siguen esta regla:
- Si `valor_canonical: null` → el modelo **hereda** el valor canonical transversal correspondiente (`commercial_policy.garantia_anos` en el ejemplo)
- Si `valor_canonical: <valor>` → ese valor **sustituye** al transversal solo para ese modelo
- **No duplicar automáticamente** el valor heredado en el nodo del modelo. La herencia se resuelve en render, no en canonical.
- En el MD de auditoría, documentar explícitamente qué modelos tienen override activo.

Aplica a: `garantia_override_anos`, claims publicables a nivel modelo (si los hubiera en futuras iteraciones), atributos de construcción que pudieran variar por modelo.

### R12 · Expansión de placeholders
Todo bloque indicado como `"...misma estructura..."` o `"..."` en el schema de ejemplo (§6) debe **expandirse replicando exactamente** la estructura completa del bloque de referencia, sin omitir campos ni agregar otros nuevos. Ejemplo: `modelos.40` debe tener exactamente la misma estructura que `modelos.60`, con sus 3 variantes CCT completas, todos los campos de `assets`, `embalaje`, `dimensiones_mm`, etc.

Si algún campo específico no aplica al modelo (ej: una variante CCT que no existe comercialmente para 40 W) → mantener la estructura con `valor_canonical: null` + entrada en `brechas` con `severity: minor` explicando la ausencia.

### R13 · Aliases operativos
Antes de consolidar datos de cualquier fuente, **normalizar coincidencias** de familia / modelo / SKU usando el bloque `aliases` del schema. Flujo:
1. Al leer cada fuente, extraer identificadores (nombre producto, código, SKU)
2. Matchear contra `aliases.familia`, `aliases.modelos.<W>`, `aliases.skus`
3. Si el identificador coincide → consolidar bajo el modelo correspondiente
4. Si aparece un alias **nuevo no registrado** → agregarlo al canonical + documentarlo en `brechas` con `severity: minor` y acción `revisar_alias_nuevo`
5. Registrar en `sources_consulted[].aliases_matched` qué aliases activó cada fuente

---

## §1 · Matriz de autoridad por tipo de campo

**No existe una jerarquía única válida.** Resolver conflictos según esta matriz:

| Familia de campos | Orden de autoridad (mayor → menor) |
|---|---|
| **Fotometría** (flujo, intensidad, distribución, ángulos apertura, curvas C0/C90, BUG) | `ies_raw` → `ies_json` → `pipeline_json` → `commercial_web` → `pdf_historical` |
| **Especificaciones eléctricas** (FP, THD, tensión, control, SPD) | `pipeline_json` → `commercial_web` → `supplier_catalog` → `pdf_historical` |
| **Especificaciones mecánicas** (dimensiones, peso, IP, IK, montaje, material, acabado) | `pipeline_json` → `commercial_web` → `supplier_catalog` |
| **Chip LED / driver** | `supplier_catalog` → `pipeline_json` → `commercial_web` |
| **Claims comerciales publicables** | `manual_override` → `commercial_policy_repo` → `commercial_web` → `brand_config` |
| **Metadata de venta** (SKU, precio, slug, visibilidad) | `jumpseller_dump` → `commercial_web` |
| **Datos corporativos transversales** (trayectoria, certificaciones empresa, contacto) | `manual_override` → `brand_config` → `commercial_web` |
| **Certificaciones del producto** (SEC, DS-1, PE N° 5/07) | `certificate_scan` → `commercial_web` → `supplier_catalog` |

Si un conflicto no cae limpiamente en ninguna categoría → `estado_resolucion: pending_human`, **NO resolver automáticamente**.

---

## §2 · Política de resolución automática vs pending_human

### Resolver automáticamente SÍ cuando:
- Conflicto clasificado como `minor` (§4)
- Misma unidad, mismo significado, diferencia solo de formato
- Una fuente superior de la matriz tiene valor válido y las inferiores son menores autoridad
- Fallback de autoridad según R8 (fuente superior sin valor → siguiente fuente)

### Resolver automáticamente NO cuando:
- Conflicto clasificado como `critical` (§4)
- Conflicto `major` sobre: seguridad, certificación, garantía, IP/IK, montaje, peso, SKU
- Diferencia entre marcas de chip o driver
- Diferencia entre CCT declarados en la familia
- Diferencia entre modelos / SKUs / códigos

### Marcar `pending_human` cuando:
- El conflicto no cae limpio en ninguna categoría de la matriz
- Dos fuentes de autoridad equivalente discrepan
- La fuente superior parece incompleta o desactualizada y la inferior parece más reciente (comparar `fecha_fuente`)
- Se detecta ambigüedad en la interpretación de un valor

---

## §3 · Reglas estructurales del schema

### Regla A · Estructura completa obligatoria
**Todo campo auditable o potencialmente conflictivo** debe usar esta estructura:

```json
{
  "valor_canonical": <valor o null>,
  "estado_resolucion": "<enum §5>",
  "criterio_resolucion": "<string o null>",
  "authority_rule_applied": "<enum §5>",
  "winning_source_id": "<string o null>",
  "confidence": "<enum §5>",
  "fuentes": [
    {
      "source_id": "<id de sources_consulted>",
      "valor_bruto": <valor tal cual>,
      "unidad_bruta": "<string o null>",
      "extracted_at": "<ISO 8601>",
      "fecha_fuente": "<ISO 8601 o null>",
      "notes": "<string o null>"
    }
  ]
}
```

### Regla B · Campos planos permitidos solo para:
- Constantes del schema (ej: `schema_version`, `familia_slug`)
- Listas cerradas de configuración (ej: `rango_potencias_W: [40, 60, ...]`)
- Metadata de proceso no conflictiva (ej: `consolidated_at`, `git_commit`)
- Valores del enum aplicado (ej: `estado_resolucion: "resolved"`)

### Regla C · Consistencia obligatoria
Los siguientes campos que en versiones anteriores del schema fueron planos, **también deben migrar a objeto completo** aunque no tengan conflicto conocido hoy:
- `brand_info.nombre`
- `brand_info.contacto.email`
- `brand_info.contacto.whatsapp`
- `brand_info.contacto.web`
- `product_family.descripcion_corta`
- `product_family.aplicaciones`

### Regla D · Excepciones editoriales (claims_publicables)
`claims_publicables` usa **estructura editorial simplificada** y está formalmente exento de la estructura estándar completa de Regla A. La razón: son decisiones editoriales/comerciales, no mediciones técnicas en conflicto entre fuentes.

Estructura mínima de cada claim:
```json
{
  "valor_canonical": <string | array | null>,
  "ejemplo_render_permitido": "<string ilustrativo o null>",
  "nota": "<string con contexto o null>"
}
```

**Cuándo migrar a estructura completa**: solo si se detecta conflicto real entre fuentes sobre qué claim publicar. En ese caso, agregar `winning_source_id`, `authority_rule_applied`, `confidence`, `fuentes`, `estado_resolucion`.

### Regla E · Campos verdaderamente constantes
Pueden quedar **planos sin envoltura** porque nunca generarán conflicto:
- `schema_version`
- `familia`
- `familia_slug`
- `categoria`
- `brand_info.pais` (constante "Chile" para eLIGHTS)
- `product_family.rango_potencias_W` (lista cerrada por arquitectura de catálogo)
- `product_family.cct_disponibles_K` (lista cerrada)
- Metadata de proceso en `metadata.*`

---

## §4 · Severidad de conflictos

| Severity | Criterio | Ejemplos | Resolución |
|---|---|---|---|
| **critical** | Afecta claims legales, comerciales o de seguridad | garantía 1 vs 5 años, IP65 vs IP66, certificación SEC ausente/presente, tensión 220 vs 110V | `pending_human` obligatorio · `bloquea_publicacion: true` |
| **major** | Afecta specs relevantes para el cliente | flujo 9167 vs 9200 lm (≥1%), chip LED distinto marca, peso >10% diff, Ø montaje distinto | `pending_human` si es sobre seguridad/certificación/montaje/peso/SKU · automático solo con matriz clara |
| **minor** | Diferencia de formato o precisión sub-significativa | 4000 K vs 4.000 K, 152,7 vs 152,75 lm/W, espaciado distinto, abreviaturas | Auto-resuelto por matriz |

Agregar al campo `conflictos_detectados[]`:
- `severity`
- `bloquea_publicacion: boolean`
- `bloquea_render_premium: boolean`

---

## §5 · Enums controlados (valores exclusivos, no inventar variantes)

```yaml
estado_resolucion:
  - resolved
  - pending_human
  - missing
  - disputed

review_status:
  - draft
  - in_review
  - reviewed

approval_status:
  - unapproved
  - approved
  - rejected

severity:
  - critical
  - major
  - minor

confidence:
  - high
  - medium
  - low

source_type:
  - ies_raw
  - ies_json
  - pipeline_json
  - commercial_web
  - jumpseller_dump
  - pdf_historical
  - supplier_catalog
  - certificate_scan
  - brand_config
  - manual_override

source_status:
  - consulted
  - not_consulted
  - not_available
  - error

authority_rule_applied:
  - fotometria
  - especificaciones_electricas
  - especificaciones_mecanicas
  - chip_driver
  - claims_comerciales
  - metadata_venta
  - datos_corporativos
  - certificaciones_producto
  - manual_override

override_type:
  - corporate_fact
  - commercial_decision
  - brand_claim
  - technical_clarification
  - error_correction
```

**Si Claude Code detecta un caso que no cae en ningún enum → usar el valor más cercano + agregar entrada en `brechas` pidiendo extensión del enum.**

---

## §5.1 · Criterios de asignación de `confidence`

Aplicar estas reglas al asignar `confidence` a cada campo resuelto:

| Valor | Criterio |
|---|---|
| **high** | Fuente de máxima autoridad de la matriz consultada, con valor directo, sin conflicto detectado con fuentes inferiores |
| **medium** | Fallback legítimo a fuente secundaria (R8), o resolución con conflicto menor auto-resuelto, o fuente máxima con valor pero con advertencia de consistencia |
| **low** | Conflicto abierto marcado como `pending_human`, fuente incompleta con valor inferido de otra categoría, valor sin validación cruzada posible, o dato proveniente de fuente `pdf_historical` sin refrendo actual |

**Campos con `valor_canonical: null`** → siempre `confidence: low` (independiente de que tengan `estado_resolucion: missing` o `pending_human`).

---

## §5.2 · `enum_esperado` vs enum controlado

Algunos campos en el schema llevan `enum_esperado` inline como documentación orientativa (ej: `vida_util.criterio.enum_esperado: ["L50", "L70", "L80", "L90"]`, `distribucion.enum_esperado: ["Tipo I", ..., "Tipo V"]`).

**Regla operativa:**
- `enum_esperado` es **documentación orientativa**, no es un enum controlado formal
- El valor final debe seguir las reglas del **enum controlado** (§5) si aplica al campo
- Si no existe enum controlado pero sí `enum_esperado`, usar el `enum_esperado` como guía y **normalizar el valor canonical** a uno de sus valores si es posible
- Si aparece un valor de la fuente que **no está en `enum_esperado`** → documentar en `brechas` con `severity: minor` y acción `revisar_valor_fuera_de_enum_esperado`
- No reemplazar silenciosamente el valor de la fuente: siempre dejar traza del valor bruto en `fuentes[].valor_bruto`

---

## §6 · Schema del JSON canonical

```json
{
  "$schema": "https://elights.cl/schemas/ficha-tecnica-v2_1_2.json",
  "schema_version": "2.1.2",
  "familia": "BESTLED",
  "familia_slug": "bestled",
  "categoria": "Alumbrado Público · Vial",

  "metadata": {
    "consolidated_at": "<ISO 8601>",
    "consolidated_by": "Claude Code",
    "git_commit": "<sha>",
    "review_status": "draft",
    "reviewed_by": null,
    "review_date": null,
    "approval_status": "unapproved",
    "approved_for_templates": false
  },

  "template_readiness_global": {
    "v4_tecnica": {
      "status": "ready | partial | blocked",
      "motivos": []
    },
    "v5_premium": {
      "status": "ready | partial | blocked",
      "motivos": []
    },
    "publicacion_web": {
      "status": "ready | partial | blocked",
      "motivos": []
    },
    "_comentario": "Readiness a nivel familia. Se considera 'ready' si todos los modelos tienen al menos variante 4000K con flujo_lumenes resuelto, claims_publicables poblados, y 0 conflictos critical sin resolver. 'partial' si hay algunos modelos ready y otros no. 'blocked' si hay conflictos critical globales sin resolución."
  },

  "sources_consulted": [
    {
      "source_id": "ies_60w_4000k",
      "source_type": "ies_raw",
      "source_path": "docs/fotometrias/bestled/BESTLED_60W_4000K.ies",
      "source_status": "consulted",
      "extracted_at": "<ISO 8601>",
      "extracted_by": "Claude Code",
      "fecha_fuente": "2024-03-08",
      "laboratorio": "VOLNIC GON-2000",
      "aliases_matched": ["BESTLED", "BESTLED-060-4000K"],
      "notes": null
    },
    {
      "source_id": "jumpseller_dump",
      "source_type": "jumpseller_dump",
      "source_path": null,
      "source_status": "not_consulted",
      "aliases_matched": [],
      "notes": "No se encontró dump local en repo. Regla R6: no acceso en vivo."
    },
    {
      "source_id": "elights_web",
      "source_type": "commercial_web",
      "source_url": "https://elights.cl/...",
      "source_status": "<consulted | not_consulted>",
      "fetched_at": "<ISO 8601 o null>",
      "aliases_matched": [],
      "notes": null
    }
  ],

  "brand_info": {
    "nombre": { "valor_canonical": "eLIGHTS", "estado_resolucion": "resolved", "confidence": "high", "fuentes": [] },
    "pais": { "valor_canonical": "Chile", "estado_resolucion": "resolved", "confidence": "high", "fuentes": [] },
    "contacto": {
      "email": { "valor_canonical": "ventas@elights.cl", "estado_resolucion": "resolved", "confidence": "high", "fuentes": [] },
      "whatsapp": { "valor_canonical": "+56 9 9127 3128", "estado_resolucion": "resolved", "confidence": "high", "fuentes": [] },
      "web": { "valor_canonical": "www.elights.cl", "estado_resolucion": "resolved", "confidence": "high", "fuentes": [] }
    }
  },

  "commercial_policy": {
    "garantia_anos": {
      "valor_canonical": null,
      "estado_resolucion": "pending_human",
      "authority_rule_applied": "claims_comerciales",
      "winning_source_id": null,
      "confidence": "low",
      "fuentes": []
    },
    "aplicable_a_toda_la_familia": {
      "valor_canonical": null,
      "nota": "¿La garantía es transversal a toda la familia o puede variar por modelo? Decisión pendiente."
    },
    "despacho_propio_horas_rm": 48,
    "despacho_carrier_horas": 48,
    "zona_cobertura": "Región Metropolitana (propio) · todo Chile (carrier)"
  },

  "product_family": {
    "descripcion_corta": { "valor_canonical": null, "fuentes": [] },
    "aplicaciones": { "valor_canonical": [], "fuentes": [] },
    "rango_potencias_W": [40, 60, 90, 120, 150, 200, 250],
    "cct_disponibles_K": [2700, 4000, 6000],
    "cri_min_publicable": { "valor_canonical": null, "fuentes": [] }
  },

  "construction": {
    "cuerpo_material": { "valor_canonical": null, "fuentes": [] },
    "difusor_material": { "valor_canonical": null, "fuentes": [] },
    "chip_led": {
      "marca": { "valor_canonical": null, "fuentes": [] },
      "modelo": { "valor_canonical": null, "fuentes": [] }
    },
    "driver": {
      "marcas_compatibles": { "valor_canonical": [], "fuentes": [] },
      "control": { "valor_canonical": null, "fuentes": [] },
      "proteccion_sobretension_kV": { "valor_canonical": null, "fuentes": [] },
      "factor_potencia_min": { "valor_canonical": null, "fuentes": [] },
      "thd_max_pct": { "valor_canonical": null, "fuentes": [] }
    },
    "ip_rating": { "valor_canonical": null, "fuentes": [] },
    "ik_rating": { "valor_canonical": null, "fuentes": [] },
    "rango_temp_operacion_C": { "valor_canonical": [null, null], "fuentes": [] },
    "montaje": {
      "tipo": { "valor_canonical": [], "fuentes": [] },
      "diametro_mm": { "valor_canonical": null, "fuentes": [] },
      "inclinacion_grados": { "valor_canonical": [null, null], "fuentes": [] }
    },
    "acabado": { "valor_canonical": null, "fuentes": [] },
    "vida_util": {
      "horas": { "valor_canonical": null, "fuentes": [] },
      "criterio": { "valor_canonical": null, "fuentes": [], "enum_esperado": ["L50", "L70", "L80", "L90"] },
      "temperatura_ref_C": { "valor_canonical": null, "fuentes": [] }
    }
  },

  "modelos": {
    "60": {
      "codigo_modelo": { "valor_canonical": null, "fuentes": [] },
      "nombre_comercial": { "valor_canonical": null, "fuentes": [] },
      "slug": { "valor_canonical": null, "fuentes": [] },
      "potencia_W": 60,
      "estado_comercial": { "valor_canonical": null, "fuentes": [], "enum_esperado": ["activo", "descatalogado", "pre_lanzamiento"] },
      "publicable": { "valor_canonical": null, "fuentes": [] },
      "visible_en_web": { "valor_canonical": null, "fuentes": [] },

      "dimensiones_mm": {
        "largo": { "valor_canonical": null, "fuentes": [] },
        "ancho": { "valor_canonical": null, "fuentes": [] },
        "alto": { "valor_canonical": null, "fuentes": [] }
      },
      "peso_kg": { "valor_canonical": null, "fuentes": [] },

      "embalaje": {
        "unidades_por_caja": { "valor_canonical": null, "fuentes": [] },
        "dimensiones_caja_mm": {
          "largo": { "valor_canonical": null, "fuentes": [] },
          "ancho": { "valor_canonical": null, "fuentes": [] },
          "alto": { "valor_canonical": null, "fuentes": [] }
        },
        "peso_bruto_kg": { "valor_canonical": null, "fuentes": [] }
      },

      "garantia_override_anos": {
        "valor_canonical": null,
        "nota": "Solo poblar si este modelo específico tiene garantía distinta a commercial_policy.garantia_anos. Si es igual a transversal, dejar null."
      },

      "variantes_cct": {
        "2700": {
          "variant_id": "BESTLED-060-2700K",
          "cct_nominal_K": 2700,
          "cct_label": "Cálido",
          "sku": { "valor_canonical": null, "fuentes": [] },

          "ies_file": null,
          "ies_filename_exacto": null,
          "ies_hash_sha256": null,
          "ies_fecha_medicion": null,
          "laboratorio": null,
          "lab_test_id": null,
          "measurement_context": null,

          "flujo_lumenes": { "valor_canonical": null, "fuentes": [] },
          "eficacia_lm_W": { "valor_canonical": null, "fuentes": [] },
          "intensidad_max_cd": { "valor_canonical": null, "fuentes": [] },
          "distribucion": {
            "valor_canonical": null,
            "fuentes": [],
            "enum_esperado": ["Tipo I", "Tipo II", "Tipo III", "Tipo IV", "Tipo V"]
          },
          "angulo_apertura_50pct": {
            "longitudinal_grados": { "valor_canonical": null, "fuentes": [] },
            "transversal_grados": { "valor_canonical": null, "fuentes": [] }
          },
          "cri_medido": { "valor_canonical": null, "fuentes": [] },
          "sdcm": { "valor_canonical": null, "fuentes": [] },
          "bug_rating": {
            "B": { "valor_canonical": null, "fuentes": [] },
            "U": { "valor_canonical": null, "fuentes": [] },
            "G": { "valor_canonical": null, "fuentes": [] }
          }
        },
        "4000": { "...replicar estructura completa de variantes_cct.2700 según R12, ajustando variant_id='BESTLED-060-4000K', cct_nominal_K=4000, cct_label='Neutro'..." },
        "6000": { "...replicar estructura completa de variantes_cct.2700 según R12, ajustando variant_id='BESTLED-060-6000K', cct_nominal_K=6000, cct_label='Frío'..." }
      },

      "assets": {
        "product_photos": [],
        "hero_image": null,
        "dimension_drawing": null,
        "polar_diagram_svg": null,
        "polar_diagram_png": null,
        "component_callout_image": null,
        "datasheet_pdf": null,
        "certificates_files": []
      },

      "template_readiness": {
        "v4_tecnica": {
          "status": "ready | partial | blocked",
          "motivos": []
        },
        "v5_premium": {
          "status": "ready | partial | blocked",
          "motivos": []
        },
        "publicacion_web": {
          "status": "ready | partial | blocked",
          "motivos": []
        }
      }
    },
    "40": { "...replicar estructura completa de modelos.60 según R12, ajustando potencia_W y variant_ids..." },
    "90": { "...replicar estructura completa de modelos.60 según R12..." },
    "120": { "...replicar estructura completa de modelos.60 según R12..." },
    "150": { "...replicar estructura completa de modelos.60 según R12..." },
    "200": { "...replicar estructura completa de modelos.60 según R12..." },
    "250": { "...replicar estructura completa de modelos.60 según R12..." }
  },

  "claims_publicables": {
    "_comentario_regla_d": "Estructura editorial simplificada según §3 Regla D. Solo migrar a estructura completa si se detecta conflicto real entre fuentes.",

    "headline_producto": {
      "valor_canonical": null,
      "ejemplo_render_permitido": "Luminaria vial LED de alta eficacia",
      "nota": "Título principal de ficha premium"
    },
    "subheadline_producto": {
      "valor_canonical": null,
      "ejemplo_render_permitido": null,
      "nota": "Bajada editorial 1-2 líneas"
    },
    "beneficios_clave": {
      "valor_canonical": [],
      "ejemplo_render_permitido": "['IP66 sellado', 'Driver dimeable 0-10V', '50.000 h L70', 'SEC · DS-1']",
      "nota": "Array de 4-6 claims cortos para página de beneficios"
    },
    "claim_vida_util_principal": {
      "valor_canonical": null,
      "ejemplo_render_permitido": "50.000 h · L70 a 25 °C",
      "nota": "Qué vida útil mostrar en fichas. Si existen dos versiones históricas (50.000 h L70 y 100.000 h L50), elegir una."
    },
    "claim_vida_util_secundaria": {
      "valor_canonical": null,
      "ejemplo_render_permitido": null,
      "nota": "Solo si se decide mostrar ambas vidas útiles"
    },
    "claim_certificacion_principal": {
      "valor_canonical": null,
      "ejemplo_render_permitido": "SEC · DS-1",
      "nota": null
    },
    "claim_montaje_principal": {
      "valor_canonical": null,
      "ejemplo_render_permitido": "Poste o gancho Ø 60 mm",
      "nota": null
    },
    "claim_distribucion_principal": {
      "valor_canonical": null,
      "ejemplo_render_permitido": "Vial Tipo II · ANSI/IES",
      "nota": null
    },
    "claim_aplicacion_principal": {
      "valor_canonical": null,
      "ejemplo_render_permitido": "Alumbrado público vial y peatonal",
      "nota": null
    },
    "claim_driver": {
      "valor_canonical": null,
      "ejemplo_render_permitido": "Driver dimeable 0-10 V · FP > 0,93",
      "nota": null
    },
    "claim_fotometria": {
      "valor_canonical": null,
      "ejemplo_render_permitido": null,
      "nota": "Claim sintético de fotometría"
    },
    "garantia_display": {
      "valor_canonical": null,
      "ejemplo_render_permitido": "5 años",
      "nota": "Formato publicable de garantía. Debe coincidir con commercial_policy.garantia_anos."
    },
    "mensaje_familia": {
      "valor_canonical": null,
      "ejemplo_render_permitido": null,
      "nota": null
    }
  },

  "aliases": {
    "familia": ["BESTLED", "Bestled", "BEST-LED"],
    "modelos": {
      "40": [],
      "60": [],
      "90": [],
      "120": [],
      "150": [],
      "200": [],
      "250": []
    },
    "skus": {}
  },

  "unidades": {
    "_comentario": "Diccionario de unidades por campo numérico. Aplicar en render, nunca en canonical.",
    "flujo_lumenes": "lm",
    "eficacia_lm_W": "lm/W",
    "intensidad_max_cd": "cd",
    "potencia_W": "W",
    "peso_kg": "kg",
    "dimensiones_mm": "mm",
    "horas": "h",
    "temperatura_C": "°C",
    "proteccion_sobretension_kV": "kV",
    "thd_max_pct": "%",
    "factor_potencia_min": "ratio (0-1)",
    "cri_medido": "Ra (adimensional)",
    "sdcm": "adimensional (entero)",
    "cct_nominal_K": "K"
  },

  "conflictos_detectados": [
    {
      "campo_path": "commercial_policy.garantia_anos",
      "severity": "critical",
      "bloquea_publicacion": true,
      "bloquea_render_premium": true,
      "valores_encontrados": [
        {
          "source_id": "elights_web",
          "valor": 5,
          "fecha_fuente": "<ISO 8601>"
        },
        {
          "source_id": "v5_mockup_claude_web",
          "valor": 1,
          "fecha_fuente": "2026-04-17",
          "estado": "dato_inventado_por_claude_web"
        }
      ],
      "authority_rule_applied": "claims_comerciales",
      "resolucion_propuesta": null,
      "requiere_decision_humana": true,
      "criterio_recomendado": "Matriz de autoridad: claims_comerciales → commercial_web prevalece. Confirmar con Claudio si coincide con política comercial real."
    }
  ],

  "brechas": [
    {
      "campo_path": "construction.chip_led.modelo",
      "severity": "major",
      "bloquea_publicacion": true,
      "descripcion": "No encontrado en ninguna fuente autoritativa",
      "accion_requerida": "Confirmar con proveedor o catálogo físico de fábrica"
    }
  ],

  "manual_decisions": [
    {
      "decision_id": "md_001",
      "campo_path": "brand_info.trayectoria_anos",
      "decision_valor": 8,
      "decidido_por": "Claudio",
      "fecha": "2026-04-17",
      "motivo": "Corrección histórica registrada en memoria del proyecto. Reemplaza claim anterior de 10 años.",
      "override_type": "corporate_fact"
    }
  ],

  "diff_con_v5_mockup": {
    "status": "not_consulted | consulted",
    "mockup_source": "docs/fichas-tecnicas/v5-mockup/FT-eLIGHTS-BESTLED-60W-v5-MOCKUP.pdf",
    "mockup_date": "2026-04-17",
    "generated_by": "Claude Web",
    "campos_inventados_por_claude_web": [
      {
        "ficha_path": "P3 tabla de especificaciones · fila 'Chip LED'",
        "campo_canonical_path": "construction.chip_led.modelo",
        "valor_mockup": "Luxeon 5050 · Lumileds",
        "valor_canonical": null,
        "origen_mockup": "inventado",
        "severity": "major",
        "accion_v5_1": "Reemplazar por valor canonical o marcar como 'pendiente confirmación proveedor'"
      }
    ]
  }
}
```

---

## §6.1 · Criterios de `template_readiness`

Cada modelo y el nivel global llevan evaluación de readiness para 3 escenarios de output. **No usar `partial` como cajón de sastre**: aplicar estos criterios objetivos.

### A nivel modelo

Para cada modelo (`modelos.<W>.template_readiness`), evaluar los 3 targets según:

#### `v4_tecnica` (ficha técnica estándar 3 páginas)

| Status | Criterio |
|---|---|
| **ready** | (1) al menos variante 4000K con `flujo_lumenes.valor_canonical != null` · (2) `construction.*` con IP, IK, driver control, montaje resueltos · (3) `dimensiones_mm` y `peso_kg` resueltos · (4) 0 conflictos `critical` sin resolver que afecten al modelo · (5) `assets.polar_diagram_svg != null` para al menos una variante |
| **partial** | Tiene fotometría + construction básica, pero falta al menos uno de: dimensiones exactas, assets de polar en todas las variantes, o tiene hasta 1 conflicto `major` sin resolver. La ficha v4 se puede generar con advertencias visibles. |
| **blocked** | Falta fotometría del modelo (cero variantes CCT con flujo resuelto), O tiene ≥1 conflicto `critical` sin resolver, O tiene brecha bloqueante en `construction.ip_rating` / `ik_rating` / `driver.control` |

#### `v5_premium` (ficha editorial 4-6 páginas)

| Status | Criterio |
|---|---|
| **ready** | Todos los criterios de v4_tecnica `ready` · más: (6) `claims_publicables.*` principales poblados (headline, subheadline, beneficios_clave, claim_vida_util_principal, claim_certificacion_principal) · (7) `assets.hero_image != null` o asset equivalente · (8) `assets.dimension_drawing != null` o `component_callout_image != null` |
| **partial** | Base técnica lista pero faltan claims publicables completos o assets premium (hero, drawing). La ficha v5 se puede generar con placeholders editoriales. |
| **blocked** | v4_tecnica es `blocked`, O `claims_publicables.headline_producto.valor_canonical == null` y `claim_vida_util_principal.valor_canonical == null` simultáneamente |

#### `publicacion_web` (listado en elights.cl)

| Status | Criterio |
|---|---|
| **ready** | `nombre_comercial`, `slug`, `sku` (al menos 1 variante), `estado_comercial = "activo"`, `publicable = true`, precio disponible en fuente comercial |
| **partial** | Datos comerciales básicos pero falta precio o SKU por variante completa |
| **blocked** | `estado_comercial = "descatalogado"` o `publicable = false`, O brecha crítica en metadata de venta |

### A nivel global (`template_readiness_global`)

Agregación de los readiness por modelo:

| Status | Criterio |
|---|---|
| **ready** | **Todos** los 7 modelos del rango tienen `ready` en ese target |
| **partial** | Al menos 1 modelo `ready` y al menos 1 modelo `partial` o `blocked` en ese target |
| **blocked** | **Todos** los modelos están `blocked` en ese target, O existe un conflicto `critical` global (ej: en `commercial_policy` o `construction` transversal) que afecta a todos los modelos |

En cada caso, poblar `motivos: []` con strings claros del tipo `"Modelo 40 blocked: falta fotometría"`, `"Modelo 250 partial: falta dimension_drawing"`. Un motivo por condición bloqueante o parcial.

---

## §7 · MD de auditoría (`bestled-datos-maestros.md`)

Contiene:

1. **Resumen ejecutivo** (2-3 párrafos):
   - N fuentes consultadas / N no consultadas (detalle con razón)
   - N campos consolidados exitosamente vs total
   - N conflictos por severidad (critical / major / minor)
   - N brechas que bloquean publicación
   - N decisiones manuales registradas
   - **Estado global de readiness** (v4_tecnica · v5_premium · publicacion_web)

2. **Tabla de claims transversales** con estado:
   - Campo · Valor canonical · Estado resolución · Confianza

3. **Tabla consolidada por modelo** (7 filas × columnas clave):
   - Potencia · Código · Flujo (4.000K) · Eficacia · Peso · Dimensiones · Estado comercial · **Readiness v4 · Readiness v5 · Readiness web**

4. **Conflictos ordenados por severidad** (critical primero)

5. **Brechas de información** ordenadas por severidad

6. **Diff con v5 mockup** (si `status: consulted`) — tabla con cada dato inventado, referencia cruzada con página y fila del mockup

7. **Ledger de decisiones manuales** con fecha, autor, motivo

8. **Reporte de aliases**: qué aliases matcheó cada fuente, nuevos aliases descubiertos

9. **Reporte de herencias activas**: qué modelos tienen override respecto a commercial_policy transversal

10. **Recomendaciones para v5.1** en base a hallazgos, priorizadas por impacto

---

## §8 · Fuentes específicas a consultar

### En el repo (obligatorio)

1. `docs/fotometrias/bestled/*.ies` — los 7 archivos. Parsear headers: `[TEST]`, `[MANUFAC]`, `[LUMCAT]`, `[LUMINAIRE]`, `[LAMPCAT]`, fecha, fabricante, ballast cat, lumens/lamp, input watts, cantidad de LEDs, intensity max, ángulos medidos. **Autoridad máxima para fotometría.**

2. `docs/fotometrias/bestled/*.json` — JSONs derivados del parseo con `parse_ies.py` si existen. Revisar coherencia contra el .ies crudo. Si discrepan, el .ies manda. Si no existen, parsear desde .ies crudo en memoria.

3. `scripts/fichas-tecnicas/bestled_base_data.json` — datos complementarios (construcción, driver, dimensiones). Autoridad alta para specs no fotométricas.

4. `docs/fichas-tecnicas/FT-eLIGHTS-BESTLED-60W-v4.pdf` — si existe. Extraer texto con `pdftotext`. Autoridad media (histórico).

5. Búsqueda amplia: `grep -riE "bestled|vial|APB|BEST-[0-9]" docs/ scripts/ config/ | head -100`

6. **`commercial_policy_repo`** — archivo de política comercial si existe. Buscar en este orden:
   - `config/commercial-policy.json`
   - `docs/politica-comercial.md`
   - `src/config/business.ts` (leer constantes de garantía, claims publicables, vida útil oficial si existen)
   - Si ninguno existe → `source_status: not_available`. **No sustituir por inferencias desde otros archivos.** No intentar reconstruir política comercial desde fichas v4, PDFs o scrapes de la web: eso pertenece a otras fuentes de la matriz. `commercial_policy_repo` representa solo la política comercial formal declarada en repo.

7. Si existe `docs/fichas-tecnicas/v5-mockup/FT-eLIGHTS-BESTLED-60W-v5-MOCKUP.pdf` (Claudio lo sube antes de ejecutar) → usar para `diff_con_v5_mockup`. Si no existe → `status: not_consulted` y continuar.

### Opcional (según acceso web)

8. `https://elights.cl/alumbrado-publico/bestled` (o URL equivalente). Si hay acceso HTTP desde Codespace → scraper, registrar `source_url` + `fetched_at`. Si no hay acceso o timeout → `source_status: not_consulted`.

### Explícitamente NO consultar

9. Jumpseller en vivo (R6): solo dumps locales si existen.

---

## §9 · Plan de ejecución

1. **Inventario**: `find docs/ scripts/ config/ -type f \( -name "*.ies" -o -iname "*bestled*" -o -iname "*base_data*" \)`
2. **Parse de .IES crudos** → extraer datos fotométricos + metadata + hash SHA-256 de cada archivo
3. **Lectura de JSON base pipeline**
4. **Extracción de texto del PDF v4 histórico** (si existe)
5. **Scraper de elights.cl** si R6 lo permite → registrar fecha + URL
6. **Chequeo de `commercial_policy_repo`** según §8.6
7. **Chequeo de PDF mockup v5** según §8.7
8. **Consolidación**: aplicar §1 (matriz) + §2 (resolución) + §3 (estructura) + §5 (enums) + R11 (herencia) + R13 (aliases)
9. **Detección de conflictos** con §4 (severidad)
10. **Diff con v5 mockup** si disponible (§8.7)
11. **Cálculo de `template_readiness`** por modelo y global según §6.1
12. **Generar MD de auditoría** según §7
13. **Escribir** en rama `data/bestled-canonical-consolidation`:
    - `docs/fichas-tecnicas/bestled-canonical.json`
    - `docs/fichas-tecnicas/bestled-datos-maestros.md`
14. **Commit + push**, **NO mergear a main** hasta aprobación humana

---

## §10 · Handoff al terminar

Responder con:

1. Ruta de los 2 archivos generados + SHA del commit
2. URL del PR o comando para crearlo
3. **Resumen ejecutivo**:
   - N fuentes consultadas (lista) / N no consultadas (lista con razón)
   - N conflictos por severidad: `critical: X · major: Y · minor: Z`
   - N brechas bloqueantes / N brechas no bloqueantes
   - N datos que Claude Web inventó en v5 mockup (con top 5 más graves)
   - **Readiness global**: v4_tecnica / v5_premium / publicacion_web con estado y principales motivos
   - **Readiness por modelo**: matriz 7×3 indicando ready/partial/blocked
4. **Top 5 decisiones pendientes de Claudio** para desbloquear v5.1:
   - Campo · valores en conflicto · recomendación · impacto si no se resuelve · qué plantilla bloquea
5. **Nuevos aliases descubiertos** (si aplica)
6. **Overrides activos** detectados entre modelos (si aplica)

---

## §11 · Después del handoff

1. Claudio revisa PR en GitHub
2. Si hay observaciones → Claude Code itera
3. Merge a `main` solo cuando todos los conflictos `critical` estén resueltos
4. Claudio descarga `bestled-canonical.json` + `bestled-datos-maestros.md`
5. Los sube al **Project knowledge** de Claude.ai (proyecto eLIGHTS)
6. Desde ese momento, toda sesión futura de Claude Web tiene la fuente de verdad en contexto automáticamente
7. Próxima fase: diseño de v5.1 racionalizada (4 páginas) usando solo datos canonical. Cero invención.

---

## §12 · Futuras iteraciones del schema

Si el schema necesita cambios, crear `v3.0.0` en nuevo archivo. Mantener retrocompatibilidad documentada en `docs/fichas-tecnicas/SCHEMA_CHANGELOG.md`. No modificar `v2.1.2` una vez aprobado.
