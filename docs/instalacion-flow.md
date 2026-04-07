# Estado final — Flujo de instalación (/instalacion)

**Fecha de cierre:** 2026-04-06

---

## Resumen

El flujo comercial de instalación en `nuevo.elights.cl/instalacion` quedó operativo end-to-end.

Hoy el flujo hace esto:

1. El usuario completa el formulario de instalación
2. Se envía email vía Google Apps Script relay a `ventas@elights.cl`
3. Se crea un deal en Pipedrive dentro del pipeline de instalación
4. El deal queda clasificado con score y prioridad
5. El endpoint tiene hardening mínimo activo para producción

---

## Landing y formulario

### Ruta

`/instalacion`

### Componente principal de formulario

`src/components/instalacion/InstallationLeadForm.tsx`

### Página

`src/pages/InstalacionPage.tsx`

### Payload frontend

```ts
interface InstallationLeadPayload {
  nombre: string;
    telefono: string;
      email: string;
        comuna: string;
          tipoProyecto: string;
            descripcion: string;
              aceptaContacto: boolean;
                tipoCliente?: 'hogar' | 'empresa' | 'condominio' | '';
                  preferenciaContacto?: 'whatsapp' | 'llamada' | 'email' | '';
                    origen: 'instalacion_web';
                      fecha: string;
                      }
                      ```

                      ---

                      ## API Backend

                      ### Endpoint

                      `POST /api/installation-leads/create`

                      ### Archivo

                      `api/installation-leads/create.ts`

                      ### Flujo interno

                      1. Validación de origen (`VERCEL_ENV` + allowlist de dominios)
                      2. Rate limiting por IP (10 req / 15 min)
                      3. Honeypot anti-bot (`website` debe estar vacío)
                      4. Validación del payload con `validateInstallationPayload`
                      5. `findOrCreatePerson` en Pipedrive
                      6. `createInstallationDeal` en Pipedrive
                      7. Notificación email vía Google Apps Script relay
                      8. Respuesta con IDs para trazabilidad

                      ### Seguridad activa en producción

                      | Mecanismo | Detalle |
                      |---|---|
                      | Origin check | Solo `nuevo.elights.cl` y `elights.cl` |
                      | Rate limit | 10 req / 15 min por IP |
                      | Honeypot | Campo `website` debe estar vacío |
                      | Validación payload | Schema estricto con mensajes de error |

                      ---

                      ## Pipedrive

                      ### Pipeline

                      `Instalación Profesional`

                      ### Stage inicial

                      `Nuevo lead`

                      ### Custom fields mapeados en el deal

                      | Campo lógico | Nombre en Pipedrive | Tipo | Field key |
                      |---|---|---|---|
                      | `leadScore` | leadScore | Numérico | `8312062754e88be243c9f6cc26c5f9098923bb48` |
                      | `priorityTier` | priorityTier | Opción única | `4e2ed082a2386da9097654a30a212986e96b24e5` |
                      | `tipoProyecto` | Tipo de proyecto | Opción única | `PIPEDRIVE_INSTALL_FIELD_PROJECT_TYPE` |
                      | `tipoCliente` | Tipo de cliente | Opción única | `PIPEDRIVE_INSTALL_FIELD_CLIENT_TYPE` |
                      | `descripcion` | Descripción instalación | Texto largo | `PIPEDRIVE_INSTALL_FIELD_DESCRIPTION` |
                      | `preferenciaContacto` | Preferencia contacto | Opción única | `PIPEDRIVE_INSTALL_FIELD_CONTACT_PREF` |
                      | `needsVisit` | (interno) | Booleano | `PIPEDRIVE_INSTALL_FIELD_NEEDS_VISIT` |
                      | `leadRef` | Referencia instalación | Texto | `PIPEDRIVE_INSTALL_FIELD_LEAD_REF` |
                      | `commune` | commune | Texto | `PIPEDRIVE_INSTALL_FIELD_COMMUNE` |

                      ### Archivos CRM relevantes

                      ```
                      api/_lib/crm/installation-mapping.ts   <- mapeo payload → deal params
                      api/_lib/crm/installation-types.ts     <- tipos e interfaces
                      api/_lib/crm/types.ts                  <- tipos Pipedrive compartidos
                      ```

                      ### Lógica de leadScore y priorityTier

                      ```ts
                      // En installation-mapping.ts
                      function buildInstallationCustomFields(
                        payload: InstallationLeadPayload,
                          leadRef: string,
                            leadScore: number,
                              priorityTier: string
                              ): Record<string, string | number | boolean> {
                                // ...
                                  setField('PIPEDRIVE_INSTALL_FIELD_LEAD_SCORE', leadScore);
                                    setField('PIPEDRIVE_INSTALL_FIELD_PRIORITY_TIER', priorityTier);
                                      // ...
                                      }
                                      ```

                                      ---

                                      ## Email

                                      ### Mecanismo

                                      Google Apps Script relay (no SMTP directo).

                                      ### Destino

                                      `ventas@elights.cl`

                                      ### Variable de entorno

                                      | Variable | Uso |
                                      |---|---|
                                      | `GOOGLE_SCRIPT_URL` | URL del relay de Google Apps Script |

                                      ---

                                      ## Variables de entorno en Vercel (production)

                                      | Variable | Descripción |
                                      |---|---|
                                      | `PIPEDRIVE_API_TOKEN` | Token de API de Pipedrive |
                                      | `PIPEDRIVE_INSTALL_PIPELINE_ID` | ID del pipeline de instalación |
                                      | `PIPEDRIVE_INSTALL_STAGE_NEW_LEAD_ID` | ID del stage "Nuevo lead" |
                                      | `PIPEDRIVE_INSTALL_FIELD_SOURCE` | Field key — origen del lead |
                                      | `PIPEDRIVE_INSTALL_FIELD_PROJECT_TYPE` | Field key — tipo de proyecto |
                                      | `PIPEDRIVE_INSTALL_FIELD_CLIENT_TYPE` | Field key — tipo de cliente |
                                      | `PIPEDRIVE_INSTALL_FIELD_COMMUNE` | Field key — comuna |
                                      | `PIPEDRIVE_INSTALL_FIELD_DESCRIPTION` | Field key — descripción |
                                      | `PIPEDRIVE_INSTALL_FIELD_NEEDS_VISIT` | Field key — requiere visita |
                                      | `PIPEDRIVE_INSTALL_FIELD_CONTACT_PREF` | Field key — preferencia de contacto |
                                      | `PIPEDRIVE_INSTALL_FIELD_LEAD_REF` | Field key — referencia interna |
                                      | `PIPEDRIVE_INSTALL_FIELD_LEAD_SCORE` | Field key — score del lead (0-100) |
                                      | `PIPEDRIVE_INSTALL_FIELD_PRIORITY_TIER` | Field key — prioridad (Alta / Normal) |
                                      | `GOOGLE_SCRIPT_URL` | URL del relay de email |

                                      ---

                                      ## Valores de referencia

                                      ### priorityTier — opciones en Pipedrive

                                      | Label | Option ID |
                                      |---|---|
                                      | Alta | 50 |
                                      | Normal | 51 |

                                      ### leadScore — rango

                                      0-100 (numérico entero). El valor es calculado en el backend en función de los datos del payload.

                                      ---

                                      ## Estado operativo

                                      | Ítem | Estado |
                                      |---|---|
                                      | Formulario frontend | ✅ Operativo |
                                      | Endpoint API | ✅ Operativo |
                                      | Pipedrive deal creation | ✅ Operativo |
                                      | leadScore persiste en deal | ✅ Verificado (deal #26121) |
                                      | priorityTier persiste en deal | ✅ Verificado (deal #26121) |
                                      | Email a ventas@elights.cl | ✅ Operativo |
                                      | Hardening producción | ✅ Activo |
                                      | Deploy en Vercel | ✅ commit `aa91315` en main |
