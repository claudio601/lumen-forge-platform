# CLAUDE.md — lumen-forge-platform (nuevo.elights.cl)

> Archivo de memoria del proyecto. Actualizar después de cada corrección relevante.
> Última revisión: 2026-03-16

---

## 1. Stack y entorno

- **Framework**: Vite + React + TypeScript
- **Deploy**: Vercel (auto-deploy en push a main)
- **Dominio**: nuevo.elights.cl (CNAME verificado)
- **Codespace**: probable-couscous-6vwx754945xf494g.github.dev
- **Email relay**: Google Apps Script
- **Plataforma eCommerce base**: Jumpseller (sitio legacy en elights.cl)

---

## 2. Autenticación Jumpseller

- **Método**: Basic Auth (NO Bearer, NO OAuth)
- **Credenciales**: JUMPSELLER_LOGIN + JUMPSELLER_TOKEN (env vars en Vercel)
- **Formato header**: Authorization: Basic base64(login:token)
- **Endpoint base**: https://api.jumpseller.com/v1/
- ⚠️ **Error histórico**: Usar Bearer en vez de Basic Auth rompe todas las llamadas a la API. Verificar siempre el header antes de debuggear otras causas.

---

## 3. Arquitectura Fase 2 (checkout nativo) — COMPLETADA

```
api/
  create-order.ts  → Vercel Serverless Function, maneja POST de órdenes
src/
  jumpsellerCart.ts → lógica de carrito, integración con Jumpseller API
pages/
  CartPage.tsx     → UI del carrito con spinner y manejo de errores
```

- **330 productos** cargados con jumpseller_id mapeado
- CartPage tiene spinner de loading y estados de error implementados
- ⚠️ **TODO pendiente**: ProductCard todavía usa window.open → migrar en Fase 2 single product

---

## 4. Fase 3 — Pendiente

- Login de usuarios
- Panel de órdenes
- ⚠️ Definir specs antes de escribir código (seguir modo plan)

---

## 5. Convenciones del proyecto

- **Archivos con caracteres especiales** (tildes, ñ): escribir con Python en Codespaces para evitar encoding issues
- **Push a main** = deploy automático en Vercel — revisar preview antes de mergear
- **Naming**: camelCase para funciones/variables, PascalCase para componentes React
- **Variables de entorno**: NUNCA hardcodear credenciales. Siempre usar .env.local en dev y Vercel env vars en producción

---

## 6. Reglas aprendidas (errores históricos)

| # | Situación | Regla |
|---|-----------|-------|
| 1 | Basic Auth mal implementado | Siempre verificar el header Authorization antes de debuggear la lógica de negocio |
| 2 | Push directo a main sin revisar | Usar preview de Vercel antes de confirmar deploy |
| 3 | Caracteres especiales corruptos | Usar Python para escribir archivos con tildes/ñ en Codespaces |

---

## 7. Contexto de negocio

- **Empresa**: eLights.cl — iluminación LED industrial y solar, B2B/B2C en Chile
- **Segmentos**: constructoras, ingenieros, arquitectos, instaladores eléctricos, licitaciones públicas
- **Operador**: Claudio (sole operator — web, marketing, ventas, facturación)
- **Agencia externa**: maneja Google Ads, fichas técnicas, diseño web

---

## 8. Comandos útiles del proyecto

```bash
# Dev local
npm run dev

# Build
npm run build

# Preview del build
npm run preview

# Push a producción
git add . && git commit -m "mensaje" && git push origin main
```

---

## 9. Prompts de alto impacto (Boris Cherny / equipo Claude Code)

**Corrección autónoma de bugs**
- Pegar el error de Vercel/CI y simplemente escribir "fix" — no explicar el contexto
- "Ve a arreglar los tests de CI que fallan" — sin micromanagear cómo
- Apuntar a logs directamente si hay problemas de integración

**Subir el nivel del prompting**
- Como revisor: "Critica mis cambios y no crees el PR hasta que apruebe tu prueba"
- Comparar ramas: "Demuéstrame que esto funciona" → Claude compara main vs feature branch
- Forzar elegancia: "Teniendo en cuenta todo lo que sabes ahora, deshazte de esto e implementa la solución elegante"
- Reducir ambigüedad: escribir specs detalladas antes de entregar el trabajo

---

## 10. Configuración de entorno (Terminal)

- Terminal recomendado: Ghostty (renderizado sincronizado, 24-bit color, unicode correcto)
- /statusline: configurar para mostrar uso de contexto y rama git actual
- tmux: una pestaña por tarea/worktree para mantener contexto separado
- Dictado por voz (macOS: fn x2): prompts más detallados y naturales

---

## 11. Subagentes

- Agregar "usa subagentes" a cualquier solicitud donde quieras más cómputo paralelo
- Delegar tareas individuales a subagentes para mantener el contexto principal limpio
- Ejemplo para lumen-forge-platform:

```
usa 5 subagentes para explorar la base de código:
- puntos de entrada y arranque
- estructura de componentes React
- implementación de herramientas
- gestión de estado
- infraestructura de pruebas
```

- ctrl+b para ejecutar en segundo plano

---

## 12. Claude Code para datos y analítica

- Funciona con cualquier base de datos que tenga CLI, MCP o API
- Para Jumpseller: pedirle a Claude Code que consulte la API directamente para extraer métricas de ventas, productos más vistos, órdenes pendientes
- Patrón: "Extrae las órdenes de los últimos 30 días desde la API de Jumpseller y dime cuáles productos tienen mayor rotación"

---

## 13. Checklist de inicio de sesión

- [ ] Revisar este CLAUDE.md
- [ ] Revisar TODOs abiertos (especialmente ProductCard con window.open)
- [ ] Verificar estado de Vercel (último deploy exitoso)
- [ ] Confirmar env vars activas si se agregaron nuevas

---

> Actualizar este archivo después de cada corrección significativa o decisión de arquitectura.
