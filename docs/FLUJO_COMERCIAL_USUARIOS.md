# Flujo comercial, usuarios y transversales (oct-2026)

Cierra las carencias del tramo **Cliente → Cotización → Aceptación** y de las piezas
transversales (ingreso, usuarios, selector de personas, auditoría y no
conformidades) detectadas al escribir los manuales de usuario.

- **BD:** `packages/db/align_comercial_usuarios.sql` (aditivo e idempotente; al final de `ORDEN_SQL.txt`).
- **API:** `cliente/`, `cotizacion/`, `auth/`, `rbac/usuarios*.ts`, `auditoria/`.
- **Web:** `/login`, `/perfil`, `/clientes`, `/cotizaciones`, `/admin/usuarios`, `/usuarios`,
  `/custodia`, `/equipos`, `/firmas` y las páginas nuevas `/auditoria` y `/no-conformidades`.

---

## 1. Tipo de cliente

- `cliente.tipo` es un **código de la lista parametrizable** `parametro_sistema`
  (categoría `tipo_cliente`: Ley 17.798, Ejército, Carabineros…), administrada en
  Parámetros del sistema. Ya no se valida contra el enum antiguo.
- Alta: el tipo es obligatorio y debe estar **activo** en la lista.
- Edición: se acepta un tipo activo **o el mismo que ya tenía** el cliente aunque esté
  desactivado (clientes anteriores a R2: se pueden editar sin reclasificarlos). No se
  puede cambiar a otro valor desactivado.
- Desde la cotización: `PATCH /clientes/:id/tipo { tipo }` (permiso `cotizacion.crear`)
  reclasifica solo el tipo, sin dar acceso al resto de la ficha.
- El listado devuelve `tipoEtiqueta` y `tipoVigente`; la pantalla marca «tipo antiguo».
- Regla pura: `apps/api/src/cliente/tipo-cliente.ts` (tests en `tipo-cliente.spec.ts`).

## 2. Aceptación y anulación de la cotización

La Sección Ventas registra la aceptación (OC, OPI/resolución, correo, pago
adelantado, disposición del Director) y con ella nace la OT. Antes exigía
`cotizacion.aprobar`, que el rol COMERCIAL no tiene.

| Acción | Permiso | Quién lo tiene |
|---|---|---|
| Cotizar / editar una Abierta | `cotizacion.crear` | COMERCIAL, PLANIFICACION, ADMIN… |
| Registrar aceptación (genera la OT) | **`cotizacion.aceptar`** (nuevo) | COMERCIAL + todo rol con `cotizacion.aprobar` |
| Anular una Abierta o Vencida (y rechazar una histórica) | **`cotizacion.anular`** (nuevo) | COMERCIAL + todo rol con `cotizacion.aprobar` |

`cotizacion.aprobar` se conserva (jefaturas y dirección). La pantalla oculta los
botones que el rol no puede usar. La creación de la OT al aceptar no cambia.

## 3. Vencimiento

- Una cotización **Abierta** (o `enviada` del histórico) cuya validez terminó
  (`valida_hasta`, inclusive; en las antiguas `expira_at`) pasa a **`expirada`**
  (etiqueta «Vencida») y se registra `vencida_at` y una fila `vencer` en `audit_log`
  (usuario «sistema»).
- Cuándo: al consultar (`GET /cotizaciones`, `GET /cotizaciones/:id`, y antes de
  aceptar) y con un proceso periódico simple cada hora
  (`COTIZACION_VENCIMIENTO_MIN`, por defecto 60; 0 lo desactiva).
- «Hoy» es la fecha de **Chile** (`America/Santiago`), no la del servidor en UTC.
- Aceptar una vencida → **409** «La cotización COT-… venció el dd-mm-aaaa y ya no se
  puede aceptar. Emita una nueva cotización (o anúlela si el cliente desistió).»
- Una Vencida se puede anular. No se puede pasar a Vencida a mano: el mapa de
  transiciones de `common/estados.ts` no cambia (lo hace solo el sistema).
- Mi bandeja · «Cotizaciones por vencer» cuenta las **Abiertas** que vencen entre hoy y
  7 días y abre `/cotizaciones?porVencer=1`.
- Reglas puras: `cotizacion/validez.ts` (`hoyEnChile`, `estaVencida`) y
  `cotizacion/permisos-cotizacion.ts` (tests en `vencimiento.spec.ts`).

> Nota: la ronda 1 de Comercial decidió «sin Vencida ni Revalidada». Esta regla
> reintroduce solo **Vencida**, automática, para que una cotización fuera de validez
> no pueda aceptarse. Conviene confirmarlo con SVT.

## 4. Ingreso con verificación en dos pasos

Si la cuenta tiene 2FA, `POST /auth/login` responde 401 `{ requiere2fa: true }`. La
pantalla de ingreso pide entonces el **código de 6 dígitos** y repite el ingreso con
`totp`. El panel de accesos de prueba sigue igual (carga usuario y contraseña).

## 5. Usuarios y contraseñas

- **Nuevo usuario** (Administración › Usuarios): envía `nombre` sin contraseña; el
  servidor genera una **temporal**, la devuelve **una sola vez** (`passwordTemporal`) y
  la pantalla la muestra para entregarla. La vista clásica admite además elegir una.
- **Cambio obligatorio**: alta y «Restablecer contraseña» dejan
  `usuario.debe_cambiar_password = true`. El JWT lleva `cambioClave: true` y
  `PermisoGuard` responde **403 `CAMBIO_CLAVE_REQUERIDO`** en todo salvo `/auth/me`,
  `/auth/logout` y `/auth/cambiar-password`. La pantalla de ingreso (y la aplicación,
  si se recarga) muestran el cambio antes de entrar.
- **Cambiar mi contraseña** (Mi perfil): `POST /auth/cambiar-password { actual, nueva }`.
  Reglas: mínimo 10 caracteres, al menos una letra y un número, distinta de la actual y
  sin el nombre de usuario (`auth/clave.ts`). Invalida los refresh anteriores y
  devuelve una sesión nueva. Los usuarios de prueba (`demo.*`) y los de directorio
  (sin contraseña local) no pueden cambiarla aquí.
- **Desactivar es reversible**: `DELETE /usuarios/:id` y `PATCH { activo: false }`
  dejan la cuenta `inactivo` (sin `deleted_at`) y cortan sus sesiones; sigue en la
  lista (filtro «Inactivos») y se reactiva con `PATCH { activo: true }`. Nadie puede
  desactivarse a sí mismo. Las cuentas que el `DELETE` anterior borró lógicamente
  (`deleted_at`) no reaparecen: si hace falta, se restauran por SQL.

## 6. Selector de personas

`GET /personas?search=&unidadId=&limit=` y `GET /personas/:id` (cualquier usuario
autenticado). Devuelve nombre, usuario, cargo, grado y unidades; **nunca** correo,
estado de la cuenta, 2FA, último ingreso ni roles. Acotado al alcance: un perfil
global ve a todos; uno acotado ve a las personas de sus unidades visibles y a las de
roles transversales (asignación sin unidad). Lo usan Cadena de custodia
(Entrega/Recibe), Equipos (Responsable), Firmas registradas, Auditoría y No
conformidades. `/usuarios` sigue exigiendo `admin.usuarios`.

## 7. Auditoría y no conformidades

### Auditoría (`/auditoria`, permiso `audit.ver`)

Filtros por fecha (el «hasta» incluye el día completo), persona, entidad, acción y
código. Perfiles globales ven todo; una jefatura acotada solo ve lo hecho por las
personas de sus unidades y lo suyo (`auditoria/filtro-auditoria.ts`).
`GET /auditoria/opciones` da los valores de los combos.

### No conformidades (`/no-conformidades`)

| Permiso | Qué permite |
|---|---|
| `nc.ver` | Ver las NC de sus unidades y las transversales |
| `nc.crear` | Levantar una NC (personal de laboratorio, jefaturas, Calidad) |
| `nc.gestionar` | Responsable, plazo, tipo/criticidad, cambiar estado, cerrar y reabrir |

El responsable asignado puede registrar causa raíz, acciones y verificación aunque no
tenga `nc.gestionar`.

```
abierta ─▶ en_proceso ─▶ verificacion ─▶ cerrada ─▶ reabierta ─▶ …
```

- En proceso: exige responsable y plazo. Verificación: causa raíz y acción correctiva.
  Cerrar: además la verificación de la eficacia. Reabrir: comentario.
- Ligada a OT (`ot_id`), resultado (`resultado_id`) o equipo (`equipo_id`); la unidad
  se deduce de la OT o del equipo. Código `NC-AAAA-NNNN`.
- Enlace directo: `/no-conformidades?nueva=1&otId=…&equipoId=…&resultadoId=…`.
- Mi bandeja · «No conformidades abiertas» abre `/no-conformidades` y cuenta solo las de
  su alcance.
- Reglas puras: `auditoria/no-conformidad.reglas.ts` (tests en `.spec.ts`).

## 8. Endpoints nuevos o cambiados

| Método | Ruta | Permiso |
|---|---|---|
| PATCH | `/clientes/:id/tipo` | `cotizacion.crear` |
| POST | `/cotizaciones/:id/aceptar` | `cotizacion.aceptar` (antes `cotizacion.aprobar`) |
| POST · DELETE | `/cotizaciones/:id/anular` · `/cotizaciones/:id` | `cotizacion.anular` |
| POST | `/cotizaciones/:id/rechazar` | `cotizacion.anular` |
| POST | `/auth/cambiar-password` | autenticado |
| GET | `/personas`, `/personas/:id` | autenticado |
| GET | `/auditoria/opciones` | `audit.ver` |
| GET · POST | `/no-conformidades` | `nc.ver` · `nc.crear` |
| GET · PATCH | `/no-conformidades/:id` | `nc.ver` (+ gestionar o responsable para editar) |
| POST | `/no-conformidades/:id/estado` | `nc.gestionar` |

## 9. Cómo se probó

- Unitarias: `tipo-cliente.spec.ts`, `vencimiento.spec.ts`, `clave.spec.ts`,
  `cambio-clave.guard.spec.ts`, `filtro-auditoria.spec.ts`, `no-conformidad.reglas.spec.ts`.
- Integración contra la API compilada y una copia de la base de pruebas, con los
  usuarios `demo.*` (68 comprobaciones, cada regla con un perfil que puede y otro que no).
