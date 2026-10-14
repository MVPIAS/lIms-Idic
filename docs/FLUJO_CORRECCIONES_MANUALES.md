# Correcciones detectadas al reescribir los manuales · LIMS IDIC

Una revisión pantalla por pantalla, al reescribir los manuales de usuario, encontró
14 puntos en los que la pantalla no dejaba recorrer el flujo, daba más permisos de
la cuenta o mostraba algo engañoso. Este documento dice qué regla aplica ahora el
servidor y cómo se comprueba.

- SQL: `packages/db/align_correcciones_manuales.sql` (aditivo e idempotente; último de `ORDEN_SQL.txt`).
- Verificación contra la API: `scripts/verificacion/flujo-completo.js` (punto 1 por la ruta de la
  pantalla, punto 2 y la tarjeta del punto 9) y `scripts/verificacion/correcciones-manuales.js`
  (puntos 1, 2, 3, 4, 5, 6, 7, 8, 12, 13 y 14, cada uno con el perfil que debe poder y con uno que no).

## Imprescindibles

| # | Antes | Ahora |
|---|---|---|
| 1 | La OT que nace al aceptar una cotización no tenía pantalla para registrar sus muestras ni generar sus ensayos | Pestaña «Muestras» del expediente: «Registrar muestras recibidas» con los ensayos de la cotización (marcados si el ensayo tiene un solo método) o métodos buscados en el catálogo. `GET /flujo/ot/:id/registro-muestras` · `POST /flujo/ot/:id/muestras` (`muestra.crear`). Detalle: `FLUJO_LABORATORIO.md` §1b |
| 2 | Un resultado aprobado no se podía corregir | «Reabrir» (jefatura, `resultado.reabrir`, motivo obligatorio): vuelve a `devuelto`, anula los documentos en firma u oficiales de la OT y queda la traza. Tras aprobar de nuevo se reemite. `FLUJO_LABORATORIO.md` §4 |
| 3 | En sucursales y D11 la plantilla proponía «Informe de ensayo» y la matriz pedía un revisor que la unidad no tiene | El tipo por defecto sale de la unidad de la OT (`unidad.tipo_documento_defecto`, heredado: BPCH y su rama → «Informe de inspección»). El mensaje de un paso sin firmantes dice cuál, dónde y cómo resolverlo. `FLUJO_FIRMA_CIERRE.md` §1 |

## Seguridad y permisos

| # | Antes | Ahora |
|---|---|---|
| 4 | «Completar» una tarea del flujo solo exigía `ot.ver` | Exige el permiso del paso (`flujo/permiso-paso.ts`): `config_json.permiso` del paso si existe; si no, aprobación → `resultado.aprobar`, control de calidad → `resultado.revisar`, registro/custodia/muestreo/almacén → `muestra.crear`, trabajo de laboratorio → `resultado.crear`, flujo comercial → `cotizacion.crear/aprobar/aceptar`. Además el rol responsable del paso (si lo define) y el alcance de la OT. La pantalla muestra «Sin permiso» en vez del botón (`permisoRequerido` en cada tarea) |
| 5 | Quien capturaba podía aprobar los controles de calidad, también los propios | Al registrar, un control que cumple queda **pendiente**; aprobarlo exige `resultado.revisar` y no ser quien lo registró (409). `aprobadoPor` ya no lo envía el cliente. Todas las acciones exigen el alcance de la OT (`qc/reglas-qc.ts`) |
| 6 | Abastecimiento podía emitir facturas y tocar «Parámetros del sistema» y «Centros de costo» | Permisos propios: `compra.ver` / `compra.gestionar` (proveedores y órdenes de compra) y `consumible.gestionar` (kardex). Abastecimiento pierde `factura.emitir`, `factura.ver` y `catalogo.gestionar`. Los demás roles conservan lo que veían (reciben `compra.*` / `consumible.gestionar` si tenían `factura.*` / `catalogo.gestionar`) |
| 7 | «Buscador de documentos» y «Reportes» mostraban todo | Alcance por laboratorio (`AlcanceService`): cada documento cuenta por su unidad (o la de su OT; los del SAEC, la de la OT de la evidencia o D11); en los reportes, OT, muestras, resultados y documentos por su OT, y cotizaciones por su OT o su centro de costo (`reportes/alcance-reportes.ts`). Jefaturas: su rama; perfiles globales: todo |
| 8 | El recuadro «Registrar OPI» aparecía a quien no podía registrarla | El aviso «OPI pendiente» se ve; el formulario solo con `ot.crear` (el permiso del endpoint) |

## Pantallas que engañaban

| # | Antes | Ahora |
|---|---|---|
| 9 | «Informes por oficializar» contaba registros del módulo antiguo de boletines | Cuenta los documentos **en firma** del ámbito y abre `/certificados?estado=en_firma` (lo que esa lista muestra). No duplica «Documentos por firmar», que son solo los que esperan la firma de uno |
| 10 | El buscador mostraba «en_firma» en verde | Rótulos legibles y color por estado: En firma (ámbar), Oficial (verde), Devuelto (rojo), Anulado (gris) (`lib/documentos.ts · estadoDocumento`) |
| 11 | «Reportes» abría en «Productividad» aunque el perfil no la viera | Solo se muestran las pestañas permitidas y abre en la primera (`reporte.ver` / `reporte.comercial.ver`) |
| 12 | Notas de crédito no se guardaban | `nota_credito` alineada como `factura`: disparador que copia `numero` en `codigo` y toma `tenant_id` de la factura |
| 13 | «Usuarios bloqueados» no contaba los bloqueos por intentos fallidos | Cuenta `estado = 'bloqueado'` o `intentos_fallidos >= AUTH_MAX_INTENTOS` (`auth/bloqueo.ts`). La lista de usuarios los marca «Bloqueado» (filtro «Bloqueados») y la ficha permite **Desbloquear** (`POST /usuarios/:id/desbloquear`, `admin.usuarios`) |
| 14 | El administrador solo podía cargar la imagen de firma de quien ya tenía una | «Cargar la firma de otro usuario» (Mi firma): cualquier usuario **activo** (`PUT /mi-firma/usuario/:id`, `admin.usuarios`; un usuario inactivo → 400) |

## Corrección de base incluida

- `resultado.tenant_id`: los resultados creados por la API lo dejaban vacío y el reporte de
  conformidad y el exportador no los contaban. Disparador `trg_resultado_tenant` (lo toma de la
  muestra) y relleno de los existentes.

## Decisiones que el IDIC debe confirmar (implementadas de la forma más simple y reversible)

- **Tipo de documento por unidad**: BPCH y toda su rama (sucursales, SCC y la Delegación Nº 11)
  emiten «Informe de inspección» por defecto. Se cambia por unidad con
  `UPDATE unidad SET tipo_documento_defecto = … WHERE codigo = …` (NULL = el de la plantilla).
  Quien emite puede elegir otro tipo en la pantalla.
- **QC**: un control que cumple su criterio queda pendiente de que otra persona lo apruebe (antes
  se aprobaba solo al registrarlo). Si el IDIC prefiere la aprobación automática, basta con que
  `resultadoAlRegistrar` devuelva la evaluación tal cual.
- **Permiso por paso del flujo**: deducido de la actividad mientras el diseñador de flujos no
  permita elegirlo; un paso puede fijarlo en `flujo_paso.config_json = {"permiso": "…"}`.
- **Reabrir**: lo pueden hacer las jefaturas (laboratorio, sección, departamento) y Dirección;
  anula también un documento ya **entregado** (avisa para comunicarlo al cliente). No se reabre en
  una OT cerrada (ya facturada).
- **Abastecimiento**: sin acceso a facturas ni a centros de costo (ni lectura). Las demás personas
  conservan lo que veían.

## Permisos nuevos

| Permiso | Roles |
|---|---|
| `resultado.reabrir` | SUPERADMIN, DIRECTOR, SUBDIRECTOR, JEFE_DEPTO, JEFE_SECCION, JEFE_LAB (+ alias JEFEDCO, JEFELAB) |
| `compra.ver` | quienes tenían `factura.ver` (salvo Abastecimiento, que lo recibe aparte) |
| `compra.gestionar` | quienes tenían `factura.emitir` + ABASTECIMIENTO |
| `consumible.gestionar` | quienes tenían `catalogo.gestionar` + ABASTECIMIENTO |
| retirados a ABASTECIMIENTO | `factura.emitir`, `factura.ver`, `catalogo.gestionar` |

Los permisos viajan en el token: hay que volver a iniciar sesión para verlos.
