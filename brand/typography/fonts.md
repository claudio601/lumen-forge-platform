# Tipografía oficial eLIGHTS.cl

## Sans-serif (UI + titulares)

**Space Grotesk**

- Familia: Google Fonts, open source
- Instalación: `@fontsource/space-grotesk`
- Pesos en uso: 400, 500, 600, 700
- Fallback: `system-ui, sans-serif`
- Token Tailwind: `font-sans`

## Monospace (SKUs, specs técnicas, códigos)

**IBM Plex Mono**

- Familia: Google Fonts / IBM, open source
- Instalación: `@fontsource/ibm-plex-mono`
- Pesos en uso: 400, 500
- Fallback: `ui-monospace, monospace`
- Token Tailwind: `font-mono`

## Alcance de aplicación

Todo el ecosistema eLIGHTS.cl:

- Sitio web (`elights.cl` y `nuevo.elights.cl`)
- Fichas técnicas de productos
- Emails (transaccionales y comerciales)
- Presentaciones
- Templates de Pipedrive
- Materiales impresos (a futuro)

## Excepción: tipografía del logo

El wordmark del logo `eLIGHTS.cl` puede (y probablemente debe) usar una tipografía distinta, definida por la agencia de diseño al vectorizar el logo. Esto es normal y aceptable. La tipografía del logo y la del sistema son decisiones separadas.

## Cuándo usar cada tipografía

- **Space Grotesk (font-sans, default):** todo el texto visible — titulares, párrafos, botones, labels, navegación
- **IBM Plex Mono (font-mono):** SKUs de productos ("BEST-120"), códigos técnicos, specs numéricas en fichas ("IP66", "50.000 h"), valores de columnas en tablas técnicas

## Justificación

Space Grotesk ofrece diferenciación frente a competencia chilena que usa Arial/Roboto default, transmite carácter industrial y geométrico coherente con productos técnicos. IBM Plex Mono refuerza la imagen de ingeniería en fichas técnicas. Ambas son gratuitas y tienen cobertura completa de caracteres españoles (tildes, ñ).

## Implementación técnica

Cargadas vía `@fontsource` (no CDN de Google Fonts), para garantizar que las fuentes viajan con el deploy de Vercel y no dependen de un tercero. Imports en `src/main.tsx`.

## Para agentes de IA

Al generar piezas gráficas (mockups, banners, documentos):

- Usar Space Grotesk como tipografía sans-serif
- Usar IBM Plex Mono para datos técnicos y códigos
- NO usar Inter, Arial, Helvetica, Roboto u otras alternativas
- Si la herramienta no tiene Space Grotesk disponible, flaggear y preguntar a Claudio qué usar como fallback
