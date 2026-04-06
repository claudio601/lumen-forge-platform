// api/_lib/crm/installation-scoring.ts
// ─────────────────────────────────────────────────────────────────────────────
// Scoring especifico para leads de instalacion profesional.
//
// Logica distinta a scoring.ts (cotizaciones) porque los factores de calidad
// son diferentes: aqui no hay monto ni productos, sino tipo de proyecto,
// tipo de cliente y completitud de datos de contacto.
// ─────────────────────────────────────────────────────────────────────────────

import type { InstallationLeadPayload } from './installation-types.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const BASE_SCORE = 40;

// Bonos por tipo de proyecto (mayor potencial comercial = mas puntos)
const SCORE_BY_PROJECT_TYPE: Record<string, number> = {
  'Proyecto industrial': 30,
  'Condominio / edificio': 25,
  'Local comercial': 20,
  'Bodega': 20,
  'Oficina': 15,
  'Paneles solares': 15,
  'Casa / departamento': 10,
  'Otro': 5,
};

// Bonos por tipo de cliente
const SCORE_BY_CLIENT_TYPE: Record<string, number> = {
  empresa: 20,
  condominio: 15,
  hogar: 5,
  '': 0,
};

const BONUS_HAS_PHONE = 5;       // tiene telefono
const BONUS_HAS_EMAIL = 3;       // tiene email (siempre present, pero por si acaso)
const BONUS_LONG_DESCRIPTION = 7; // descripcion > 50 chars = proyecto mas serio

const HIGH_PRIORITY_THRESHOLD = 70;

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface InstallationLeadScoreResult {
  score: number;
  priorityTier: 'Alta' | 'Normal';
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Calcula el score de un lead de instalacion.
 *
 * Escala: 0-100
 * Tier Alta: score >= 70
 * Tier Normal: score < 70
 *
 * Factores:
 * - Tipo de proyecto (30 max)
 * - Tipo de cliente (20 max)
 * - Telefono presente (+5)
 * - Email presente (+3)
 * - Descripcion detallada (+7)
 * - Score maximo: 105 -> capped a 100
 */
export function scoreInstallationLead(
  payload: InstallationLeadPayload
): InstallationLeadScoreResult {
  let score = BASE_SCORE;

  // Tipo de proyecto
  const projectBonus = SCORE_BY_PROJECT_TYPE[payload.tipoProyecto] ?? 5;
  score += projectBonus;

  // Tipo de cliente
  const clientBonus = SCORE_BY_CLIENT_TYPE[payload.tipoCliente ?? ''] ?? 0;
  score += clientBonus;

  // Datos de contacto
  if (payload.telefono?.trim()) score += BONUS_HAS_PHONE;
  if (payload.email?.trim()) score += BONUS_HAS_EMAIL;

  // Descripcion detallada (proxy de seriedad del proyecto)
  if (payload.descripcion?.trim().length > 50) score += BONUS_LONG_DESCRIPTION;

  // Cap a 100
  score = Math.min(score, 100);

  const priorityTier: 'Alta' | 'Normal' =
    score >= HIGH_PRIORITY_THRESHOLD ? 'Alta' : 'Normal';

  return { score, priorityTier };
}
