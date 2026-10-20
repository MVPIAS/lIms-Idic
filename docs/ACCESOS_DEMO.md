# Accesos de prueba por perfil

Usuarios ficticios, uno por cada perfil del flujo y por cada laboratorio, para
comprobar que **cada persona ve solo lo que le corresponde**. Aparecen como
botones en la pantalla de ingreso cuando el servidor los tiene activados.

No existen en la instalación del IDIC: allí no se siembran y las variables que
los activan no se declaran.

## Cómo se activan (solo entornos de demostración)

En el `.env` del servidor (preproducción usa `docker-compose.prod.yml`):

```
ACCESOS_DEMO=true
```

- Todos los usuarios de prueba comparten una contraseña **temporal embebida en
  el código** (`CLAVE_DEMO_EMBEBIDA` en `apps/api/src/auth/auth.service.ts`).
  Se muestra en la pantalla de ingreso: al pulsar un perfil se cargan su
  usuario y su contraseña en el formulario y se entra con «Entrar al sistema».
- Decisión de la fase de validación: se cambiará antes de producción.
  `ACCESOS_DEMO_CLAVE` la sustituye sin tocar el código y
  `ACCESOS_DEMO_MOSTRAR_CLAVE=false` la oculta de la pantalla.

Después: `docker compose -f docker-compose.prod.yml --env-file .env up -d api`.

Para desactivarlos basta `ACCESOS_DEMO=false`: los usuarios siguen existiendo
pero no pueden entrar (no tienen contraseña propia). En la instalación del IDIC
la variable no existe y los usuarios de prueba no se siembran.

## Qué usuarios hay

Los crea `packages/db/seed_accesos_demo.sql` (etiqueta `demo` en
`ORDEN_SQL.txt`). Todos empiezan por `demo.`.

| Grupo | Usuarios | Rol |
|---|---|---|
| Dirección y sistema | `demo.admin`, `demo.director`, `demo.calidad`, `demo.auditor`, `demo.recepcion` | Administrador, Director técnico, Calidad, Lector, Recepción |
| Comercial | `demo.dco.jefe`, `demo.ventas`, `demo.planificacion`, `demo.muestreo`, `demo.finanzas`, `demo.abastecimiento` | Jefe de departamento (+ Planificación), Comercial, Planificación y Control, Muestreo, Finanzas, Abastecimiento |
| Jefes de departamento | `demo.dqo.jefe`, `demo.dsa.jefe`, `demo.bpch.jefe` | Jefe de departamento |
| Jefes de sección | `demo.squ.jefe`, `demo.sal.jefe`, `demo.sve.jefe`, `demo.sem.jefe`, `demo.sam.jefe`, `demo.scc.jefe` | Jefe de sección |
| Cada laboratorio (16) | `demo.<lab>.jefe`, `demo.<lab>.revisor`, `demo.<lab>.analista1`, `demo.<lab>.analista2` | Jefe de laboratorio, Revisor, Analista (Metrólogo en LMT, LMTE y LNF) |
| BPCH · Certificación | `demo.scc.inspector1`, `demo.scc.inspector2` | Inspector |
| BPCH · cada sucursal (6) | `demo.<sucursal>.jefe`, `demo.<sucursal>.inspector` | Jefe de sucursal, Inspector |
| BPCH · Delegación Nº 11 | `demo.d11.jefe`, `demo.d11.inspector1`, `demo.d11.inspector2` | Jefe, Inspector |
| Planificador de un laboratorio | `demo.lqc.planificador` (pestaña «Químico») | Planificador de laboratorio (prueba): `ot.crear` con alcance SOLO de LQC |

`demo.lqc.planificador` existe para probar que registrar OT y emitir órdenes
internas respetan el alcance por laboratorio (Planificación y Control es global):
registra OT de LQC y emite órdenes internas desde OT de LQC; con una OT de LPN, o al
registrar una OT para otro laboratorio, recibe 403; no ve OT de otros laboratorios.
Su rol `PLANIFICADOR_LAB` también es solo de demostración (lo crea esta semilla).
Lo recorre `scripts/verificacion/frente-k.js`.

`<lab>` = lme, lqc, lpn, lqa, lmb, les, lcc, ltx, lrb, lam, seo, svm, lem, lmt,
lmte, lnf. `<sucursal>` = sstgo, santof, sseren, scalam, scopiap, siquiqu.

**Un laboratorio admite N analistas.** La semilla crea dos para poder comprobar
que comparten lo del laboratorio; para añadir más, Administración → Usuarios →
nuevo usuario con rol Analista y la misma unidad.

La semilla también reparte entre las unidades las órdenes de trabajo de ejemplo
que no tenían laboratorio y, si alguna unidad queda sin ninguna, le crea dos
(`OT-DEMO-<unidad>-1` y `-2`).

## Cómo se controla qué ve cada uno

Tres capas, las tres en el servidor (el menú solo las refleja):

1. **Permiso por rol** (`PermisoGuard`): qué acciones puede hacer el rol.
2. **Alcance por unidad** (`AlcanceService`): de qué laboratorios son los datos
   que ve. Un analista, su laboratorio; un jefe de sección o de departamento,
   todo lo que cuelga de él; dirección, calidad y los perfiles comerciales, todo.
3. **Ámbito del módulo** (`@AmbitoUnidad`): módulos que pertenecen a una rama
   del organigrama, con independencia del rol.

| Módulo | Ámbito | Quién entra |
|---|---|---|
| SAEC: casos, evidencias, armas, custodia, préstamos, IBIS, certificados | Delegación Nº 11 (estricto) | Delegación Nº 11, jefatura de BPCH, Dirección, Subdirección y Lector/Auditor (consulta). **No** Recepción, Calidad ni Administración (fase 0) |
| Metrología | Sección Metrología | LMT, LMTE, LNF, sus jefaturas y perfiles globales con permiso de Metrología |
| Internaciones · Reinspecciones | BPCH y Comercial | Certificación, sucursales, Comercial y perfiles globales; la Delegación Nº 11 solo lo que inspecciona |
| Codificación Única · Producción Nacional | BPCH sin la Delegación Nº 11, y Comercial | Comercial solo consulta (docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md) |
| Prototipos · Clasificación de sustancias | BPCH | Certificación y jefatura de BPCH, todos; cada sucursal y la Delegación Nº 11, solo los de su unidad |

Desde la fase 0 (20-10-2026) el alcance va **por asignación**: cada permiso vale
con el alcance del rol que lo concede (docs/ADMIN_ROLES.md › «Alcance por
asignación»). Para probarlo hay tres perfiles con dos roles
(`seed_alcance_fase0.sql`): `demo.multi.lpn_comercial` (Analista LPN + Comercial),
`demo.multi.lqc_recepcion` (Analista LQC + Recepción) y `demo.multi.lam_lem` (Jefe
LAM + Analista LEM).

## Prueba del 13-10-2026 (26 perfiles, entorno local)

Con 46 órdenes repartidas en 24 unidades:

| Perfil | Órdenes que ve | ¿Abre una orden de otra unidad? |
|---|---|---|
| Administrador, director, calidad, auditor, recepción | 46 (todas) | Sí |
| Ventas, planificación, muestreo, finanzas, abastecimiento, jefe de Comercial | 46 (todas) | Sí |
| Jefe del Depto. Químico | 15 (sus 8 laboratorios) | Solo las de su departamento |
| Jefe de Sección Alimentos | 5 (LQA, LMB, LES) | No · 403 |
| Jefe, revisor y analistas de LQC | 2 (LQC) | No · 403 |
| Analista de LQA · Metrólogo de LMT · Jefe de LEM | las de su laboratorio | No · 403 |
| Jefe de BPCH | 16 (Certificación, sucursales, Delegación Nº 11) | No · 403 |
| Jefe e inspector de Certificación · de una sucursal · de la Delegación Nº 11 | 2 (su unidad) | No · 403 |

Por módulo: usuarios, roles, permisos y matriz de firmas, solo el administrador.
SAEC, solo Delegación Nº 11, jefatura de BPCH y perfiles globales (un analista
químico o un inspector de sucursal reciben 403). Internaciones, solo BPCH y
Comercial. Reporte comercial, solo Comercial, finanzas y dirección. Equipos y
calibraciones, los del laboratorio propio más los comunes.

La prueba se repite con `scripts/verificacion/matriz-permisos.js` (entra con cada
perfil y anota el código de respuesta y el número de filas de cada módulo).

## Antes de producción: cómo se borran los perfiles de prueba

En una instalación nueva del IDIC no hace nada: el instalador aplica
`orden-sql.sh sin-demo`, que no siembra usuarios `demo.*` ni el rol
`PLANIFICADOR_LAB`. Si la base viene de preproducción (o se sembró en modo `demo`):

1. En el `.env` del servidor, `ACCESOS_DEMO=false` (o quitar la variable) y
   reiniciar la API: los usuarios de prueba dejan de poder entrar y la pantalla de
   ingreso deja de mostrarlos.
2. Retirarlos de la base (una sola transacción; conserva la trazabilidad de lo que
   hicieron, porque solo se inactivan y se marcan como borrados):

   ```sql
   BEGIN;
   DELETE FROM usuario_rol ur USING usuario u WHERE ur.usuario_id = u.id AND u.es_demo;
   DELETE FROM unidad_jefe j USING usuario u WHERE j.usuario_id = u.id AND u.es_demo;
   UPDATE met_firmante SET usuario_id = NULL WHERE usuario_id IN (SELECT id FROM usuario WHERE es_demo);
   UPDATE usuario SET estado = 'inactivo', deleted_at = now(), updated_at = now() WHERE es_demo;
   -- Rol solo de demostración (perfil con ot.crear de un laboratorio):
   DELETE FROM rol_permiso rp USING rol r WHERE rp.rol_id = r.id AND r.codigo = 'PLANIFICADOR_LAB';
   DELETE FROM rol r WHERE r.codigo = 'PLANIFICADOR_LAB'
     AND NOT EXISTS (SELECT 1 FROM usuario_rol ur WHERE ur.rol_id = r.id);
   COMMIT;
   ```
3. Comprobar: `SELECT count(*) FROM usuario WHERE es_demo AND deleted_at IS NULL;` → 0.
   Las jefaturas que quedaron sin titular se asignan en Administración › Estructura.

## Lo que todavía NO se filtra por laboratorio

Conviene saberlo antes de enseñarlo:

- **Perfiles operativos globales**: recepción, ventas, muestreo y finanzas ven
  todas las órdenes. Abastecimiento ya no ve OT ni informes (fase 0).
- ~~**Auditoría**: las jefaturas ven la bitácora de todo el instituto.~~ Resuelto:
  una jefatura acotada solo ve lo hecho por las personas de sus unidades
  (docs/FLUJO_COMERCIAL_USUARIOS.md).
- **Reportes de gestión** (productividad, plazos, conformidad): los ven las
  jefaturas, pero con cifras de todo el instituto, no solo de su unidad.
- **Oportunidades (CRM), cotizaciones, clientes y facturación** (lectura):
  visibles para las jefaturas con todo el instituto. Queda para la fase 1; las
  escrituras sobre cotizaciones ya exigen tenerlas en el alcance.
- **Consumibles y mensajería**: sin filtro por unidad (el kardex no tiene
  laboratorio). El control estadístico (SPC) ya se acota (fase 0).
- **Pantallas sin acceso**: si se escribe a mano la dirección de un módulo
  ajeno (p. ej. `/saec`), el servidor no entrega datos, pero la pantalla se
  muestra vacía en vez de decir «sin acceso».

## Permisos por laboratorio reforzados en la revisión de seguridad r3 (18-10-2026)

- **PDF y HTML de un documento** (`GET /informes/:id/pdf|html`): mismo alcance que el
  listado de documentos (la unidad del documento o la del laboratorio de su OT).
  Dirección y los perfiles de alcance global lo ven todo; quien es responsable de un
  paso de su firma también. La verificación pública por código no cambia.
- **Órdenes internas** (`POST|PATCH|DELETE /ordenes-internas`): exigen tener la OT de
  origen en el alcance (una orden interna da acceso a la OT al laboratorio de destino).
- **Edición manual de un resultado** (`PATCH /resultados/:id`): no cambia el analista
  (400), no deja que quien capturó decida el veredicto (409) y no toca lo aprobado
  (409: se reabre). `POST /resultados` registra siempre como analista a quien captura.
- **Limitador de peticiones**: solo un token con firma válida da cupo por usuario; un
  token inventado o caducado cuenta por la IP.
- **Tasa de internación**: los porcentajes salen de Administración › Parámetros;
  calcular con otros exige `catalogo.gestionar`.

## Guiones de verificación sobre una base desde cero

Base: `CREATE DATABASE <bd>` vacía y todos los ficheros de `bash scripts/orden-sql.sh demo`
en orden con `psql -v ON_ERROR_STOP=1` (una segunda pasada completa deja la misma base:
solo `schema.sql` no es reaplicable). Después `pnpm --filter @lims-idic/db generate`,
`pnpm --filter @lims-idic/api build` y, con `DATABASE_URL` apuntando a esa base, cada guion
con `--arrancar` (dejar unos segundos entre uno y otro para que se libere el puerto), en
este orden fijo:

1. `correcciones-manuales.js` 2. `flujo-completo.js` 3. `informe-ensayo.js`
4. `quimicos-recepcion-calculo.js` 5. `bpch-internacion-reinspeccion.js`
6. `bpch-produccion-prototipos-clasificacion.js` 7. `metrologia-1510.js`
8. `frente-k.js` 9. `alcance-por-laboratorio.js` (todos los perfiles `demo.*`:
   ninguna fila fuera del alcance, detalle ajeno → 403/404, escrituras ajenas → 403
   y menú sin SAEC ni BPCH Certificación donde no corresponde)

Ninguno depende de otro: cada uno se prepara sus datos (p. ej. `correcciones-manuales.js`
emite su propio informe de LQC si la base no tiene ninguno y crea la factura de su nota de
crédito). Pasan en una base recién creada y repetidos (verificado dos vueltas seguidas).
