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
ACCESOS_DEMO_CLAVE=<clave compartida, mínimo 8 caracteres>
ACCESOS_DEMO_MOSTRAR_CLAVE=false
```

- `ACCESOS_DEMO_CLAVE` es la contraseña común de todos los usuarios de prueba.
  Genere una propia; no se guarda en el repositorio ni en la base de datos.
- Con `ACCESOS_DEMO_MOSTRAR_CLAVE=true` la clave queda escrita en la pantalla de
  ingreso y basta un clic. Úselo solo si el entorno **no** es accesible desde
  Internet: cualquiera que abra la página entraría con cualquier perfil.
- Con `false`, quien prueba escribe la clave una vez en «Contraseña» y pulsa el
  perfil; el navegador la recuerda mientras dure la pestaña.

Después: `docker compose -f docker-compose.prod.yml --env-file .env up -d api`.

Para desactivarlos basta `ACCESOS_DEMO=false`: los usuarios siguen existiendo
pero no pueden entrar (no tienen contraseña propia).

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
| SAEC: casos, evidencias, armas, custodia, préstamos, IBIS, certificados | Delegación Nº 11 | Delegación Nº 11, jefatura de BPCH y perfiles globales |
| Metrología | Sección Metrología | LMT, LMTE, LNF, sus jefaturas y perfiles globales |
| Internaciones | BPCH y Comercial | Certificación, sucursales, Delegación Nº 11, Comercial y perfiles globales |

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

## Lo que todavía NO se filtra por laboratorio

Conviene saberlo antes de enseñarlo:

- **Perfiles operativos globales**: recepción, ventas, muestreo, finanzas y
  abastecimiento ven todas las órdenes. Es lo que define hoy el catálogo de
  roles; falta que el IDIC confirme si abastecimiento y finanzas deben verlas.
- **Auditoría**: las jefaturas ven la bitácora de todo el instituto.
- **Reportes de gestión** (productividad, plazos, conformidad): los ven las
  jefaturas, pero con cifras de todo el instituto, no solo de su unidad.
- **Oportunidades (CRM) y cotizaciones**: visibles para los jefes de laboratorio.
- **Control estadístico, consumibles, documentos y mensajería**: sin filtro por
  unidad.
- **Pantallas sin acceso**: si se escribe a mano la dirección de un módulo
  ajeno (p. ej. `/saec`), el servidor no entrega datos, pero la pantalla se
  muestra vacía en vez de decir «sin acceso».
