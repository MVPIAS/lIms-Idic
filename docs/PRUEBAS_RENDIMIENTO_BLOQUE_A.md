# Pruebas de rendimiento y capacidad · LIMS IDIC

**Contrato:** §4.7.6 («soportar ≥ 1000 usuarios y ≥ 20 conexiones concurrentes, con opción de desconexión por inactividad») y §4.8.6 («cada cambio de vista debe cargar en ≤ 5 segundos»).
**Fecha de la medición:** 02-11-2026 (hora de Chile).
**Versión:** rama `bloqueA-operacion` (sobre `8b676cc`), compilación de producción (`nest build`, `next build` / `next start`).

## 1. Resumen

| Requisito | Criterio del contrato | Medido | Resultado |
|---|---|---|---|
| §4.7.6 usuarios registrados | ≥ 1000 | 1105 usuarios activos; listado completo en 151–179 ms; búsqueda en 10–12 ms | **Cumple** |
| §4.7.6 conexiones concurrentes | ≥ 20 | 25 usuarios: 4817 peticiones, 0 errores, p95 218 ms · 50 usuarios: 10 868 peticiones, 0 errores, p95 47 ms | **Cumple** |
| §4.7.6 desconexión por inactividad | Opción configurable | Parámetro «Sesión de los usuarios» en Parámetros del sistema (2–480 min, 20 por defecto); la web lo aplica al abrir cada pantalla | **Cumple** |
| §4.8.6 cambio de vista | ≤ 5 s | 31/31 vistas; peor caso 757 ms (Panel de indicadores) | **Cumple** |

## 2. Entorno

| Elemento | Valor |
|---|---|
| Equipo | Intel Core i7-1195G7 (4 núcleos / 8 hilos), 16 GB RAM, Windows 11 |
| Base de datos | PostgreSQL 16.14 en Docker, copia de la base de demostración (`ba4_demo`) |
| API / web | Node 24, NestJS y Next.js compilados para producción, en el mismo equipo |
| Datos | Base de demostración + 1000 usuarios «PRUEBA carga NNNN» (ANALISTA, repartidos en 13 laboratorios) |

La API, la web, la base y el generador de carga corren en el mismo equipo portátil: la medición incluye el coste de procesamiento, no la latencia de red. El servidor del IDIC será igual o más capaz; la red local del Instituto añade del orden de milisegundos.

## 3. Capacidad: 1000 usuarios (§4.7.6)

Se crearon 1000 usuarios con contraseña propia (hash argon2, como un usuario normal) con `scripts/verificacion/carga-1000-usuarios.sql` (más `hash-clave.js`). Con 1105 usuarios activos:

- **Listado completo de usuarios** (Administración › Usuarios): 151–179 ms, 1,3 MB.
- **Búsqueda de un usuario** por nombre: 10–12 ms.
- **Ingreso** (argon2id): p50 71–73 ms, p95 78–85 ms.
- Pantalla **Administración › Usuarios** con los 1105: 281 ms al cambiar de vista, 326 ms en carga directa.

**Defecto encontrado y corregido.** El listado de usuarios de la API devolvía como máximo 500 filas y declaraba un total de 500. Con más de 500 usuarios, Administración no mostraba al resto. Ahora el tope es de 5000 y el total es el real (`apps/api/src/rbac/usuarios.controller.ts`).

## 4. Concurrencia (§4.7.6)

Guion: `scripts/verificacion/carga-concurrente.js`, sin dependencias. Cada usuario virtual ingresa con **su propia cuenta** y repite durante 60 s el recorrido de lecturas de un analista: avisos, OT, muestras, resultados, equipos, métodos y ensayos del catálogo, agenda semanal y carpetas documentales. Entre petición y petición hay una pausa aleatoria de 125–375 ms, como alguien que navega rápido.

```bash
node scripts/verificacion/carga-concurrente.js --base http://localhost:3012/api --usuarios 25 --duracion 60 --pausa 250
```

### 4.1 Con 25 usuarios concurrentes (primera corrida tras arrancar la API)

| Ruta | Peticiones | Errores | p50 ms | p95 ms | p99 ms | Máx ms |
|---|---:|---:|---:|---:|---:|---:|
| GET /agenda/calendario | 481 | 0 | 15 | 430 | 1733 | 1888 |
| GET /auth/me | 480 | 0 | 8 | 143 | 728 | 1434 |
| GET /avisos | 480 | 0 | 7 | 103 | 832 | 1648 |
| GET /cat/ensayos | 483 | 0 | 9 | 90 | 485 | 1527 |
| GET /cat/metodos | 483 | 0 | 10 | 115 | 727 | 1517 |
| GET /documentos/carpetas | 482 | 0 | 15 | 365 | 1748 | 2082 |
| GET /equipos | 482 | 0 | 14 | 258 | 1291 | 1893 |
| GET /muestras | 482 | 0 | 15 | 373 | 1710 | 1785 |
| GET /ot | 481 | 0 | 25 | 329 | 1678 | 1788 |
| GET /resultados | 483 | 0 | 17 | 264 | 1725 | 1867 |
| **Total** | **4817** | **0** | **13** | **218** | **1330** | **2082** |

80,3 peticiones/s, 0 % de errores. Los picos (p99 de 1,3 s) se concentran en los primeros segundos, con la API recién arrancada (compilación JIT y apertura del grupo de conexiones a la base).

### 4.2 Con 50 usuarios concurrentes (estrés, el doble del mínimo)

| Ruta | Peticiones | Errores | p50 ms | p95 ms | p99 ms | Máx ms |
|---|---:|---:|---:|---:|---:|---:|
| GET /agenda/calendario | 1086 | 0 | 16 | 52 | 508 | 980 |
| GET /auth/me | 1086 | 0 | 7 | 28 | 175 | 350 |
| GET /avisos | 1084 | 0 | 7 | 28 | 266 | 767 |
| GET /cat/ensayos | 1085 | 0 | 8 | 23 | 188 | 637 |
| GET /cat/metodos | 1086 | 0 | 10 | 26 | 203 | 506 |
| GET /documentos/carpetas | 1086 | 0 | 15 | 59 | 427 | 981 |
| GET /equipos | 1088 | 0 | 15 | 72 | 306 | 950 |
| GET /muestras | 1089 | 0 | 15 | 50 | 336 | 872 |
| GET /ot | 1087 | 0 | 24 | 69 | 489 | 893 |
| GET /resultados | 1091 | 0 | 17 | 52 | 266 | 824 |
| **Total** | **10 868** | **0** | **13** | **47** | **280** | **981** |

181,1 peticiones/s, 0 % de errores, ninguna petición por encima de 1 s. Un ingreso recibió 429 porque el límite es de 30 ingresos por minuto por equipo; el guion esperó y lo repitió.

### 4.3 Preproducción (solo lecturas sin sesión)

En preproducción solo se hicieron peticiones GET sin sesión, para no escribir datos: la pantalla de ingreso y la salud de la API. Fueron 25 clientes durante 30 s contra el servidor de preproducción.

| Ruta | Peticiones | Correctas | p50 ms | p95 ms | Máx ms |
|---|---:|---:|---:|---:|---:|
| GET /login (web) | 555 | 555 | 172 | 227 | 699 |
| GET /api/health | 559 | 300 | 155 | 162 | 653 |

Las 259 respuestas restantes de `/api/health` fueron **429 del limitador de peticiones**. Es la protección prevista: 300 peticiones por minuto por usuario o, sin sesión, por dirección IP, y todos los clientes salían de la misma IP. No son fallos del servidor. Los tiempos incluyen la latencia de Internet hasta el servidor.

## 5. Desconexión por inactividad configurable (§4.7.6)

- **Dónde:** Administración › Parámetros del sistema › «Sesión de los usuarios» › «Minutos sin actividad hasta cerrar la sesión». Valores de 2 a 480 minutos; por defecto 20. El cambio exige motivo y queda en el historial del parámetro.
- **Cómo rige:** al abrir cada pantalla, la web consulta `GET /api/auth/sesion-config` y programa el cierre. Un minuto antes muestra el aviso «Seguir conectado».
- **Verificado:** con 35 el endpoint devolvió `{"inactividadMinutos":35}`; con 1 la API respondió 400 («El valor debe estar entre 2 y 480 minutos.»); en el navegador, la pantalla hizo la consulta y obtuvo 200.
- **Archivos:** `packages/db/align_sesion_inactividad.sql`, `apps/api/src/auth/sesion.ts` (+ prueba), `apps/web/lib/useIdleLogout.ts`.

## 6. Tiempo de cambio de vista (§4.8.6)

Guion: `scripts/verificacion/tiempos-vista.js`. Usa Chromium sin interfaz (Playwright), a 1440 × 900 y con el usuario Administrador del sistema, que ve todas las vistas. Para cada vista mide:

- **Cambio de vista:** clic en el menú lateral desde otra pantalla, sin recargar, como lo hace el usuario.
- **Carga directa:** abrir la URL con recarga completa del navegador.

La vista cuenta como cargada en el momento de la última respuesta de la API, siempre que después no quede ninguna petición pendiente durante 400 ms ni haya ningún «Cargando…» visible. Cada vista se midió 3 veces; la tabla da la mediana y el peor caso.

```bash
node scripts/verificacion/tiempos-vista.js --web http://localhost:3130 --repeticiones 3
```

| Vista | Cambio de vista: mediana (máx) ms | Carga directa: mediana (máx) ms |
|---|---:|---:|
| Mi bandeja | 101 (144) | 205 (210) |
| Panel de indicadores | 230 (757) | 293 (438) |
| Clientes | 115 (124) | 166 (198) |
| Oportunidades (CRM) | 142 (197) | 217 (227) |
| Cotizaciones | 124 (173) | 178 (311) |
| Nueva cotización | 363 (381) | 396 (409) |
| Seguimiento | 105 (127) | 214 (221) |
| Facturas | 122 (191) | 171 (267) |
| Órdenes de trabajo | 227 (263) | 252 (348) |
| Registrar OT | 169 (198) | 219 (324) |
| Muestras recibidas | 121 (131) | 145 (160) |
| Bandeja de entrada (recepción) | 157 (241) | 168 (170) |
| Captura y revisión | 92 (93) | 153 (252) |
| Emitir informe | 163 (247) | 265 (375) |
| Informes y certificados | 173 (332) | 191 (223) |
| Equipos y calibración | 167 (210) | 153 (199) |
| Consumibles | 105 (158) | 144 (172) |
| Control de calidad (QC) | 137 (165) | 203 (218) |
| Control estadístico (SPC) | 163 (173) | 203 (256) |
| No conformidades | 174 (260) | 269 (277) |
| Calibraciones (Metrología) | 167 (168) | 180 (243) |
| Internaciones BPCH | 109 (176) | 194 (195) |
| Evidencias SAEC | 9 (14) | 216 (231) |
| Catálogo | 123 (124) | 249 (285) |
| Agenda | 227 (300) | 326 (346) |
| Gestor documental | 462 (584) | 487 (538) |
| Datos de instrumentos | 137 (192) | 168 (191) |
| Reportes | 157 (219) | 207 (276) |
| Mensajería | 127 (142) | 160 (161) |
| Administración › Usuarios (1105) | 281 (342) | 326 (364) |
| Auditoría | 163 (226) | 203 (254) |

**31 de 31 vistas por debajo de 5 s.** El peor caso fue de 757 ms (Panel de indicadores); en carga directa, 538 ms (Gestor documental). No hubo errores de JavaScript en ninguna vista. «Evidencias SAEC» cambia de vista sin consultar la API porque sus datos se cargan en las subpestañas.

## 7. Cómo repetir las pruebas

1. Base de pruebas: una copia de la base (nunca la de producción) y `align_sesion_inactividad.sql`.
2. 1000 usuarios: `docker exec -i <postgres> psql -U lims -d <base> -v hash="$(node scripts/verificacion/hash-clave.js)" -f - < scripts/verificacion/carga-1000-usuarios.sql`. Para quitarlos: `carga-1000-usuarios-borrar.sql`.
3. Carga: `carga-concurrente.js` con `--usuarios 25` y `--usuarios 50`; con `--salida informe.json` guarda las cifras.
4. Vistas: `tiempos-vista.js --web <url de la web>`. En Git Bash para Windows, anteponga `MSYS_NO_PATHCONV=1` si usa `--solo /ruta`.
5. En el servidor del IDIC conviene repetir 3 y 4 durante la puesta en marcha, con su red y su equipo.
