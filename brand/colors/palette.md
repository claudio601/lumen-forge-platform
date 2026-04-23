# Paleta oficial eLIGHTS.cl

## Violeta primario

**Violeta custom eLIGHTS.cl** — uso exclusivo para elementos de marca primarios (botones, badges, íconos, CTAs, links principales).

- HEX: `#6B21D9`
- HSL: `270 76% 47%`
- Token Tailwind/shadcn: `primary`
- CSS variable: `--primary: 270 76% 47%`

**Nota importante:** este no es Violet 700 de Tailwind (que sería HSL 262 83% 51% / `#6D28D9`). Es un violeta propio con hue 270, consolidado históricamente en el theme del sitio. Esto es un activo de diferenciación, no un error.

## Violeta secundario / hover

Variante más clara del primario para estados hover.

- HSL aproximado: `270 76% 55%`
- Se genera automáticamente vía `bg-primary/90` en Tailwind

## Violeta tenue (highlights inline)

- Fondo: `hsl(var(--primary) / 0.10)` = violeta primario al 10% de opacidad
- Texto sobre fondo tenue: violeta primario
- Uso: badges suaves dentro de párrafos, resaltados inline sin romper flujo de lectura
- Clase Tailwind equivalente: `bg-primary/10 text-primary`

## Cyan — EXCLUSIVO Estudio Lumínico

**Cyan 500** — uso reservado únicamente para el servicio Estudio Lumínico DIALux.

- HEX: `#06B6D4`
- Token Tailwind: `cyan-500`

**Prohibido:** usar cyan en otros servicios, páginas generales, botones no relacionados con Estudio Lumínico.

## Grises neutros (sistema shadcn)

- Fondo claro: `#FAFAFA` / `zinc-50`
- Fondo secundario: `#F4F4F5` / `zinc-100`
- Texto principal: `#18181B` / `zinc-900`
- Texto secundario: `#71717A` / `zinc-500`
- Borde: `#E4E4E7` / `zinc-200`

## Semánticos (status, NO son colores de marca)

- Verde "En stock": `#10B981` / `emerald-500`
- Verde WhatsApp: `#25D366` (estándar oficial WhatsApp — no modificar)
- Rojo error / destructive: token shadcn `destructive`

## Colores prohibidos

- **Naranja en cualquier variante** — no pertenece a la marca. Cualquier gradient violeta→naranja detectado debe eliminarse.
- **Amber (`#F59E0B`, `#FCD34D`)** — eliminado del sistema en abril 2026 por disciplina de paleta mono-violeta.
- Amarillos, rosas, morados fuera de la escala violeta.

## Arquitectura de color por servicio

Decisión tomada en abril 2026:

- **Productos / Marca core:** violeta primario
- **Estudio Lumínico:** cyan `#06B6D4` como color dedicado del servicio
- **Instalación Profesional:** violeta primario (sin color dedicado)
- **Paneles Solares:** violeta primario

**Principio rector:** el sistema de color es mayoritariamente mono-violeta, con una sola excepción justificada (cyan para Estudio Lumínico por ser un servicio B2B diferenciado con identidad visual propia). No se crean colores nuevos por servicio salvo decisión explícita documentada.

## Para agentes de IA

Antes de generar cualquier pieza:

1. Usar exclusivamente colores de esta paleta
2. Si un color requerido no está aquí, detener y preguntar a Claudio
3. No inventar escalas ni variaciones
