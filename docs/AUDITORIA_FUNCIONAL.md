# Auditoría funcional · LIMS IDIC

**Fecha:** 2026-07-15
**Alcance:** aplicativo implementado (`apps/api/src/**`, `apps/web/app/**`) contra los documentos funcionales del proyecto.
**Entorno vivo auditado:** https://167.233.221.102.nip.io (usuario `admin`, rol SUPERADMIN).
**Naturaleza:** solo lectura de código. No se modificó ni desplegó nada. Sí se ejecutaron POST/PATCH/DELETE contra pre-producción para verificar comportamiento real (ver §8 · Artefactos de prueba).

---

## 1. Resumen ejecutivo

El aplicativo es un **CRUD amplio y bien construido sobre un modelo de datos correcto**, pero **no es todavía un LIMS**: falta la mayoría de la lógica de negocio que da valor al producto y faltan tres controles que son requisito de acreditación NCh-ISO/IEC 17025 y de pentesting.

Lo que está sólido: modelo Prisma (43 entidades), validación RUT módulo 11, cálculo de costeo Ejército CDT→CFA→CT, estadística de réplicas (promedio/DE/CV), veredicto contra límites, motor BPM (instanciar/avanzar/versionar), aislamiento por tenant en la mayoría de entidades, y el endurecimiento de seguridad de infraestructura (helmet, throttling, CORS, JWT sin fallback).

Lo que **no** está: **RBAC no se aplica** (los permisos viajan en el JWT pero ningún endpoint de negocio los comprueba), **la auditoría nunca se escribe** (la tabla existe y está vacía), **no existen equipos ni cadena de custodia**, **no hay motor de fórmulas**, **la cotización aceptada no genera la OT**, **no hay máquina de estados**, y **la emisión de informes ignora el contenido de la plantilla**.

Estimación honesta de cobertura sobre los 55 RF de nivel 2 del SRS (`Requerimientos_LIMS_IDIC_Aiuken.docx`), contando solo los 38 marcados `[MVP]`:

| Estado | RF `[MVP]` | % |
|---|---|---|
| Implementado | 6 | 16 % |
| Parcial | 19 | 50 % |
| Ausente | 13 | 34 % |

---

## 2. Método y evidencia

- **Documentos leídos:** `08_requerimientos\Requerimientos_LIMS_IDIC_Aiuken.docx` (229 códigos RF a 3 niveles: 55 de nivel 2 + 174 sub-requisitos, con etiquetas `[MVP]`/`[v2]`/`[Fase posterior]`/`[SAEC]`), `06_entregables_cliente\{RBAC_Roles_Permisos, Catalogo_Global_Parametrizacion, Modelo_Datos_Maestro, Datos_Poblados, Plantillas_Informes\00_Maestro}`, `04_flujos\matriz_flujos_lims_idic.xlsx` (18 flujos F01–F18), `02_diseno\motor_bpm_y_disenador.html`, y los prototipos aprobados `03_demos_html\demo_{lims_expediente_unificado, modulo_comercial, catalogo_laboratorio, disenador_flujos}.html`.
- **Código leído:** la totalidad de `apps/api/src` (21 archivos) y `apps/web/app` (31 pantallas).
- **Verificación en vivo:** login real, recorrido de 28 endpoints, y pruebas dirigidas de reglas de negocio (costeo, tasa 1,5 %, aceptación de cotización, emisión de informe, RBAC).

> **Advertencia sobre las fuentes.** `08_requerimientos\requerimientos_lims_idic.html` está **obsoleto y contradice al .docx**: solo tiene 47 RF sin sub-requisitos, inventa un `RF-A09` inexistente, omite el bloque `RF-K` (SAEC) completo y declara *"Excluido por acuerdo: módulo de Armas/DAM"*, lo que contradice frontalmente la sección 4.11 del .docx y la decisión vigente del proyecto. **Esta auditoría usa el .docx como fuente única.** Recomendación: regenerar o marcar el HTML como obsoleto antes de que alguien lo use para planificar.

---

## 3. Matriz de trazabilidad

Leyenda: ✅ Implementado · 🟡 Parcial · ❌ Ausente. Evidencia = archivo:símbolo o resultado HTTP real.

### 4.1 Clasificación y catálogo (parametrización)

| RF | Título | Alcance | Estado | Evidencia |
|---|---|---|---|---|
| **A01** | Árbol de clasificación | MVP | 🟡 | `catalogo.module.ts` GranGrupo+Grupo (2 niveles); el SRS pide Familia→Subfamilia→Grupo→Subgrupo (4). `GET /gran-grupos`→200 (12), `/grupos`→200 (205). A01.2 mover/reordenar ramas: ❌ no hay endpoint. A01.4 búsqueda: ✅ `base-crud.service.ts:listar` `?search` |
| **A02** | Tipos de muestra / producto | MVP | 🟡 | `laboratorio.module.ts:TipoMuestraController`. **`GET /tipos-muestra` → HTTP 500** (roto en vivo). A02.1 atributos configurables (texto/número/fecha/lista/booleano): ❌ no existe modelo de atributos. A02.3 obligatorios: ❌. A02.4 reglas de codificación/etiquetado: ❌ |
| **A03** | Ensayos (oferta comercial) | MVP | ❌ | **No existe la entidad Ensayo.** El Modelo de Datos Maestro define 1.367 ensayos (hoja `08 ENSAYOS`) y 635 relaciones Muestra–Ensayo (hoja `12`); no hay tabla ni endpoint. El modelo salta de `Metodo` a `Analito` |
| **A04** | Métodos (ficha, bloques 1-9) | MVP | 🟡 | `Metodo{codigo,nombre,norma,version,area,estado}`. A04.1 falta SOP/responsable/vigencia. A04.2 muestras aplicables ❌. A04.3 frecuencias/repeticiones ❌. A04.4 QC interno ❌. A04.5 documento emitido ❌. **A04.6 versionado inmutable ❌** — `version` es un `String` mutable vía `PATCH /metodos/:id` |
| **A05** | Parámetros / analitos | MVP | 🟡 | `Analito{codigo,nombre,unidad,formula}`. A05.1 tipo de dato ❌. A05.2 manual/calculado ❌. A05.3 orden de presentación ❌; nominal ✅ vía `NormaLimite.nominal` |
| **A06** | **Fórmulas de cálculo (editor seguro)** | MVP | ❌ | **`Analito.formula` es texto que nunca se evalúa.** No hay parser, ni editor, ni funciones (promedio/desv/mín/máx/redondeo), ni validación de sintaxis, ni sandbox. El Catálogo Global (hoja `10 Fórmulas`) especifica 14 fórmulas paramétricas; ninguna es ejecutable |
| **A07** | Especificaciones / límites | MVP | 🟡 | A07.1 mín/nominal/máx ✅ `NormaLimite`. **A07.2 override por cliente ❌** (`NormaLimite` tiene `producto`, no `clienteId`). **A07.3 doble límite alerta/acción ❌**. A07.4 conversión de unidades ❌ |
| **A08** | Gobierno de la parametrización | MVP | 🟡 | A08.1 desde interfaz ✅. **A08.2 auditado ❌** (§6.1). **A08.3 control por rol ❌** (§6.2) |

### 4.2 Comercial

| RF | Título | Alcance | Estado | Evidencia |
|---|---|---|---|---|
| **B01** | Gestión de clientes | MVP | 🟡 | B01.1 ✅ `common/rut.validator.ts:validaRut` (módulo 11). B01.2 ✅ `Contacto`+`Planta`. B01.3 ✅ `POST /clientes/:id/{bloquear,desbloquear}`; **doble firma ❌**. B01.4 historial ❌ |
| **B02** | Cotizaciones | MVP | 🟡 | B02.2 ✅ verificado en vivo: subtotal 2.058.823 → desc. 5 % → gastos 3 % → IVA 19 % → **total 2.397.324** (coincide con `demo_modulo_comercial.html`). **B02.3 estados: sin máquina de estados** — `PATCH /cotizaciones/:id {"estado":"ESTADO_INVENTADO_XYZ"}` → **200 aceptado**. B02.4 versiones ❌. B02.5 envío por oficio/correo ❌. B02.1 líneas desde el catálogo 🟡 (líneas libres; no hay catálogo de ensayos) |
| **B03** | **Costeo Ejército / FFAA** | MVP | 🟡 | `cotizacion/costeo.service.ts` ✅ íntegro y bien hecho. Verificado: `POST /cotizaciones/costeo` → `cdt 467.000, cfa 56.040 (12 %), ct 523.040, particular 627.648`. Coincide con `demo_lims_expediente_unificado.html:320-328`. **Pero no persiste**: el resultado no se guarda en `Cotizacion` y el wizard `/cotizaciones/nueva` no tiene `onClick` en «Guardar borrador» (`page.tsx:125`). Es una calculadora aislada |
| **B04** | **Orden de Trabajo (OT)** | MVP | 🟡 | **B04.1 ❌ CRÍTICO — verificado: OT antes=7, después de aceptar cotización=7.** `cotizacion.service.ts:aceptar` contiene `// TODO: disparar workflow F03 que crea la OT`. B04.2 OPI/OC del cliente ❌. B04.3 tipificar OT (FFAA/asesoría/particular, interna/externa) ❌. **B04.4 cierre escalonado ❌** |
| **B05** | Tasa 1,5 % (Ley 17.798) | MVP | 🟡 | B05.1–B05.3 ✅ `costeo.service.ts:tasaInternacion`. Verificado: CIF 10.000 USD × 970 → tasa 145.500 + IVA 27.645 = 173.145. Mejora sobre el prototipo (paridad parametrizada, no 970 hardcodeado). **B05.4 prorrateo a centros de costo ❌**. **B05.5 Comunicación Breve / carta de cobro ❌**. Falta el matiz *"% afecto"* del IVA que documenta `diagramas_flujo_lims.html` |
| **B06** | Facturación y cobranza | v2 | 🟡 | `facturacion.module.ts`: Factura/Pago/NotaCredito ✅. **Nota de débito ❌**. **Escalamiento 1°→2°→3°→Prejudicial→CDE ❌** (documentado en `demo_modulo_comercial.html` §2.8 y flujo F18). `GET /facturas` → 0 registros |
| **B07** | Seguimiento al cliente | v2 | ❌ | Encuesta de satisfacción y NPS: sin modelo ni endpoint |

### 4.3 Recepción, muestras y custodia

| RF | Título | Alcance | Estado | Evidencia |
|---|---|---|---|---|
| **C01** | Recepción de muestras | MVP | 🟡 | `Muestra{codigo,codigoBarras,ubicacion,estado}`. C01.1 el campo existe pero **no hay generación de código ni de etiqueta QR/barras**. C01.2 datos de muestreo (fecha/lote/procedencia/cantidad) ❌. C01.3 verificación contra lo cotizado ❌ |
| **C02** | **Cadena de custodia** | MVP | ❌ | **No existe modelo ni endpoint.** Requisito 17025 y hito 4.2.2/4.2.4 del pliego; flujo F05 completo (7 pasos) sin implementar. El prototipo lo promete con registro inmutable |
| **C03** | Asignación de trabajo | MVP | ❌ | `Muestra` no tiene analista, laboratorio, prioridad ni fecha compromiso. `OrdenTrabajo.prioridad` existe pero no hay asignación a analista/equipo. Flujo F06 sin implementar |
| **C04** | Alícuotas y submuestras | v2 | ❌ | Sin trazabilidad alícuota→muestra madre |

### 4.4 Ejecución analítica y resultados

| RF | Título | Alcance | Estado | Evidencia |
|---|---|---|---|---|
| **D01** | Captura de resultados | MVP | 🟡 | `laboratorio.module.ts:ResultadoService.capturar` + `apps/web/app/(app)/captura/page.tsx`. **D01.1 pantalla dinámica según los parámetros del método ❌** — la pantalla es fija (elegir muestra + analito + pegar réplicas). **D01.2 réplicas: sin tope de 10** (`z.array(z.number()).min(1)`, sin `.max(10)`). D01.3 validación de rango de captura ❌ |
| **D02** | Cálculo automático | MVP | 🟡 | **D02.1 aplicar la fórmula del analito ❌** (consecuencia de A06). **D02.2 promedio y desviación ✅** — `estadistica()` usa denominador n−1 (correcto), CV = s/\|m\|·100. Verificado en vivo: réplicas [510,512,514] → promedio 512, DE 2, CV 0,39. **D02.3 incertidumbre ❌** (el Catálogo especifica `U = k·u_c`, k=2) |
| **D03** | Evaluación del resultado | MVP | ✅ | `ResultadoService.veredicto()` compara contra `limiteInf`/`limiteSup` → Cumple / No cumple / Informativo. **Nota:** evita el bug del prototipo (`demo_catalogo_laboratorio.html:387`, cuyo regex `/cumple/i` matchea `"No cumple"` y siempre dictamina CUMPLE). 🟡 D03.1 «especificación vigente»: si no se pasa `productoLimite`, toma el **primer límite arbitrario** del analito (`findFirst` sin filtro) |
| **D04** | **Equipos y condiciones** | MVP | ❌ | **No existe modelo `Equipo`. `GET /api/equipos` → HTTP 404.** D04.2 (bloquear el registro si la calibración está vencida) es requisito 17025 y no existe. Los permisos `equipo.ver`/`equipo.gestionar` están sembrados en el RBAC pero no protegen nada. Flujo F14 sin implementar |
| **D05** | Control de calidad interno | v2 | ❌ | Blancos, duplicados, cartas de control, Westgard. Flujo F09 sin implementar |

### 4.5 Aprobación y firma (NCh-ISO/IEC 17025)

| RF | Título | Alcance | Estado | Evidencia |
|---|---|---|---|---|
| **E01** | **Aprobación escalonada** | MVP | ❌ | **No existe el flujo analista → jefe de laboratorio → jefe de departamento.** `Resultado` no tiene estado de revisión ni revisor. `PATCH /resultados/:id` permite editar el veredicto directamente sin control. Flujos F10/F11 sin implementar |
| **E02** | Firma electrónica | MVP | 🟡 | `rbac.module.ts:FirmaService` + `Firma{usuarioId,imagenRef,hashSha256}` (upsert por usuario). E02.2 hash del documento ✅ `plantilla-render.service.ts` SHA-256. **E02.1 sello de tiempo: `registradaAt` fecha el alta de la firma del usuario, no el acto de firmar el documento.** **E02.3 no repudio ❌ — no existe tabla que vincule firmante ↔ documento firmado.** No se puede demostrar quién firmó qué |
| **E03** | Reapertura de OT | v2 | ❌ | Sin reapertura, anulación de certificado ni traza |

### 4.6 Certificados e informes

| RF | Título | Alcance | Estado | Evidencia |
|---|---|---|---|---|
| **F01** | Generación de documentos | MVP | 🟡 | `plantilla-render.service.ts`. **F01.1 la plantilla NO se usa**: `previsualizar()` construye un `const base` **hardcodeado** (`<h2>${plantilla.nombre}</h2>…`) e ignora el contenido real. Verificado en vivo: emitir con la plantilla `CASPT` devuelve el mismo HTML genérico. Las 114 plantillas de la BD son cáscaras con nombre. F01.2 inyección de datos 🟡 (solo 6 escalares + tabla de resultados; el prototipo mapea 12 placeholders). **F01.3 PDF/A ❌** — devuelve HTML |
| **F02** | Numeración | MVP | ❌ | **F02.1 el correlativo del certificado lo aporta el llamador de la API** (`emitir(otId, plantillaId, codigo, tenantId)`), no lo genera el sistema. Para COT/OT sí hay `generarCodigo()` pero con **condición de carrera** (read-then-write sin transacción ni secuencia) y orden lexicográfico que rompe al pasar de 9999. F02.2 código de formato SGC ❌ |
| **F03** | Editor de plantillas | v2 | ❌ | — |
| **F04** | Entrega | MVP | ❌ | F04.1 firma digital del documento final 🟡 (hash, sin firmante). **F04.2 envío al cliente ❌**. F04.3 portal (v2) ❌ |

### 4.7 Motor de flujos (BPM)

| RF | Título | Alcance | Estado | Evidencia |
|---|---|---|---|---|
| **G01** | Ejecución de flujos | MVP | 🟡 | `flujo/flujo.service.ts` — buen motor. G01.1 ✅ `POST /ot/:id/flujo` + instanciación en `POST /ot`. G01.2 ✅ `avanzarDesde`/`resolverSiguiente` + `evaluarCondicion` (evaluador seguro sin `eval`, correcto). **G01.3 asignar responsable por paso ❌** — `avanzarDesde` asigna **todas** las tareas a `instancia.iniciadoPor`, ignorando `responsable_rol_id`. **G01.4 SLA y alertas ❌** — `venceAt` se calcula y se guarda, pero **no hay job que lo vigile** (no hay BullMQ ni escalamiento) |
| **G02** | Configuración de flujos | MVP | ✅ | G02.1 ✅ flujos como datos. G02.3 ✅ `guardarBorrador` + `publicar` (archiva la anterior). Validaciones correctas (exactamente 1 INICIO, ≥1 FIN). **Salvedad:** los 18 flujos F01–F18 de `matriz_flujos_lims_idic.xlsx` **no están importados**; en la BD hay 13 flujos `FLU-*` distintos (FLU-ALI, FLU-BAL, FLU-COM…). El importador Python que especifica `motor_bpm_y_disenador.html` no existe |
| **G03** | **Bandejas de tareas** | MVP | ❌ | `GET /flujos/tareas/bandeja` existe y responde 200 `[]`, pero **G03.1 filtra por usuario, no por rol** (consecuencia de G01.3) y **no hay pantalla en el front** (no existe `apps/web/app/(app)/bandeja` ni equivalente). G03.2 alertas ❌. G03.3 reasignación ❌ |
| **G04** | Diseñador visual no-code | v2 | 🟡 | `apps/web/app/(app)/flujos/page.tsx` (266 líneas): editor tabular de pasos/transiciones, no lienzo BPMN. **Está roto en el navegador: hace `fetch(\`${API}/flujos\`)` sin cabecera `Authorization` → verificado `GET /api/flujos` sin token → HTTP 401.** Sin bpmn-js, sin BPMN XML, sin arrastrar y soltar, sin simulador |

### 4.8 Administración, seguridad y auditoría

| RF | Título | Alcance | Estado | Evidencia |
|---|---|---|---|---|
| **H01** | Autenticación | MVP | ✅ | H01.1 🟡 `auth/ldap.strategy.ts` existe (no verificable sin AD). H01.2 ✅ JWT + argon2. H01.3 ✅ `POST /auth/refresh`. `logout` es un no-op (`// TODO: invalidar refresh tokens en Redis`) |
| **H02** | **Control de acceso (RBAC)** | MVP | 🟡 | Los **datos** están completos y bien: 13 roles × 36 permisos sembrados, coincide con `RBAC_Roles_Permisos_LIMS_IDIC_Aiuken.xlsx` (38 permisos en el Excel; 36 en la BD). `PermisoGuard` está correctamente escrito. **Pero solo se aplica en un controlador (`/permisos`).** Ver §6.2 — es el hallazgo más grave |
| **H03** | Doble factor | v2 | ❌ | `Usuario.totpSecret` existe; sin flujo TOTP |
| **H04** | **Auditoría** | MVP | ❌ | El modelo `AuditLog` existe en `schema.prisma:307` (particionado por mes). **`grep -rn "auditLog" apps/` → 0 coincidencias: nunca se escribe una sola fila.** `GET /api/auditoria` y `/api/audit` → **404**. H04.1, H04.2 (valor anterior/posterior) y H04.3 (consulta/exportación): ausentes |
| **H05** | Multi-sede (tenant) | MVP | 🟡 | Buen trabajo general: `base-crud.service.ts:tenantWhere` + validación de pertenencia con 404 (no 403) para no revelar existencia. **Pero `Analito`, `NormaLimite`, `Resultado`, `Firma` y `Permiso` no tienen `tenant_id`** (`schema.prisma:756-800`) y sus servicios usan `tenant:false` → ver §6.3 |

### 4.9 BI y reportería

| RF | Título | Alcance | Estado | Evidencia |
|---|---|---|---|---|
| **I01** | Tableros de gestión | MVP | 🟡 | `apps/web/app/(app)/dashboard/page.tsx` (84 líneas, KPIs de conteo). I01.1 carga por laboratorio ❌, I01.2 cumplimiento SLA ❌, I01.3 facturación/cobranza ❌. El demo comercial especifica el desglose de tiempo medio por etapa (ciclo 14,2 d) y las vistas `v_cotizaciones_estado`, `v_ot_sla`, `v_facturacion_mensual`: no existen |
| **I02** | BI externa (Metabase) | MVP | ❌ | Sin evidencia en el repositorio (no está en `docker-compose.prod.yml`) |
| **I03** | Exportación Excel/CSV | MVP | ❌ | Sin endpoint de exportación |

### 4.10 Migración de datos · `[Fase posterior]`

`RF-J01`–`J03` ❌. Hay material en `scripts/_migration/`. **Fuera del alcance MVP** — no se computa como brecha.

### 4.11 SAEC · Armas, Evidencias y Certificados · `[SAEC · track aparte]`

`RF-K01`–`K09` (9 RF / 30 sub-requisitos) ❌ **en su totalidad**. Solo existe el flujo `FLU-BAL · Flujo OT · Balística / Evidencias (SAEC)` como definición vacía. No hay casos, elementos, importación XML ESI v3.2 desde IBIS, banco de evidencias, préstamo/devolución, ni verificación pública de certificados.

> **Aviso de alcance.** `matriz_flujos_lims_idic.xlsx` (hoja `04 · Cobertura pliego`) marca el hito **4.2.6 IBIS como "Diferido Fase 2"**, mientras el SRS lo especifica en detalle (RF-K03, Anexo C, ESI v3.2) y la decisión vigente del proyecto es que **Armas NO está excluido**. Esta contradicción debe resolverse con el cliente por escrito: son ~30 sub-requisitos de diferencia.

---

## 4. Cobertura por módulo

| Módulo | Cobertura | Comentario |
|---|---|---|
| **Comercial · clientes/contactos** | 🟢 75 % | Lo más maduro. RUT módulo 11, bloqueo/desbloqueo, plantas, contactos |
| **Comercial · cotización + costeo Ejército** | 🟡 50 % | El cálculo CDT→CFA→CT es correcto y fiel al prototipo, **pero vive desconectado**: no se persiste, y la cotización real usa el otro modelo (descuento/gastos admin). Sin máquina de estados |
| **Comercial · listas de precio** | 🟢 70 % | `ListaPrecio` + `ListaPrecioItem` CRUD (5 registros) |
| **Comercial · facturación/cobranza** | 🔴 30 % | Factura/Pago/NotaCredito existen; falta nota de débito y **todo el escalamiento a CDE** |
| **Comercial · compras/viáticos/CC** | 🔴 25 % | Modelos ✅, pero **`GET /ordenes-compra`, `/viaticos` y `/centros-costo` → HTTP 500** en vivo |
| **CRM / oportunidades** | 🟢 70 % | `crm.module.ts` completo: ganar/perder/convertir. 6 oportunidades. No es un RF del SRS (extensión) |
| **LIMS · OT / expediente 14 fases** | 🔴 20 % | Ver §5.4. El stepper está **hardcodeado en el front y con fases distintas a las aprobadas** |
| **LIMS · muestras** | 🟡 40 % | CRUD ✅; sin custodia, sin asignación, sin etiquetado |
| **LIMS · métodos/analitos/límites** | 🟡 45 % | CRUD ✅; sin versionado, sin fórmulas, sin doble límite |
| **LIMS · captura RN → promedio/DE/CV → veredicto** | 🟡 55 % | La estadística y el veredicto son correctos; **falta el motor de fórmulas y la incertidumbre** |
| **LIMS · plantillas / informes / HASH** | 🔴 25 % | Hay HASH SHA-256 y registro de Certificado; **la plantilla no se usa y no hay PDF/A ni correlativo** |
| **LIMS · certificados / firma** | 🔴 20 % | Sin aprobación escalonada, sin vínculo firmante↔documento |
| **Flujos no-code · motor** | 🟢 65 % | Buen motor. Falta asignación por rol, SLA activo y automatismos |
| **Flujos no-code · diseñador** | 🔴 15 % | Editor tabular **roto por falta de token**; sin lienzo BPMN |
| **Flujos no-code · bandeja de tareas** | 🔴 10 % | Endpoint sí, pantalla no, filtrado por rol no |
| **Parametrización / catálogo** | 🟡 40 % | Gran Grupo→Grupo ✅ (12/205); **sin entidad Ensayo → el eje "Análisis" del modelo de dos ejes no existe** |
| **RBAC / usuarios / roles / permisos** | 🔴 35 % | Datos ✅ · **enforcement ❌** |
| **Auditoría / trazabilidad** | 🔴 5 % | Tabla vacía, nunca escrita, sin endpoint |

### 4.1 Volumetría sembrada vs. `Datos_Poblados_LIMS_IDIC_Aiuken.xlsx`

| Entidad | Esperado | En vivo | ¿Coincide? |
|---|---|---|---|
| Gran Grupo | 12 | 12 | ✅ |
| Grupo | 206 | 205 | 🟡 −1 |
| Plantillas | 117 | 114 | 🟡 −3 |
| **Métodos** | 1.749 (o 242 en el Modelo Maestro) | **136** | ❌ |
| **Analitos** | 11.827 (o 3.462) | **272** | ❌ 2 % |
| **Ensayos** | 7.676 (o 1.367) | **0 — no existe la tabla** | ❌ |
| Muestras | 23.925 | 14 | ❌ (migración = fase posterior) |
| Clientes | — | 8 | — |
| Cotizaciones / Facturas | — | 0 / 0 | — |

> El número de plantillas no concilia entre fuentes: **115** (portada del Maestro) / **117** (Datos Poblados) / **~119** (catálogo) / **114** (en vivo). Hay que fijar la cifra.

---

## 5. Brechas funcionales priorizadas

### 5.1 🔴 CRÍTICA — El RBAC no se aplica en ningún endpoint de negocio

**Qué falta:** `PermisoGuard` está bien implementado y los 36 permisos viajan en el JWT, pero **solo `PermisoController` lo usa**. Todos los demás controladores usan `@UseGuards(AuthGuard("jwt"))` a secas: cualquier usuario autenticado puede hacer cualquier cosa.

**Verificado en vivo** (usuario `qa_audit_lector` con rol `LECTOR`, cuyo JWT solo contiene permisos `*.ver`):

| Acción | Permiso requerido | ¿Lo tiene? | Resultado real |
|---|---|---|---|
| `DELETE /api/cotizaciones/:id` | — | no | **HTTP 200 · cotización anulada** |
| `POST /api/resultados` | `resultado.crear` | **no** | **HTTP 201 · resultado creado con veredicto "Cumple"** |
| `GET /api/usuarios` | `admin.usuarios` | **no** | **HTTP 200 · listado completo** |
| `POST /api/informes/previsualizar` | `certificado.emitir` | **no** | **HTTP 201** |

**Impacto:** un analista puede firmar/emitir; un lector puede fabricar resultados analíticos. Rompe la separación de deberes que exige NCh-ISO/IEC 17025 (el propio Excel RBAC reserva `resultado.aprobar` y `certificado.firmar` a SUPERADMIN/DIRECTOR/JEFE_LAB). **Es un hallazgo de pentesting de severidad alta (broken access control, OWASP A01).**

**Dónde implementarlo:** añadir `PermisoGuard` + `@RequierePermiso(...)` a los ~20 controladores. Como los CRUD heredan las rutas de `BaseCrudController`, conviene parametrizar el permiso por verbo en la clase base (p. ej. un `@RequierePermisoCrud("cliente")` que mapee GET→`cliente.ver`, POST→`cliente.crear`, PATCH→`cliente.editar`, DELETE→`cliente.eliminar`) y decorar cada subclase. Archivos: `apps/api/src/common/base-crud.controller.ts` + todos los `*.module.ts`/`*.controller.ts`.

### 5.2 🔴 CRÍTICA — La auditoría nunca se escribe (RF-H04, RNF-02)

**Qué falta:** la tabla `audit_log` existe y está particionada, pero no hay una sola escritura en todo `apps/api`. No hay endpoint de consulta (`/api/auditoria` → 404). No se registra valor anterior/posterior, ni IP.

**Impacto:** sin bitácora inmutable no hay acreditación 17025 (RNF-02) y no hay forense tras un incidente. El propio `demo_modulo_comercial.html` lo declara *"gap crítico"* del legacy y promete construirlo "desde día 1".

**Dónde implementarlo:** interceptor global Nest (`apps/api/src/common/audit.interceptor.ts`) registrado en `app.module.ts` como `APP_INTERCEPTOR`, que capture usuario (`req.user.sub`), acción, entidad, `before`/`after` e IP para todo POST/PATCH/DELETE; más un `AuditController` con `audit.ver` para consulta/exportación. La escritura debe ser append-only (revocar UPDATE/DELETE a nivel de rol PostgreSQL).

### 5.3 🔴 CRÍTICA — La cotización aceptada no genera la OT (RF-B04.1)

**Qué falta:** `cotizacion.service.ts:aceptar()` cambia el estado y devuelve el mensaje *"OT se generará automáticamente"*, pero contiene literalmente `// TODO: disparar workflow F03 que crea la OT`. **Verificado: OT antes = 7, después = 7.**

**Impacto:** se rompe la cadena central del negocio (Cotización → OT → Expediente), que es el hito 4.1.5 del pliego, el flujo F03 y la fase 3→4 del prototipo aprobado. Hoy la OT solo se crea a mano.

**Dónde implementarlo:** `apps/api/src/cotizacion/cotizacion.service.ts:aceptar()` — inyectar `FlujoService` + creación de OT dentro de una transacción, replicando `onCotizacionAceptada` de `02_diseno/motor_bpm_y_disenador.html`: `resolverFlujoPlantilla({laboratorio, tipoEnsayo})` → crear `OrdenTrabajo` con correlativo → `flujos.instanciar(versionId, {otId})`. Cuidado con la dependencia circular `CotizacionModule ↔ OtModule`.

### 5.4 🔴 CRÍTICA — No hay máquina de estados en ninguna entidad

**Qué falta:** `Cotizacion.estado`, `OrdenTrabajo.estado` y `Muestra.estado` son strings libres. **Verificado: `PATCH /cotizaciones/:id {"estado":"ESTADO_INVENTADO_XYZ"}` → 200.** `ActualizarCotSchema` valida `z.string().min(1).max(20)`, sin enum ni validación de transición.

`matriz_flujos_lims_idic.xlsx` (hoja `03 · Estados`) especifica **4 dominios y 30 estados** con transiciones exactas:
- **Solicitud** (SOL-01..05): BORRADOR → ENVIADA → EN_COTIZACION → COTIZADA → ACEPTADA *(dispara OT.RECEPCIONADA)*; salidas a RECHAZADA / CANCELADA / EXPIRADA.
- **OT** (OT-01..10): RECEPCIONADA → EN_PREPARACION → EN_ANALISIS → EN_REVISION → APROBADA → INFORMADA → CERRADA; ramas OBSERVADA, DEVUELTA y BLOQUEADA (desde cualquier estado, retorna al origen).
- **Muestra** (MTR-01..08): PENDIENTE → RECIBIDA → ALMACENADA → EN_PREPARACION → EN_ANALISIS → ANALIZADA → TESTIGO → DESCARTADA.
- **Factura** (FAC-01..07): EMITIDA → PAGADA | EMITIDA → AVISO_1 → AVISO_2 → AVISO_3 → PREJUDICIAL → CDE.

**Impacto:** cualquier cliente de la API (o un atacante autenticado) puede saltarse el proceso completo: marcar una OT como CERRADA sin análisis, o una factura como PAGADA.

**Dónde implementarlo:** `apps/api/src/common/estado-machine.ts` con las 4 tablas de transición; invocarlo en `cotizacion.service.ts:cambiarEstado`, `ot.controller.ts:actualizar` y el servicio de facturas. Los enums deben además reemplazar el `z.string()` de los DTO.

### 5.5 🔴 CRÍTICA — No existe el motor de fórmulas (RF-A06, RF-D02.1)

**Qué falta:** `Analito.formula` es texto muerto. El SRS pide editor con variables = analitos del método (`(lf-li)/lf*100`), funciones (promedio, desviación, mín, máx, redondeo), validación de sintaxis, vista previa y **ejecución en sandbox**. El Catálogo Global especifica 14 fórmulas (`ppm = (C·F·100)/g`, `IP = (V·N·1000)/m`, `NaCl(%) = (V·N·5,844)/m`, `σ = F_máx/A`…). Hoy solo se calcula promedio/DE/CV de las réplicas — que es un paso **anterior** a la fórmula, no un sustituto.

**Impacto:** sin esto el LIMS no calcula ningún resultado analítico real; solo promedia lecturas. Es la diferencia entre una hoja de cálculo y un LIMS.

**Dónde implementarlo:** `apps/api/src/laboratorio/formula.service.ts` con un parser AST seguro (recomendado `jsep` + evaluador propio, o `expr-eval`; **no** `eval`/`Function`, y **no** `vm2` que está deprecado por CVEs). Integrar en `ResultadoService.capturar()` entre `estadistica()` y `veredicto()`. Nótese el riesgo de contenido: el Modelo de Datos Maestro (hoja `15 Vacíos`) declara **3.118 de 3.459 analitos sin fórmula** y **1.364 de 1.364 ensayos sin norma/fórmula**, todo pendiente de los jefes de laboratorio.

### 5.6 🔴 CRÍTICA — No existen equipos ni bloqueo por calibración (RF-D04)

**Qué falta:** modelo `Equipo` completo. `GET /api/equipos` → 404. D04.2 exige **bloquear el registro de un resultado si la calibración del equipo está vencida** — control 17025 nuclear. Los permisos `equipo.ver`/`equipo.gestionar` ya están sembrados pero no protegen nada.

**Dónde implementarlo:** nuevo modelo `Equipo{codigo,nombre,laboratorioId,fechaCalibracion,vigenciaHasta,estado}` en `packages/db/prisma/schema.prisma`; `apps/api/src/laboratorio/equipo.module.ts`; y `equipoId` obligatorio en `Resultado` con validación de vigencia en `ResultadoService.capturar()`. Flujo F14 (calibración y mantención) queda habilitado con esto.

### 5.7 🔴 CRÍTICA — No existe cadena de custodia (RF-C02)

**Qué falta:** modelo y endpoints. C02.1 quién/cuándo/dónde por muestra, C02.2 transferencias entre responsables, C02.3 retención y disposición final. Requisito 17025, hito 4.2.2/4.2.4, flujo F05.

**Dónde implementarlo:** modelo `CustodiaMovimiento{muestraId,tipo,deUsuarioId,aUsuarioId,ubicacion,timestamp,motivo}` append-only + `apps/api/src/laboratorio/custodia.module.ts` con permiso `muestra.transferir` (ya sembrado).

### 5.8 🔴 CRÍTICA — No existe la aprobación escalonada (RF-E01) ni el no repudio (RF-E02.3)

**Qué falta:** el circuito analista → jefe de laboratorio → jefe de departamento, con rechazo motivado y devolución al paso anterior. `Resultado` no tiene estado de revisión ni revisor, y `PATCH /resultados/:id` permite cambiar el veredicto a mano sin control. **No existe tabla que vincule firmante ↔ documento firmado**: `Firma` es la firma-imagen del usuario, no el acto de firmar.

**Dónde implementarlo:** `Resultado.estadoRevision` + `DocumentoFirma{certificadoId,usuarioId,rolEnFirma,firmadoAt,hashDocumento}`; endpoints `POST /resultados/:id/{revisar,aprobar,devolver}` y `POST /certificados/:id/firmar` protegidos por `resultado.revisar`/`resultado.aprobar`/`certificado.firmar`. Flujos F10/F11.

### 5.9 🟠 ALTA — La emisión de informes ignora la plantilla y no produce PDF/A

`plantilla-render.service.ts:previsualizar()` construye un `const base` hardcodeado y **nunca lee el contenido de la plantilla**. Verificado en vivo: emitir con `CASPT` devuelve el HTML genérico. `PlantillaInforme` ni siquiera tiene columna de contenido (solo `archivoRef`). Falta PDF/A (F01.3) y falta el mapeo de los 12 placeholders del prototipo (hoy hay 6 escalares).

**Dónde:** añadir `PlantillaInforme.contenidoHtml`; cargar los 114 formatos reales; sustituir `base` por `plantilla.contenidoHtml`; PDF/A con Puppeteer/Gotenberg (sin licencia, cumple RNF-05).

### 5.10 🟠 ALTA — Cinco endpoints devuelven HTTP 500 en producción

`GET /tipos-muestra`, `/certificados`, `/ordenes-compra`, `/viaticos`, `/centros-costo` → **500**. Es el mismo patrón de deriva esquema Prisma ↔ BD que `SECURITY_AUDIT.md` documenta como "Corregido en parte" (hallazgo #2): `base-crud.service.ts` emite `WHERE deleted_at IS NULL` o un `include` contra columnas que no existen. Cinco de las 31 pantallas del front están muertas.

**Dónde:** conciliar `packages/db/prisma/schema.prisma` con la BD real (`packages/db/align_schema_to_prisma.sql`) y revisar los flags `softDelete`/`tenant`/`include` de cada `CrudOpts`.

### 5.11 🟠 ALTA — Fuga cross-tenant en resultados, analitos, límites y firmas

`Analito`, `NormaLimite`, `Resultado`, `Firma` y `Permiso` **no tienen `tenant_id`** (`schema.prisma:756-800`) y sus servicios declaran `tenant: false`. Consecuencia: `GET /resultados` devuelve los resultados analíticos **de todos los tenants**, y `ResultadoController.crear` no valida que `muestraId`/`analitoId` pertenezcan al tenant del solicitante (ni siquiera recibe `@Req`: llama a `capturar(dto)` con `tenantId = DEV_TENANT` por defecto).

Contradice RF-H05.1 ("aislamiento de datos por sede") y es un hallazgo de pentesting. El resto del código hace un trabajo cuidadoso de aislamiento —lo que hace estas cinco excepciones más peligrosas, porque el patrón general invita a confiar.

**Dónde:** añadir `tenant_id` a las cinco tablas + migración; quitar `tenant:false`; y en `ResultadoService.capturar` validar pertenencia de `muestraId`/`analitoId`.

### 5.12 🟠 ALTA — El expediente de 14 fases no coincide con el prototipo aprobado y está hardcodeado

`apps/web/app/(app)/ot/[id]/page.tsx:10-14` define 14 fases **hardcodeadas en el front**:
`Recepción, Registro, Asignación, Preparación, Análisis, Captura RN, Cálculo, Validación técnica, Revisión, Aprobación, Emisión informe, Firma, Entrega, Cierre`

El prototipo **aprobado por el cliente** (`demo_lims_expediente_unificado.html`, `const FASES`) define otras 14:
`Solicitud, Cotización, Aprobación cotización, Orden de Trabajo, Recepción de muestras, Cadena de custodia, Preparación, Ejecución de ensayos, Revisión técnica, Aprobación y firma, Emisión informe/certif., Envío al cliente, Facturación, Cierre y encuesta`

Coincide el número, no el contenido: **el implementado pierde las 3 fases comerciales, custodia, envío y facturación**. Además:
- No hay paneles por fase (el prototipo define campos concretos para las 14).
- No hay gating por rol (el prototipo: `puede = (rol==='admin' || fa.rol===rol)`, con todo `disabled` si no).
- No hay `faseAplica()` (Interno salta 0–2 y 12–13; Calibración salta 0–2 y 6).
- Las pestañas «Resultados» e «Informe» son texto que remite a otra pantalla.
- **Arquitectónicamente contradice el diseño aprobado del motor**: `motor_bpm_y_disenador.html` establece que *"la OT no es una entidad separada — es la `flujo_instancia`"* y que las fases salen de `flujo_paso` para que *"la UI de las OT cambie automáticamente"* al editar el flujo. El stepper hardcodeado es lo contrario.

### 5.13 🟠 ALTA — El diseñador de flujos está roto en el navegador

`apps/web/app/(app)/flujos/page.tsx` hace las 6 llamadas a la API **sin cabecera `Authorization`**. Verificado: `GET /api/flujos` sin token → **401**. La pantalla no carga nada. Causa: `SECURITY_AUDIT.md` hallazgo #5 añadió el guard a `FlujoController` (correcto) pero no se actualizó el front, que quedaba fuera de aquel alcance.

**Dónde:** `apps/web/app/(app)/flujos/page.tsx` — usar el helper `auth()` que ya emplean las demás pantallas.

### 5.14 🟡 MEDIA — Costeo Ejército sin persistencia y desconectado de la cotización

Coexisten dos modelos de costo sin puente:
- `POST /cotizaciones/costeo` → CDT → CFA → CT → 3 precios (**calculadora pura, no persiste**).
- `POST /cotizaciones` → subtotal → descuento % → gastos admin % → IVA (**el que sí se guarda**).

Ninguno de los campos CDT/CFA/CT existe en el modelo `Cotizacion`. El botón «Guardar borrador» del wizard (`cotizaciones/nueva/page.tsx:125`) **no tiene `onClick`**. Es decir, el costeo Ejército —RF-B03, el diferenciador del cliente— **no se puede guardar**.

Nota: esta dualidad **viene de los propios prototipos aprobados**, que se contradicen entre sí (§7). Requiere decisión del cliente antes de codificar.

### 5.15 🟡 MEDIA — Numeración con condición de carrera

`ot.controller.ts:generarCodigo()` y `cotizacion.service.ts:generarCodigo()` hacen read-then-write sin transacción ni bloqueo: dos peticiones concurrentes generan el mismo correlativo (mitigado solo por `@@unique([tenantId, codigo])`, que producirá un 500 al segundo). Además `orderBy: { codigo: "desc" }` es orden lexicográfico: `OT-2026-10000` < `OT-2026-9999`. Y `CotizacionService.generarCodigo()` **no filtra por tenant**, así que el correlativo de cotizaciones es global entre sedes.

**Dónde:** secuencia PostgreSQL por (tenant, serie, año) o `SELECT … FOR UPDATE` en transacción. Cubre además RF-F02.1.

### 5.16 🟡 MEDIA — Los 18 flujos del pliego no están cargados

La BD tiene 13 flujos `FLU-*` (por laboratorio) publicados; `matriz_flujos_lims_idic.xlsx` define **18 flujos F01–F18** con pasos, SLA, roles y trazabilidad a hitos del pliego. `motor_bpm_y_disenador.html` especifica un importador Python `xlsx → flujo_def + flujo_paso + flujo_transicion` que **no existe en el repositorio**. La bandeja está vacía porque ninguna OT tiene flujo activo.

### 5.17 🟡 MEDIA — Los pasos AUTO no ejecutan nada

`flujo.service.ts:avanzarDesde` marca los pasos `AUTO` como `completado` inmediatamente, con el comentario *"hook de automatismos"* — pero no hay hook. Los pasos AUTO del pliego incluyen «Calcular fórmula del método», «Verifica equipo operativo» y «Audit log de la captura» (flujo F08). Hoy son no-ops que el motor atraviesa sin efecto.

Relacionado: `resolverSiguiente()` tiene un fallback discutible — si ninguna condición se cumple, devuelve **la última transición** en vez de fallar. Un flujo mal configurado avanza silenciosamente por la rama equivocada en vez de dar error.

### 5.18 🟡 MEDIA — SLA calculado pero nunca vigilado (RF-G01.4, G03.2)

`TareaAsignada.venceAt` se calcula al crear la tarea y `PasoEjecucion.excedioSla` se computa **a posteriori** al completarla. No hay job, cola ni scheduler: nada detecta un SLA vencido en tiempo real ni escala a `escalamiento_a_rol_id`. El diseño aprobado especifica BullMQ con `programarTimeoutSLA`. `docker-compose.prod.yml` incluye Redis, pero la API no lo usa.

### 5.19 🔵 BAJA — Otros

- `formato` de cotización es `z.enum(["F1","F2","F3","F4"])`; el demo comercial define **6** (F1–F6, incluyendo F5 Civil/Particular y F6 Ministerio Defensa).
- `auth.service.ts:logout()` es un no-op (`// TODO: invalidar refresh tokens en Redis`): el refresh token sigue vivo tras cerrar sesión.
- `D01.2` no limita las réplicas a 10 (`z.array(z.number()).min(1)` sin `.max(10)`).
- `RBAC_…xlsx` define 38 permisos; en la BD hay 36. Faltan 2 por conciliar.
- `Rol.CLIENTE` está marcado "(deprecado)" en el Excel pero sembrado en la BD.
- No hay pantallas para: bandeja de tareas, auditoría, cobranza/avisos, cadena de custodia, equipos, encuestas.

---

## 6. Reglas de negocio no implementadas · resumen

| # | Regla | Fuente | Estado |
|---|---|---|---|
| 1 | **Fórmulas de analito** (14 paramétricas: `ppm=(C·F·100)/g`, `IP=(V·N·1000)/m`, `σ=F_máx/A`…) | Catálogo Global hoja 10 | ❌ texto muerto |
| 2 | **Incertidumbre `U = k·u_c`** (k=2, 95 %) | Catálogo hoja 10 · RF-D02.3 | ❌ |
| 3 | Promedio + **DE muestral (n−1)** + CV | Prototipo · RF-D02.2 | ✅ correcto |
| 4 | **Veredicto** Cumple/No cumple/Informativo vs límite | RF-D03.2 | ✅ (evita el bug del prototipo) |
| 5 | **Doble límite** alerta / acción | RF-A07.3 | ❌ |
| 6 | **Override de límite por cliente** | RF-A07.2 | ❌ |
| 7 | **Costeo `CDT → CFA → CT`** + 3 precios | RF-B03 · prototipo | 🟡 calcula, no persiste |
| 8 | **Tasa 1,5 % = CIF × paridad × 0,015**, + IVA 19 % | RF-B05 · Ley 17.798 | 🟡 falta «% afecto» |
| 9 | **Prorrateo de la tasa a centros de costo** (Sucursal Santiago / DTCG / SDBPCH) | RF-B05.4 | ❌ |
| 10 | **IVA 19 %** sobre neto | RF-B02.2 | ✅ |
| 11 | Descuento institucional 5 % + gastos admin 3 % | demo comercial | ✅ |
| 12 | **Máquina de estados** Cotización (5) / OT (10) / Muestra (8) / Factura (7) | matriz hoja 03 | ❌ string libre |
| 13 | **Cotización aceptada → genera OT** | RF-B04.1 · F03 | ❌ TODO en código |
| 14 | **Escalamiento cobranza** 1°→2°→3°→Prejudicial→CDE | RF-B06.3 · F18 | ❌ |
| 15 | **Numeración correlativa por serie y año** | RF-F02.1 | 🟡 con carrera; ausente en certificados |
| 16 | **Versionado inmutable de métodos** | RF-A04.6 · F16 | ❌ |
| 17 | **Versionado de plantillas** | Maestro Plantillas | ❌ (`version` string) |
| 18 | **Versionado de flujos** (v2.1 para OT nuevas; en curso siguen v2.0) | RF-G02.3 · diseñador | ✅ |
| 19 | **Aprobación escalonada** analista→jefe lab→jefe depto | RF-E01 | ❌ |
| 20 | **HASH SHA-256** del documento + código de verificación | RF-E02.2 · K07.2 | ✅ |
| 21 | **No repudio** (firmante ↔ documento) | RF-E02.3 | ❌ |
| 22 | **Bloqueo por calibración vencida** | RF-D04.2 | ❌ |
| 23 | **Bloqueo comercial por morosidad** (no cotizar/OT si moroso) | demo · B01.3 | 🟡 flag sí, regla no |
| 24 | **RUT módulo 11** | RF-B01.1 | ✅ |
| 25 | **SLA + escalamiento automático** | RF-G01.4 | ❌ |
| 26 | Réplicas máx. 10 | RF-D01.2 | ❌ sin tope |

---

## 7. Contradicciones en la documentación fuente

**No son brechas de código: son decisiones pendientes del cliente.** Codificar sin resolverlas genera retrabajo.

1. **Dos modelos de costeo incompatibles entre prototipos aprobados.** Expediente: `CDT → CFA% → CT → margen% → ×1.19 + tasa`. Comercial: `Subtotal → descuento 5 % → gastos admin 3 % → IVA 19 %`. No comparten vocabulario. **El código implementa los dos, sin puente.** ¿Cuál es el contrato?
2. **El demo comercial se contradice a sí mismo:** COT-2026-0945 aparece como `$2.450.000` en el listado (= neto×1,19) y `$2.397.324` en el detalle (con descuento y gastos).
3. **Paridad USD:** 970 (fórmula del expediente, hardcodeada) vs 960 (implícita en los datos de OA/OC) vs "paridad" configurable (flujo de internaciones). *El código acertó: la parametriza.*
4. **Centros de costo:** 6 (expediente/catálogo) vs 15 (comercial).
5. **Nº de flujos:** 18 (matriz + doc BPM) vs 16 (diagramas) vs 12+4 (paleta del diseñador) vs **13 en la BD**.
6. **Nº de plantillas:** 115 / 117 / ~119 / **114 en vivo**.
7. **Nº de fases:** 14 (prototipo, hardcodeado) vs 10 (Catálogo Global) vs 18 flujos (matriz) — y el doc del motor dice que **no debe haber fases fijas**, que salen de `flujo_paso`.
8. **IBIS/SAEC:** la matriz lo marca "Diferido Fase 2"; el SRS lo especifica en detalle (RF-K03, ESI v3.2). ~30 sub-requisitos en juego.
9. **Dos taxonomías de roles sin tabla de equivalencia:** `USR-01..12` (flujos) vs 13 roles nominales (RBAC).
10. **Hash sin algoritmo fijado** en el SRS ("hash"); solo F12 concreta SHA-256. *El código usa SHA-256: correcto.*
11. **`requerimientos_lims_idic.html` obsoleto** y contradictorio con el .docx (§2).

### Bugs de los prototipos que **no** deben copiarse

- `demo_catalogo_laboratorio.html:387` — `res.every(r=>/cumple|conforme|informativo/i.test(r[3]))`: el regex `/cumple/i` matchea `"No cumple"`, así que **el Certificado de Conformidad siempre dictamina CUMPLE**. *El backend ya lo evita.*
- `demo_lims_expediente_unificado.html:221` — `f.tipo.includes('Ejército')?'F4':'F1'` nunca matchea: la columna Formato siempre muestra F1.
- `demo_catalogo_laboratorio.html` — `TX-SOL` sembrado como string `"4-5"` con `lim:"4"`: toma la rama cualitativa y su límite numérico nunca se evalúa.

---

## 8. Top 15 priorizado para llegar a producto final

Orden = riesgo (acreditación + pentesting) × bloqueo de otras piezas.

| # | Acción | Sev. | RF | Dónde |
|---|---|---|---|---|
| 1 | **Aplicar `PermisoGuard` + `@RequierePermiso` a los ~20 controladores** | 🔴 | H02 | `common/base-crud.controller.ts` + todos los `*.module.ts` |
| 2 | **Interceptor de auditoría global + endpoint `/auditoria`** (append-only, valor antes/después, IP) | 🔴 | H04 | `common/audit.interceptor.ts`, `app.module.ts` |
| 3 | **Máquina de estados** (Cotización 5 / OT 10 / Muestra 8 / Factura 7) con validación de transición | 🔴 | B02.3, B04.4 | `common/estado-machine.ts` |
| 4 | **Cotización aceptada → crea OT + instancia el flujo** (transaccional) | 🔴 | B04.1 | `cotizacion/cotizacion.service.ts:aceptar` |
| 5 | **Motor de fórmulas** con parser AST en sandbox (`jsep`, no `eval`/`vm2`) + editor | 🔴 | A06, D02.1 | `laboratorio/formula.service.ts` |
| 6 | **Modelo `Equipo` + bloqueo por calibración vencida** al capturar | 🔴 | D04 | `schema.prisma`, `laboratorio/equipo.module.ts` |
| 7 | **Cadena de custodia** append-only + transferencias | 🔴 | C02 | `laboratorio/custodia.module.ts` |
| 8 | **Aprobación escalonada + `DocumentoFirma`** (no repudio) | 🔴 | E01, E02.3 | `laboratorio/`, `rbac/` |
| 9 | **Corregir la fuga cross-tenant**: `tenant_id` en Analito/NormaLimite/Resultado/Firma/Permiso | 🟠 | H05.1 | `schema.prisma:756-800` + migración |
| 10 | **Arreglar los 5 endpoints en HTTP 500** (deriva Prisma ↔ BD) | 🟠 | A02, B06 | `align_schema_to_prisma.sql`, `CrudOpts` |
| 11 | **Emisión real de informes**: usar `plantilla.contenidoHtml` + PDF/A + correlativo por serie/año | 🟠 | F01, F02 | `plantilla-render/`, `schema.prisma` |
| 12 | **Rehacer el expediente sobre `flujo_paso`** (no hardcodeado), con paneles y gating por rol, alineado con las 14 fases aprobadas | 🟠 | G01, prototipo | `apps/web/app/(app)/ot/[id]/page.tsx` |
| 13 | **Bandeja de tareas por rol** (no por usuario iniciador) + pantalla + `Authorization` en el diseñador | 🟠 | G03, G01.3 | `flujo/flujo.service.ts:avanzarDesde`, `apps/web/app/(app)/flujos/page.tsx` |
| 14 | **Persistir el costeo Ejército** en la cotización (**tras decidir §7.1**) + botón Guardar del wizard | 🟡 | B03 | `cotizacion/`, `cotizaciones/nueva/page.tsx` |
| 15 | **Importador `matriz_flujos_lims_idic.xlsx` → flujo_def/paso/transicion** (18 flujos) + job de SLA con BullMQ | 🟡 | G02, G01.4 | `packages/db/`, `flujo/` |

**Fuera del top 15 pero contratado:** los 9 RF / 30 sub-requisitos del bloque **SAEC (RF-K)** están ausentes por completo. Si `[SAEC · track aparte]` significa un equipo y un calendario propios, no compite con esta lista; si entra en los 2 meses, **hay que replanificar**: es un módulo entero (casos, elementos, ETL de XML ESI v3.2 desde IBIS, banco de evidencias, préstamo/devolución, verificación pública).

---

## 9. Artefactos de prueba creados en pre-producción

Para verificar comportamiento real se ejecutaron escrituras contra `https://167.233.221.102.nip.io`:

| Artefacto | Estado |
|---|---|
| Cotización `COT-2026-0001` (cliente CAP Acero, $2.397.324) | **Persiste** · estado `ESTADO_INVENTADO_XYZ` → luego `aceptada` → anulada por el DELETE del test RBAC. **Conviene borrarla a mano** |
| Usuario `qa_audit_lector` (rol LECTOR) | ✅ eliminado (soft-delete, HTTP 200) |
| Resultado de prueba (réplicas [510,512,514]) | ✅ eliminado (HTTP 200) |
| Cliente `QA RBAC PROBE SPA` / método `QA-RBAC-PROBE` | No creados (fallaron con 400/500 antes de persistir) |

---

## 10. Conclusión

El equipo ha construido una base técnica correcta: el modelo de datos es fiel al Modelo Maestro, el motor BPM está bien diseñado, el costeo y la estadística son exactos y el endurecimiento de seguridad de infraestructura ya se hizo. **El problema no es la calidad de lo escrito, es que falta la capa de reglas de negocio y de control.**

Los tres hallazgos que impiden entregar esto como producto final al Ejército de Chile son, por este orden: **(1) el RBAC no se aplica**, **(2) la auditoría no existe**, **(3) no hay máquina de estados**. Los tres son de implementación acotada y conocida —no requieren rediseño— y los tres son bloqueantes tanto para el pentesting como para la acreditación NCh-ISO/IEC 17025. Junto con equipos, custodia y aprobación escalonada, constituyen el núcleo de lo que un auditor de acreditación comprobará primero.

Por último, **§7 debe cerrarse con el cliente antes de escribir más código de costeo o de expediente**: hay dos modelos de costo incompatibles y dos definiciones de "14 fases" en documentos que el cliente ya aprobó. Eso es una decisión de negocio, no una tarea de desarrollo.
