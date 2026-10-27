# Zona horaria · regla única de fechas (frente f8)

El IDIC trabaja en hora de Chile, `America/Santiago`, con horario de verano. En verano (UTC−3), a partir de las 21:00 de Chile ya es el día siguiente en UTC. En invierno (UTC−4), a partir de las 20:00.

## Síntomas que la originaron
- **D04-33 (MP-04).** Una entrega registrada a las 21:30 de Chile salía como «Entregado 27-10-2026» en la pestaña Instrumentos y en «Informe y cierre», mientras la tabla «Documentos de Metrología» decía 26-10. La web cortaba un `timestamptz` a día con su parte UTC (`fechaDia`).
- **Orden interna.** Creada después de las 21:00 de Chile, la API la rechazaba con «la fecha de envío no puede ser anterior a la apertura de la OT». La regla comparaba el día de apertura con la hora local del proceso. En un contenedor en UTC, ese día ya era el siguiente.

## Causa común
Para sacar «hoy», cortar un instante a día o sacar el año, el código usaba la zona del proceso o UTC en vez de la de Chile:
- `toISOString().slice(0, 10)` sobre un instante;
- `getFullYear()`, `getDate()` y `setHours()` locales;
- `current_date` y `::date` en una sesión de base de datos sin zona fija;
- copias sueltas de `"America/Santiago"` en unos ficheros y no en otros.

## La regla
1. **Lo que se guarda como `timestamptz` se queda en UTC.** No se migra ningún dato.
2. **Las fechas de calendario se toman tal cual.** Son las columnas DATE, que llegan como `aaaa-mm-dd` o `aaaa-mm-ddT00:00:00.000Z`.
3. **Todo lo que depende del día se calcula explícitamente en la zona del IDIC.** Se usan estas funciones, sea cual sea `TZ` en el servidor o en el equipo del usuario:

| Necesidad | API · `apps/api/src/common/fecha-chile.ts` | Web · `apps/web/lib/fecha-chile.ts` (y `lib/format.ts`) |
|---|---|---|
| Hoy «aaaa-mm-dd» | `hoyChile()` | `hoyChile()` / `hoyISO()` |
| Día de un valor (DATE tal cual; instante en Chile) | `diaChile(v)` | `diaChile(v)` / `fechaDia(v)` |
| Día de un instante (siempre convierte) | `diaInstanteChile(v)` | — |
| Año de la numeración | `anioChile()` | `anioChile()` |
| Mes en curso | `mesChile()` | `mesChile()` |
| Hoy para una columna DATE con Prisma | `hoyFechaChile()` | — |
| Comienzo del día en Chile | `inicioDiaChile(dia)` | — |
| Hora de pared de Chile → instante | `instanteDeHoraChile(...)` | `deInputHoraChile(...)` |
| Valor de `<input type="datetime-local">` | — | `ahoraInputChile()` / `aInputHoraChile(v)` |
| dd-mm-aaaa / dd-mm-aaaa HH:MM | `fechaChile` / `fechaHoraChile` | `fecha` / `fechaHora` |
| Sumar días de calendario | `sumarDiasCalendario` | `sumarDiasCalendario` |
| SQL: hoy / día de un `timestamptz` | `SQL_HOY`, `sqlDia(expr)`, `SQL_ZONA` | — |

4. **La sesión de base de datos de la API trabaja en la zona del IDIC.** `common/zona-entorno.ts`, el primer import de `main.ts`, añade `options=-c TimeZone=<zona>` a `DATABASE_URL`. Así `current_date`, `now()::date`, `x::date`, `date_trunc` y los `DEFAULT CURRENT_DATE` cortan el día en Chile, aunque el servidor de Postgres esté en UTC. Al arrancar, la API comprueba la zona de la sesión y avisa en el registro si no coincide.
5. **La base tiene la misma zona por defecto.** `align_zona_horaria.sql` la fija para psql, semillas, respaldos e informes externos. Es aditivo e idempotente y respeta una zona ya configurada a mano.
6. **Un guardián en las pruebas.** `fecha-chile.regla.spec.ts` falla si reaparecen estos patrones en la API o en la web:
   - `new Date().toISOString().slice(0, 10)`;
   - `getFullYear`, `getDate` o `setHours` locales;
   - `toLocaleDateString` sin `timeZone`;
   - la zona escrita a mano.

Una fecha de calendario y un instante que cae justo a las 00:00:00.000 UTC no se distinguen. Ese instante son las 21:00:00.000 exactas de Chile en verano. `diaChile` lo toma como fecha de calendario. Si el valor es siempre un instante, use `diaInstanteChile`.

## Configuración
- `ZONA_HORARIA` (API, por defecto `America/Santiago`). Una zona no válida se ignora.
- `NEXT_PUBLIC_ZONA_HORARIA` (web, `--build-arg` al construir; vacía = `America/Santiago`).
- `TZ` de los contenedores api, web y postgres = `${ZONA_HORARIA:-America/Santiago}` en `docker-compose.prod.yml` y `docker-compose.onpremise.yml`. Es defensa en profundidad: la regla no depende de `TZ`.

## Pruebas
`apps/api/src/common/fecha-chile.f8.spec.ts` fija el reloj en estos instantes:
- 21:30 y 23:59 de Chile, en verano y en invierno;
- 20:30 de invierno;
- 31-12 a las 23:59.

Cada caso se repite con la zona del proceso en UTC, Asia/Tokyo y America/Santiago. Cubre:
- «hoy» y el año de la numeración;
- la entrega (D04-33);
- la orden interna;
- el semáforo «vence hoy» y la fecha de compromiso;
- la validez de la cotización;
- la no conformidad;
- la retención de custodia;
- la fecha de la factura;
- la bitácora;
- los documentos.
