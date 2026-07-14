# QA Report — LIMS IDIC (Preproducción)

**Entorno probado:** https://167.233.221.102.nip.io
**Fecha:** 2026-07-14
**Método:** API (curl directo contra `/api/*`) + navegación real en navegador (Chrome, login con `admin`), inspección de consola/red.
**Alcance:** solo lectura — no se modificó código, no hubo despliegues. Se ejecutaron GET en todos los endpoints solicitados, un POST de prueba a `/cotizaciones/costeo` (no persiste datos) y un intento de POST a `/resultados` con IDs inválidos (esperado que falle). No se crearon clientes/cotizaciones reales para no ensuciar los datos semilla.

---

## 1. Resultado por endpoint (API, con token SUPERADMIN)

| Endpoint | HTTP | Registros | Semilla esperada | Coincide |
|---|---|---|---|---|
| `POST /api/auth/login` | 201 | — | — | OK |
| `GET /api/clientes` | 200 | 8 (`{data:[],meta}`) | 8 | ✅ OK |
| `GET /api/usuarios` | 200 | 2 (`{data:[],meta}`) | — | OK |
| `GET /api/roles` | 200 | 13 (`{data:[],meta}`) | — | OK |
| `GET /api/cotizaciones` | 200 | 0 (array plano `[]`) | — | Vacío (legítimo, no hay cotizaciones creadas) |
| `GET /api/ot` | 200 | 0 (array plano `[]`) | — | Vacío (legítimo) |
| `GET /api/proveedores` | **500** | — | 5 | ❌ **ROTO** |
| `GET /api/listas-precio` | **500** | — | — | ❌ **ROTO** |
| `GET /api/facturas` | **500** | — | — | ❌ **ROTO** |
| `GET /api/muestras` | **500** | — | — | ❌ **ROTO** |
| `GET /api/metodos` | **500** | — | 136 | ❌ **ROTO** |
| `GET /api/plantillas` | **500** | — | 114 | ❌ **ROTO** |
| `POST /api/cotizaciones/costeo` | 201 (con payload válido) | — | — | Ver nota abajo |
| `POST /api/resultados` | 500 (con IDs inexistentes) | — | — | Debería ser 400/404, no 500 |
| `GET /api/clientes/{id}` | 200 | detalle completo | — | OK |
| `GET /api/nonexistent` | 404 | — | — | OK (ruteo correcto) |
| Sin header Authorization | 401 | — | — | OK (auth correcta) |

**6 de 11 endpoints solicitados devuelven 500 de forma constante**, sin importar query params (`?page=1&limit=5`, con/sin filtros, con/sin trailing slash). No es un problema de paginación ni de ruta: es un error de servidor reproducible al 100%.

### Nota sobre `POST /cotizaciones/costeo`
El primer intento con `{"tipo":"analisis", ...}` devolvió 500. Repitiendo la prueba con el enum correcto (`tipo:"otros"`, en minúsculas, tal como lo usa el frontend) devolvió 201 con cálculo correcto. **Hallazgo derivado:** el endpoint no valida el DTO de entrada — un `tipo` con valor no reconocido (o mal capitalizado, p.ej. `"Otros"` en vez de `"otros"`) provoca una excepción no controlada (500) en lugar de un 400 Bad Request con mensaje de validación. Ver bug #6.

---

## 2. Recorrido de UI (login → dashboard → cada sección)

Login funciona (usuario `admin` / password dado → redirige a `/dashboard`). Todas las páginas fueron accesibles vía el menú lateral. Resumen por página:

| Página | URL | Estado |
|---|---|---|
| Dashboard | `/dashboard` | Carga, pero KPIs de Muestras/Métodos/Plantillas/Proveedores muestran **0** (en realidad son errores 500 disfrazados de "sin datos") |
| Clientes | `/clientes` | OK, muestra 8 registros correctamente. Formulario "+ Nuevo" abre inline, validación HTML5 nativa en campos requeridos |
| Proveedores | `/proveedores` | Texto crudo **"Internal server error"** en pantalla, sin manejo de error |
| Cotizaciones | `/cotizaciones` | Lista vacía. Contiene texto de placeholder **"Datos de muestra (backend no conectado)"** visible en producción |
| Cotizaciones · Nueva/Costeo | `/cotizaciones/nueva` | Funciona: agregar líneas, calcular costeo (POST 201, cálculo correcto: CD, CFA, CT, 3 precios con/sin IVA) |
| Listas de Precio | `/listas-precio` | Texto crudo "Internal server error" |
| Facturas | `/facturas` | Texto crudo "Internal server error" (con tabla de columnas vacía debajo) |
| Órdenes de Trabajo | `/ot` | Buen estado vacío: "Sin órdenes de trabajo todavía. Se generan al aceptar una cotización." (sin botón "+ Nuevo", inconsistente con el resto) |
| Muestras | `/muestras` | Texto crudo "Internal server error" |
| Captura de Resultados | `/captura` (el enlace de menú NO apunta a `/resultados` como se asumía en el enunciado) | Carga, pero los combos "Muestra" y "Analito" están **completamente vacíos** (solo la opción placeholder "— seleccionar —"); "(sin analitos cargados)" fijo. Formulario inutilizable end-to-end |
| Métodos / Catálogo | `/metodos` | Copy fijo dice **"136 métodos cargados en 5 laboratorios (LQC, SVM, SEO, LES, LQA)"**, pero debajo: "Internal server error" — confirma que el dato existe pero el listado está roto |
| Plantillas Informe | `/plantillas` | "Internal server error" |
| Diseñador de Flujos | `/flujos` | **Funciona bien** — lista flujos reales (FLU-ALI, FLU-BAL, FLU-COM…) con versión y estado ("publicado"), editor con botones Guardar borrador/Publicar/Simular. Es la única pantalla con botones con color (el resto no tiene ningún estilo). Tardó ~5s en volverse interactivo tras la navegación (posible carga pesada de librería de diagramación) |
| Usuarios y Roles | `/usuarios` | OK, muestra 2 usuarios con rol y estado correctamente |

### Consola / Red
- No se detectaron errores de JavaScript en consola en ninguna página (los fallos son silenciosos: la app atrapa el error y solo pinta el texto "Internal server error").
- Cada navegación dispara un **prefetch de Next.js hacia TODOS los enlaces del menú lateral** (se ve en la pestaña de red: al entrar a cualquier página se disparan ~10 GET adicionales a `/api/proveedores?limit=1`, `/api/metodos?limit=1`, etc., aunque el usuario no visite esas secciones). Esto amplifica innecesariamente la carga contra el backend y contra los endpoints rotos.
- No se encontraron enlaces 404 rotos en el menú (excepto la discrepancia de nomenclatura `/resultados` vs `/captura`, que no es un enlace roto sino un supuesto incorrecto en el enunciado de prueba).

---

## 3. Hallazgo #0 — CSS de producción sin compilar (CRÍTICO, causa raíz del "diseño pobre")

**Esto es probablemente el hallazgo más importante del informe.**

El archivo CSS que sirve la app en producción (`https://167.233.221.102.nip.io/_next/static/css/551d74a61fadfeb7.css`, HTTP 200, 98 bytes) contiene literalmente:

```
@tailwind base;@tailwind components;@tailwind utilities;@layer base{body,html{@apply bg-slate-50}}
```

Es decir, el **código fuente de Tailwind sin procesar por PostCSS**, no una hoja de estilos compilada. El navegador ignora las reglas `@tailwind`/`@apply` (no son CSS válido fuera del pipeline de build), por lo que **toda la aplicación se renderiza con estilos por defecto del navegador**: sin colores de marca, sin espaciados, sin tarjetas, sin tablas con formato, sin botones con estilo (excepto el editor de Flujos, que aparenta usar estilos inline/CSS-in-JS independientes de Tailwind).

Esto explica por qué el diseño se percibe muy por debajo del prototipo: no es una cuestión de gusto o de iteración de UI pendiente, es que **el build de producción nunca ejecutó la compilación de Tailwind/PostCSS** (falta el paso `tailwindcss build` o la configuración de `content`/`postcss.config` no se está aplicando en el Dockerfile/pipeline de despliegue de `apps/web`). Es la causa de fondo de casi todas las observaciones de UX de la sección 5.

**Severidad: Crítica.** Es, con diferencia, lo primero a arreglar antes de mostrar el sistema a cualquier interesado — el arreglo probablemente es de build/infra (una línea de configuración o un paso de pipeline faltante), no un rediseño.

---

## 4. Bugs funcionales concretos (con pasos de reproducción)

### Bug #1 — 6 endpoints core devuelven 500 de forma constante (CRÍTICO)
**Endpoints:** `/api/proveedores`, `/api/listas-precio`, `/api/facturas`, `/api/muestras`, `/api/metodos`, `/api/plantillas`.
**Pasos:** `GET https://167.233.221.102.nip.io/api/metodos` con `Authorization: Bearer <token admin>` → `{"statusCode":500,"message":"Internal server error"}`.
**Evidencia:** confirmado también en UI — la página `/metodos` declara en su propio copy "136 métodos cargados en 5 laboratorios" y aun así renderiza "Internal server error" bajo la tabla. Mismo patrón en Proveedores, Plantillas, Facturas, Listas de Precio y Muestras.
**Impacto:** bloquea por completo 6 de las 11 secciones funcionales del sistema, y en cascada bloquea Captura de Resultados (combos vacíos porque dependen de `/muestras` y del catálogo de métodos/analitos).
**Severidad:** Crítica — es el bug de mayor impacto del sistema, por delante incluso del CSS, porque impide usar el LIMS para su propósito central (catálogo de métodos, muestras, facturación).

### Bug #2 — Captura de Resultados inutilizable end-to-end (CRÍTICA)
**Pasos:** login → Captura de Resultados (`/captura`) → combo "Muestra" solo tiene la opción "— seleccionar —"; combo "Analito" muestra fijo "(sin analitos cargados)".
**Causa:** consecuencia directa del Bug #1 (`/muestras` y `/metodos` rotos) sumado a que no existen muestras/OTs reales sembradas (cotizaciones=0, OT=0).
**Impacto:** el flujo núcleo de un LIMS (captura de resultados analíticos) no se puede demostrar ni probar en este entorno.
**Severidad:** Crítica.

### Bug #3 — Errores de API expuestos como texto plano sin manejo (ALTA)
**Pasos:** navegar a cualquiera de las 6 secciones rotas.
**Observado:** el literal `Internal server error` aparece como texto de página, sin traducción, sin ícono, sin acción de reintento, mezclado con el resto del contenido (a veces con un `Buscar…` funcional justo debajo, lo cual es confuso: parece que la búsqueda debería funcionar sobre una tabla que nunca cargó).
**Severidad:** Alta — no es solo estético: comunica al usuario final (y a cualquier cliente que vea una demo) que el sistema está roto, sin indicarle qué hacer.

### Bug #4 — Filas de tabla no son accionables (ALTA)
**Pasos:** `/clientes` → clic sobre el nombre de un cliente (p.ej. "CAP Acero · Compañía Acero del Pacífico").
**Observado:** el elemento es texto plano (`generic`), no un link ni un botón — no navega a ningún detalle, no abre modal de edición, no hay forma de ver/editar un cliente existente ni de ver sus cotizaciones/OTs asociadas desde la lista. El backend sí expone `GET /api/clientes/{id}` con `plantas`, `cotizaciones`, `ots` — el dato está disponible pero no hay UI para consumirlo.
**Impacto:** rompe el flujo comercial básico ("Instituciones y empresas que solicitan ensayos. El flujo comercial arranca aquí." dice el propio copy de la página, pero no se puede entrar al detalle de ningún cliente).
**Severidad:** Alta.

### Bug #5 — Copy hardcodeado admite que el backend no está conectado (MEDIA/ALTA — imagen de marca)
**Pasos:** `/cotizaciones` → observar el texto bajo el título.
**Observado:** "Una cotización aceptada genera la OT (expediente). · Datos de muestra (backend no conectado)" — texto de placeholder de desarrollo dejado en producción, visible para cualquier usuario o cliente que entre a esa pantalla.
**Severidad:** Media-Alta — riesgo de imagen frente al cliente si se muestra en una demo sin revisar antes.

### Bug #6 — Validación de DTOs ausente: 500 en vez de 400 (MEDIA)
**Pasos:** `POST /api/cotizaciones/costeo` con `tipo` en un valor no reconocido por el enum (p.ej. `"analisis"` o `"Otros"` con mayúscula) → 500 Internal Server Error.
**Esperado:** 400 Bad Request con detalle del campo inválido.
**Mismo patrón en:** `POST /api/resultados` con IDs de muestra/analito inexistentes → también 500 en vez de 404/400.
**Impacto:** dificulta el diagnóstico en producción (todo error de input se ve igual que una caída real del servidor) y sugiere que no hay una capa de validación (class-validator / zod, etc.) delante de los controladores, o que las excepciones no están siendo mapeadas a códigos HTTP correctos.
**Severidad:** Media — no bloquea el uso normal (la UI solo envía valores válidos), pero es mal indicio de robustez del backend y complica soporte.

### Bug #7 — Inconsistencia de formato de respuesta entre endpoints (BAJA/MEDIA — deuda técnica)
**Observado:** `/api/clientes`, `/api/usuarios`, `/api/roles` devuelven `{data:[...], meta:{page,limit,total,totalPages}}`; `/api/cotizaciones` y `/api/ot` devuelven un **array plano** `[...]` sin metadatos de paginación.
**Impacto:** cualquier componente de tabla/paginación reusable en el frontend tiene que manejar dos contratos distintos; es una fuente probable de bugs futuros (y podría explicar por qué algunas listas no pintan bien cuando haya más de una página de datos).
**Severidad:** Media (deuda técnica, riesgo de bugs futuros).

### Bug #8 — "Diseñador de Flujos" tarda varios segundos en volverse interactivo (BAJA)
**Pasos:** clic en "Diseñador de Flujos" desde el dashboard.
**Observado:** la captura de pantalla tardó >30s en poder tomarse (timeout del navegador) tras la navegación; tras esperar ~5s adicionales la página ya respondía. No hubo errores en consola.
**Severidad:** Baja — no es bloqueante, pero conviene perfilar (probablemente carga de una librería de diagramación pesada sin code-splitting/lazy loading).

### Bug #9 — Falta botón "+ Nuevo" en Órdenes de Trabajo (BAJA — consistencia)
**Observado:** todas las demás secciones (Clientes, Proveedores, Cotizaciones, Muestras, Métodos, Plantillas, Usuarios) tienen un botón "+ Nuevo" arriba a la izquierda; OT no lo tiene (aunque el copy dice "Se generan al aceptar una cotización", que sería la razón de diseño — pero no hay indicación visual de eso, es una inferencia).
**Severidad:** Baja.

---

## 5. Observaciones de UX / diseño

Todas las observaciones siguientes son consecuencia directa (o agravadas) por el Bug #0 (CSS sin compilar), pero se listan por separado porque son visibles y accionables independientemente:

- **Sin jerarquía visual:** todo el contenido es texto negro sobre blanco en la misma tipografía serif por defecto del navegador (Times-like). Títulos, párrafos descriptivos, nombres de columna y datos son visualmente casi indistinguibles salvo por negrita/tamaño heredado de las etiquetas `<h1>`/`<h2>` nativas.
- **Densidad de información pobre:** no hay padding/margin entre elementos — el menú lateral, el buscador global, el nombre de usuario y el botón "Cerrar sesión" aparecen todos apilados uno debajo del otro como una lista continua, en vez de estar organizados en un sidebar + topbar diferenciados.
- **Sin feedback visual de estado:** los botones ("+ Nuevo", "Guardar", "Cerrar") son `<button>` nativos sin estilo — no hay diferencia visual entre una acción primaria (Guardar) y una secundaria/destructiva (Cerrar), ni estado hover/disabled visible.
- **Estados vacíos inconsistentes:** OT tiene un buen mensaje vacío ("Sin órdenes de trabajo todavía..."); Cotizaciones muestra encabezados de tabla sin filas y sin mensaje; los 6 endpoints rotos muestran el crudo "Internal server error" en vez de un estado vacío o de error diseñado.
- **Formularios sin feedback de validación propio:** el alta de Cliente depende 100% de la validación nativa del navegador (`required`) — no hay mensajes de error en español, ni resaltado de campo, ni resumen de errores.
- **Iconos emoji como iconografía:** el menú usa emojis (🚚 Clientes, 📋 Órdenes, 🧪 Muestras, etc.) en vez de un set de íconos consistente — funciona como marcador temporal pero no transmite una imagen profesional/institucional (recordar que el cliente es el Ejército de Chile).
- **Buscadores "decorativos":** el campo "Buscar…" aparece en la mayoría de las listas (incluidas las rotas), pero en las secciones con error 500 no hay nada que buscar — da la falsa impresión de que la función de búsqueda está lista cuando el listado subyacente ni siquiera carga.
- **Tabla de clientes sin acciones:** confirmado en Bug #4 — ni edición, ni detalle, ni indicación visual de que una fila podría ser clickeable (no hay cursor pointer, ni chevron, ni botón de acción al final de la fila).

---

## 6. Top 10 a resolver antes de mostrar al cliente

1. **Arreglar el build de CSS de producción** (Bug #0) — verificar que el Dockerfile/pipeline de `apps/web` ejecute correctamente `next build` con PostCSS/Tailwind y que el CSS servido sea el compilado, no el fuente. Este único fix probablemente resuelve el 70% de la percepción de "diseño pobre".
2. **Diagnosticar y arreglar los 6 endpoints en 500** (Bug #1): `/proveedores`, `/metodos`, `/plantillas`, `/muestras`, `/facturas`, `/listas-precio`. Son datos ya sembrados (136 métodos, 114 plantillas, 5 proveedores) que el sistema no puede mostrar — es el bloqueador funcional más grave.
3. **Restaurar el flujo de Captura de Resultados** (Bug #2) — depende del punto 2, pero además falta sembrar/generar al menos una OT/muestra de ejemplo para poder demostrar el flujo completo (cotización → OT → muestra → resultado → informe).
4. **Reemplazar el manejo de errores genérico** (Bug #3) por un estado de error diseñado (ícono, mensaje en español, botón de reintento) en vez del texto crudo "Internal server error".
5. **Quitar/actualizar el texto "(backend no conectado)"** visible en `/cotizaciones` (Bug #5) — riesgo de imagen inmediato si se muestra tal cual al cliente.
6. **Habilitar navegación al detalle de un registro** (Bug #4) — como mínimo en Clientes, que es el punto de entrada del flujo comercial.
7. **Agregar validación de entrada (400) en los endpoints de escritura** (Bug #6) — al menos en `/cotizaciones/costeo` y `/resultados`, antes de que el equipo de QA/cliente prueben con datos reales y reciban 500 en vez de un mensaje claro.
8. **Unificar el contrato de respuesta de listados** (Bug #7) — decidir entre `{data,meta}` siempre o array plano siempre, para evitar bugs de paginación futuros.
9. **Revisar el rendimiento del Diseñador de Flujos** (Bug #8) — perfilar la carga inicial; si el sistema se demora >5s en volverse interactivo genera la sensación de que "se colgó".
10. **Pase de UX dedicado post-fix de CSS:** una vez Tailwind compile correctamente, revisar jerarquía tipográfica, iconografía (reemplazar emojis por un set de íconos), estados vacíos y feedback de formularios — para acercar el resultado al prototipo aprobado.

---

## Apéndice — evidencia cruda

```
POST /api/auth/login → 201, token SUPERADMIN obtenido correctamente

GET /api/clientes            → 200, {data:[...8 items],meta:{page:1,limit:20,total:8,totalPages:1}}
GET /api/proveedores         → 500 {"statusCode":500,"message":"Internal server error"}
GET /api/cotizaciones        → 200, []
GET /api/listas-precio       → 500 {"statusCode":500,"message":"Internal server error"}
GET /api/facturas            → 500 {"statusCode":500,"message":"Internal server error"}
GET /api/ot                  → 200, []
GET /api/muestras            → 500 {"statusCode":500,"message":"Internal server error"}
GET /api/usuarios            → 200, {data:[...2 items],meta:{...}}
GET /api/roles               → 200, {data:[...13 items],meta:{...}}
GET /api/metodos             → 500 {"statusCode":500,"message":"Internal server error"}
GET /api/plantillas          → 500 {"statusCode":500,"message":"Internal server error"}

GET /api/metodos?page=1&limit=5   → 500 (igual sin query params)
GET /api/metodos/                 → 500 (igual con/sin trailing slash)
GET /api/catalogo/metodos         → 404 (ruta no existe, confirma que /metodos es la ruta correcta)

GET /api/clientes/{id válido}     → 200, detalle completo con relaciones (plantas, cotizaciones, ots)
GET /api/nonexistent              → 404 {"message":"Cannot GET /api/nonexistent","error":"Not Found","statusCode":404}
GET /api/clientes (sin token)     → 401 {"message":"Unauthorized","statusCode":401}

POST /api/cotizaciones/costeo {tipo:"analisis",...}  → 500
POST /api/cotizaciones/costeo {tipo:"otros",...}     → 201 {"costoDirecto":{"otros":30000},"cdt":30000,"cfa":3000,"ct":33000,...}
POST /api/cotizaciones/costeo {tipo:"Otros",...}     → 500 (case-sensitive, sin validación)

POST /api/resultados {muestraId:uuid-falso, analitoId:uuid-falso, replicas:[...]} → 500 (debería ser 400/404)

CSS de producción (https://.../_next/static/css/551d74a61fadfeb7.css, 200, 98 bytes):
  @tailwind base;@tailwind components;@tailwind utilities;@layer base{body,html{@apply bg-slate-50}}
  ↑ fuente sin compilar, no CSS válido para el navegador
```
