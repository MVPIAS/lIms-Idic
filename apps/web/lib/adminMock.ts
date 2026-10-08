/**
 * DATOS DE EJEMPLO del área de Administración (solo desarrollo / revisión sin backend).
 *
 * Se activa con NEXT_PUBLIC_ADMIN_MOCK=1 (o, en desarrollo, localStorage.lims_admin_mock="1").
 * Implementa en memoria el mismo contrato REST que el backend (/unidades, /usuarios,
 * /roles, /permisos/matriz, /firmas-matriz, /me/alcance) para poder revisar las pantallas.
 * Estructura IDIC con códigos reales de laboratorio; personas FICTICIAS y genéricas
 * («Analista LCC 1»…). Nada de esto se envía a ningún servidor.
 */
import type {
  AccionFirma, AlcanceRol, Asignacion, NivelRol, NivelUnidad, NodoUnidad, PasoResuelto,
  ReglaFirma, Rol, TipoDocumento, TipoUnidad, Unidad, Usuario,
} from "./admin";

// ───────────────────────────── Unidades ─────────────────────────────
type U = [codigo: string, nombre: string, tipo: TipoUnidad, padre: string | null, extra?: Partial<Unidad>];
const UNIDADES_BASE: U[] = [
  ["DIR", "Dirección del IDIC", "DIRECCION", null, { sigla: "IDIC", centroCosto: "400400000" }],
  ["CAL", "Gestión de Calidad", "APOYO", "DIR", { centroCosto: "400401000" }],
  ["ADM", "Administración y Finanzas", "APOYO", "DIR", { centroCosto: "400402000" }],
  ["TIC", "Informática", "APOYO", "DIR", { centroCosto: "400403000" }],
  // Comercial
  ["DCOM", "Departamento Comercial", "DEPARTAMENTO", "DIR", { sigla: "COM" }],
  ["SVT", "Sección Ventas", "SECCION", "DCOM"],
  ["SPC", "Sección Planificación y Control", "SECCION", "DCOM"],
  ["SMU", "Sección Muestreo", "SECCION", "DCOM", { codsucdel: "9999", centroCosto: "400495110" }],
  // Químico
  ["DQ", "Departamento Químico", "DEPARTAMENTO", "DIR", { sigla: "DQ" }],
  ["SQU", "Sección Química", "SECCION", "DQ"],
  ["LME", "Laboratorio de Materiales Energéticos", "LABORATORIO", "SQU"],
  ["LQC", "Laboratorio de Química", "LABORATORIO", "SQU", { codsucdel: "7003" }],
  ["LPN", "Laboratorio de Pinturas", "LABORATORIO", "SQU", { codsucdel: "7004" }],
  ["SAL", "Sección Alimentos", "SECCION", "DQ"],
  ["LQA", "Laboratorio de Química de Alimentos", "LABORATORIO", "SAL", { codsucdel: "7009" }],
  ["LMB", "Laboratorio de Microbiología", "LABORATORIO", "SAL", { codsucdel: "7010" }],
  ["LES", "Laboratorio de Evaluación Sensorial", "LABORATORIO", "SAL", { codsucdel: "7008" }],
  ["SVE", "Sección Vestuario y Equipos", "SECCION", "DQ"],
  ["LCC", "Laboratorio de Cuero y Calzado", "LABORATORIO", "SVE", { codsucdel: "7006" }],
  ["LTX", "Laboratorio Textil", "LABORATORIO", "SVE", { codsucdel: "7011" }],
  // Armamento y Munición
  ["DAM", "Departamento Armamento y Munición", "DEPARTAMENTO", "DIR", { sigla: "DAM" }],
  ["SAR", "Sección Armamento", "SECCION", "DAM"],
  ["LRB", "Laboratorio de Balística", "LABORATORIO", "SAR", { codsucdel: "4009" }],
  ["LAM", "Laboratorio de Armamento y Munición", "LABORATORIO", "SAR", { codsucdel: "4008" }],
  ["SEO", "Laboratorio de Electrónica y Optrónica", "LABORATORIO", "SAR", { codsucdel: "400440110" }],
  ["SVM", "Laboratorio de Vehículos Militares", "LABORATORIO", "SAR", { codsucdel: "4007" }],
  ["SEM", "Sección Ensayos Mecánicos", "SECCION", "DAM"],
  ["LEM", "Laboratorio de Ensayos Mecánicos", "LABORATORIO", "SEM", { codsucdel: "4006" }],
  ["LMT", "Laboratorio de Metrología", "LABORATORIO", "SEM"],
  ["LMTE", "Laboratorio de Metrología · Área Eléctrica", "LABORATORIO", "SEM", { codsucdel: "400450140" }],
  ["LNF", "Laboratorio Nacional de Fuerza", "LABORATORIO", "SEM", { codsucdel: "400450150" }],
  ["LCAD", "Laboratorio LCAD", "LABORATORIO", "SEM"],
  // BPCH
  ["BPCH", "Departamento Banco de Pruebas de Chile", "DEPARTAMENTO", "DIR", { sigla: "BPCH" }],
  ["SCC", "Sección Certificación de la Conformidad", "SECCION", "BPCH"],
  ["SSTGO", "Sucursal Santiago", "SUCURSAL", "BPCH"],
  ["SANTOF", "Sucursal Antofagasta", "SUCURSAL", "BPCH"],
  ["SSEREN", "Sucursal La Serena", "SUCURSAL", "BPCH"],
  ["SCALAM", "Sucursal Calama", "SUCURSAL", "BPCH"],
  ["SCOPIAP", "Sucursal Copiapó", "SUCURSAL", "BPCH"],
  ["SIQUIQU", "Sucursal Iquique", "SUCURSAL", "BPCH"],
  ["D11", "Delegación Nº 11", "DELEGACION", "BPCH", { codsucdel: "3008" }],
];

const uid = (codigo: string) => `u-${codigo}`;

const unidades: Unidad[] = UNIDADES_BASE.map(([codigo, nombre, tipo, padre, extra]) => ({
  id: uid(codigo), codigo, nombre, tipo, padreId: padre ? uid(padre) : null,
  sigla: null, icono: null, color: null, codsucdel: null, centroCosto: null, activo: true, ...(extra ?? {}),
}));

// ───────────────────────────── Roles ─────────────────────────────
type R = [codigo: string, nombre: string, nivel: NivelRol, alcance: AlcanceRol, descripcion: string, esSistema?: boolean];
const ROLES_BASE: R[] = [
  ["SUPERADMIN", "Superadministrador", "SISTEMA", "GLOBAL", "Control total del sistema. Reservado al equipo TIC.", true],
  ["ADMIN", "Administrador", "SISTEMA", "GLOBAL", "Administra usuarios, estructura y parámetros.", true],
  ["DIRECTOR", "Director", "DIRECCION", "GLOBAL", "Dirección del IDIC: ve todo y oficializa documentos."],
  ["JEFE_DEPTO", "Jefe de Departamento", "JEFATURA", "DESCENDENCIA", "Jefatura de un departamento y todas sus secciones y laboratorios."],
  ["JEFE_SECCION", "Jefe de Sección", "JEFATURA", "DESCENDENCIA", "Jefatura de una sección y sus laboratorios."],
  ["JEFE_LAB", "Jefe de Laboratorio", "JEFATURA", "UNIDAD", "Responsable técnico de un laboratorio, sucursal o delegación."],
  ["ANALISTA_SR", "Analista sénior", "OPERATIVO", "UNIDAD", "Captura y revisa resultados de su laboratorio."],
  ["ANALISTA", "Analista", "OPERATIVO", "UNIDAD", "Captura resultados de su laboratorio."],
  ["TECNICO", "Técnico", "OPERATIVO", "UNIDAD", "Recepciona y prepara muestras; registra mediciones."],
  ["RECEPCION", "Recepción de muestras", "OPERATIVO", "UNIDAD", "Recibe muestras y abre la cadena de custodia."],
  ["COMERCIAL", "Ejecutivo comercial", "OPERATIVO", "DESCENDENCIA", "Clientes, cotizaciones y OT del Depto. Comercial."],
  ["COBRANZA", "Cobranza", "SOPORTE", "GLOBAL", "Facturación y pagos."],
  ["CALIDAD", "Gestión de Calidad", "SOPORTE", "GLOBAL", "Métodos, plantillas, no conformidades; firma final de informes."],
  ["LECTOR", "Lector / Auditor", "SOPORTE", "GLOBAL", "Solo lectura de todo el sistema."],
];
const rid = (codigo: string) => `rol-${codigo}`;
const roles: Rol[] = ROLES_BASE.map(([codigo, nombre, nivel, alcance, descripcion, esSistema]) => ({
  id: rid(codigo), codigo, nombre, nivel, alcance, descripcion, esSistema: !!esSistema,
}));

// ───────────────────────────── Permisos ─────────────────────────────
const MODULOS: Record<string, [accion: string, descripcion: string][]> = {
  admin: [["estructura", "Gestionar la estructura orgánica"], ["usuarios", "Gestionar usuarios y asignaciones"], ["roles", "Gestionar roles y permisos"], ["firmas", "Gestionar la matriz de firmas"]],
  audit: [["ver", "Ver la bitácora de auditoría"]],
  catalogo: [["gestionar", "Gestionar el catálogo maestro"]],
  cliente: [["ver", "Ver clientes"], ["crear", "Crear clientes"], ["editar", "Editar clientes"]],
  cotizacion: [["ver", "Ver cotizaciones"], ["crear", "Crear cotizaciones"], ["aprobar", "Aprobar cotizaciones"]],
  factura: [["ver", "Ver facturas"], ["emitir", "Emitir facturas"], ["cobrar", "Registrar pagos"]],
  ot: [["ver", "Ver OT"], ["crear", "Crear OT"], ["cerrar", "Cerrar OT"]],
  muestra: [["ver", "Ver muestras"], ["crear", "Recepcionar muestras"], ["transferir", "Transferir custodia"]],
  resultado: [["ver", "Ver resultados"], ["crear", "Capturar resultados"], ["revisar", "Revisar resultados"], ["aprobar", "Aprobar resultados"]],
  certificado: [["emitir", "Emitir informes/certificados"], ["firmar", "Firmar informes/certificados"]],
  metodo: [["ver", "Ver métodos"], ["crear", "Crear métodos"], ["aprobar", "Aprobar métodos"]],
  equipo: [["ver", "Ver equipos"], ["gestionar", "Gestionar equipos y calibraciones"]],
  plantilla: [["ver", "Ver plantillas"], ["gestionar", "Gestionar plantillas"]],
  flujo: [["ver", "Ver flujos"], ["editar", "Editar flujos"], ["publicar", "Publicar flujos"]],
  nc: [["gestionar", "Gestionar no conformidades"]],
  firma: [["registrar", "Registrar firma propia"]],
};
const TODOS = Object.entries(MODULOS).flatMap(([m, acc]) => acc.map(([a]) => `${m}.${a}`));
const lectura = TODOS.filter((c) => c.endsWith(".ver"));

const PERMISOS_ROL: Record<string, string[]> = {
  SUPERADMIN: [...TODOS],
  ADMIN: TODOS.filter((c) => !["resultado.aprobar", "certificado.firmar"].includes(c)),
  DIRECTOR: [...lectura, "audit.ver", "cotizacion.aprobar", "certificado.emitir", "certificado.firmar", "metodo.aprobar", "nc.gestionar", "ot.cerrar", "resultado.aprobar", "resultado.revisar", "firma.registrar"],
  JEFE_DEPTO: [...lectura, "audit.ver", "certificado.emitir", "certificado.firmar", "metodo.aprobar", "resultado.aprobar", "resultado.revisar", "nc.gestionar", "firma.registrar"],
  JEFE_SECCION: [...lectura, "certificado.emitir", "certificado.firmar", "resultado.aprobar", "resultado.revisar", "firma.registrar"],
  JEFE_LAB: ["audit.ver", "catalogo.gestionar", "certificado.emitir", "certificado.firmar", "equipo.gestionar", "equipo.ver", "firma.registrar", "flujo.ver", "metodo.aprobar", "metodo.crear", "metodo.ver", "muestra.crear", "muestra.transferir", "muestra.ver", "nc.gestionar", "ot.ver", "plantilla.ver", "resultado.aprobar", "resultado.revisar", "resultado.ver"],
  ANALISTA_SR: ["equipo.ver", "firma.registrar", "metodo.ver", "muestra.ver", "ot.ver", "plantilla.ver", "resultado.crear", "resultado.revisar", "resultado.ver"],
  ANALISTA: ["equipo.ver", "firma.registrar", "metodo.ver", "muestra.ver", "ot.ver", "resultado.crear", "resultado.ver"],
  TECNICO: ["equipo.ver", "metodo.ver", "muestra.crear", "muestra.transferir", "muestra.ver", "ot.ver", "resultado.crear", "resultado.ver"],
  RECEPCION: ["cliente.ver", "muestra.crear", "muestra.transferir", "muestra.ver", "ot.ver"],
  COMERCIAL: ["cliente.crear", "cliente.editar", "cliente.ver", "cotizacion.crear", "cotizacion.ver", "factura.ver", "ot.crear", "ot.ver", "plantilla.ver"],
  COBRANZA: ["cliente.ver", "cotizacion.ver", "factura.cobrar", "factura.emitir", "factura.ver", "ot.ver"],
  CALIDAD: ["audit.ver", "catalogo.gestionar", "equipo.ver", "flujo.ver", "metodo.aprobar", "metodo.ver", "muestra.ver", "nc.gestionar", "plantilla.gestionar", "plantilla.ver", "resultado.ver", "certificado.firmar", "firma.registrar", "admin.firmas"],
  LECTOR: [...lectura, "audit.ver"],
};
const asignPermisos = new Map<string, Set<string>>(roles.map((r) => [r.id, new Set(PERMISOS_ROL[r.codigo] ?? [])]));

// ───────────────────────────── Usuarios ─────────────────────────────
type A = [rol: string, unidad: string | null, desde?: string, hasta?: string];
type P = [username: string, nombre: string, cargo: string, asign: A[], activo?: boolean];
const PERSONAS: P[] = [
  ["admin.tic", "Administrador TIC", "Administrador de sistemas", [["SUPERADMIN", null]]],
  ["director", "Director IDIC", "Director", [["DIRECTOR", null]]],
  ["subdirector", "Subdirector IDIC", "Subdirector", [["LECTOR", null]]],
  ["jefe.calidad", "Jefe Gestión de Calidad", "Jefe de Calidad", [["CALIDAD", null], ["JEFE_LAB", "CAL"]]],
  ["analista.calidad", "Analista Calidad 1", "Analista de Calidad", [["CALIDAD", null]]],
  ["jefe.comercial", "Jefe Depto. Comercial", "Jefe de Departamento", [["JEFE_DEPTO", "DCOM"]]],
  ["comercial.1", "Ejecutivo Comercial 1", "Ejecutivo de ventas", [["COMERCIAL", "DCOM"]]],
  ["comercial.2", "Ejecutivo Comercial 2", "Ejecutivo de ventas", [["COMERCIAL", "DCOM"]]],
  ["cobranza.1", "Cobranza 1", "Encargado de cobranza", [["COBRANZA", null]]],
  ["jefe.dq", "Jefe Depto. Químico", "Jefe de Departamento", [["JEFE_DEPTO", "DQ"]]],
  ["jefe.squ", "Jefe Sección Química", "Jefe de Sección", [["JEFE_SECCION", "SQU"]]],
  ["jefe.sal", "Jefe Sección Alimentos", "Jefe de Sección", [["JEFE_SECCION", "SAL"]]],
  ["jefe.sve", "Jefe Sección Vestuario", "Jefe de Sección", [["JEFE_SECCION", "SVE"]]],
  ["jefe.lcc", "Jefe LCC", "Jefe de Laboratorio", [["JEFE_LAB", "LCC"]]],
  ["analista.lcc1", "Analista LCC 1", "Analista químico", [["ANALISTA_SR", "LCC"], ["JEFE_LAB", "LCC", "2026-10-01", "2026-10-31"]]],
  ["analista.lcc2", "Analista LCC 2", "Analista químico", [["ANALISTA", "LCC"]]],
  ["tecnico.lcc1", "Técnico LCC 1", "Técnico de laboratorio", [["TECNICO", "LCC"]]],
  ["jefe.lme", "Jefe LME", "Jefe de Laboratorio", [["JEFE_LAB", "LME"]]],
  ["analista.lme1", "Analista LME 1", "Analista químico", [["ANALISTA_SR", "LME"]]],
  ["analista.lme2", "Analista LME 2", "Analista químico", [["ANALISTA", "LME"]]],
  ["jefe.lqc", "Jefe LQC", "Jefe de Laboratorio", [["JEFE_LAB", "LQC"]]],
  ["analista.lqc1", "Analista LQC 1", "Analista químico", [["ANALISTA", "LQC"]]],
  ["jefe.lmb", "Jefe LMB", "Jefe de Laboratorio", [["JEFE_LAB", "LMB"]]],
  ["analista.lmb1", "Analista LMB 1", "Microbiólogo", [["ANALISTA", "LMB"]]],
  ["jefe.ltx", "Jefe LTX", "Jefe de Laboratorio", [["JEFE_LAB", "LTX"]]],
  ["jefe.dam", "Jefe Depto. Armamento", "Jefe de Departamento", [["JEFE_DEPTO", "DAM"]]],
  ["jefe.sem", "Jefe Sección Ensayos Mecánicos", "Jefe de Sección", [["JEFE_SECCION", "SEM"]]],
  ["jefe.lrb", "Jefe LRB", "Jefe de Laboratorio", [["JEFE_LAB", "LRB"]]],
  ["analista.lrb1", "Analista LRB 1", "Analista balístico", [["ANALISTA", "LRB"]]],
  ["jefe.lmt", "Jefe LMT", "Jefe de Laboratorio", [["JEFE_LAB", "LMT"], ["JEFE_LAB", "LMTE"]]],
  ["metrologo.1", "Metrólogo LMT 1", "Metrólogo", [["ANALISTA_SR", "LMT"]]],
  ["jefe.bpch", "Jefe Depto. BPCH", "Jefe de Departamento", [["JEFE_DEPTO", "BPCH"]]],
  ["jefe.scc", "Jefe Sección SCC", "Jefe de Sección", [["JEFE_SECCION", "SCC"]]],
  ["inspector.scc1", "Inspector SCC 1", "Inspector", [["ANALISTA", "SCC"]]],
  ["jefe.santof", "Jefe Sucursal Antofagasta", "Jefe de Sucursal", [["JEFE_LAB", "SANTOF"]]],
  ["inspector.santof1", "Inspector Antofagasta 1", "Inspector", [["ANALISTA", "SANTOF"]]],
  ["jefe.sstgo", "Jefe Sucursal Santiago", "Jefe de Sucursal", [["JEFE_LAB", "SSTGO"]]],
  ["jefe.d11", "Jefe Delegación Nº 11", "Jefe de Delegación", [["JEFE_LAB", "D11"]]],
  ["recepcion.1", "Recepción Muestras 1", "Recepcionista", [["RECEPCION", "SMU"]]],
  ["ex.analista", "Analista LQA (inactivo)", "Analista químico", [["ANALISTA", "LQA"]], false],
];

let seq = 1000;
const nuevoId = (pref: string) => `${pref}-${++seq}`;

interface UsuarioStore { id: string; username: string; nombre: string; email: string | null; cargo: string | null; activo: boolean; asign: { id: string; rolId: string; unidadId: string | null; vigenteDesde: string | null; vigenteHasta: string | null }[] }
const usuarios: UsuarioStore[] = PERSONAS.map(([username, nombre, cargo, asign, activo], i) => ({
  id: `usr-${String(i + 1).padStart(3, "0")}`,
  username, nombre, cargo,
  email: `${username}@idic.example`,
  activo: activo !== false,
  asign: asign.map(([rol, unidad, desde, hasta]) => ({
    id: nuevoId("asg"), rolId: rid(rol), unidadId: unidad ? uid(unidad) : null, vigenteDesde: desde ?? null, vigenteHasta: hasta ?? null,
  })),
}));

/** Jefes: titular = primer usuario con JEFE_* en la unidad; subrogante opcional. */
const jefes = new Map<string, { titularId: string | null; subroganteId: string | null }>();
for (const u of usuarios) for (const a of u.asign) {
  const r = roles.find((x) => x.id === a.rolId);
  if (!a.unidadId || !r?.codigo.startsWith("JEFE_") || a.vigenteHasta) continue;
  const j = jefes.get(a.unidadId) ?? { titularId: null, subroganteId: null };
  if (!j.titularId) j.titularId = u.id;
  jefes.set(a.unidadId, j);
}
jefes.set(uid("LCC"), { titularId: "usr-014", subroganteId: "usr-015" });
jefes.set(uid("LME"), { titularId: "usr-018", subroganteId: "usr-019" });

// ───────────────────────────── Matriz de firmas ─────────────────────────────
type F = [tipo: TipoDocumento, unidad: string | null, pasos: [AccionFirma, string, NivelUnidad, boolean?][]];
const FIRMAS_BASE: F[] = [
  ["INFORME_ENSAYO", null, [["REVISA", "ANALISTA_SR", "MISMA", false], ["FIRMA", "JEFE_LAB", "MISMA"], ["APRUEBA", "JEFE_DEPTO", "DEPARTAMENTO"], ["OFICIALIZA", "CALIDAD", "CALIDAD"]]],
  ["INFORME_ENSAYO", "LME", [["FIRMA", "JEFE_LAB", "MISMA"], ["APRUEBA", "JEFE_DEPTO", "DEPARTAMENTO"], ["OFICIALIZA", "CALIDAD", "CALIDAD"]]],
  ["IVC", null, [["FIRMA", "JEFE_LAB", "MISMA"], ["VB", "JEFE_SECCION", "SECCION"]]],
  ["INFORME_TECNICO", null, [["FIRMA", "JEFE_LAB", "MISMA"], ["APRUEBA", "JEFE_DEPTO", "DEPARTAMENTO"]]],
  ["CERTIFICADO_CALIBRACION", null, [["REVISA", "ANALISTA_SR", "MISMA"], ["FIRMA", "JEFE_LAB", "MISMA"], ["VB", "CALIDAD", "CALIDAD", false]]],
  ["INFORME_INSPECCION", null, [["FIRMA", "JEFE_LAB", "MISMA"], ["APRUEBA", "JEFE_SECCION", "SECCION"]]],
  ["CERTIFICADO_CONFORMIDAD", null, [["REVISA", "JEFE_SECCION", "SECCION"], ["FIRMA", "JEFE_DEPTO", "DEPARTAMENTO"], ["OFICIALIZA", "DIRECTOR", "DIRECCION"]]],
  ["CERTIFICADO_CONFORMIDAD", "SANTOF", [["FIRMA", "JEFE_LAB", "MISMA"], ["FIRMA", "JEFE_DEPTO", "DEPARTAMENTO"]]],
  ["INFORME_INCUMPLIMIENTO", null, [["FIRMA", "JEFE_DEPTO", "DEPARTAMENTO"], ["OFICIALIZA", "DIRECTOR", "DIRECCION"]]],
  ["COTIZACION", null, [["REVISA", "COMERCIAL", "COMERCIAL"], ["APRUEBA", "JEFE_DEPTO", "COMERCIAL"]]],
  ["OT_DISPOSICION", null, [["APRUEBA", "JEFE_LAB", "MISMA"]]],
  ["SOLICITUD_ADQUISICION", null, [["VB", "JEFE_LAB", "MISMA"], ["APRUEBA", "JEFE_DEPTO", "DEPARTAMENTO"], ["OFICIALIZA", "DIRECTOR", "DIRECCION"]]],
  ["OFICIO", null, [["VB", "JEFE_DEPTO", "DEPARTAMENTO"], ["FIRMA", "DIRECTOR", "DIRECCION"]]],
];
let firmas: ReglaFirma[] = FIRMAS_BASE.flatMap(([tipo, unidad, pasos]) =>
  pasos.map(([accion, rol, nivel, obligatorio], i) => ({
    id: nuevoId("fm"), tipoDocumento: tipo, unidadId: unidad ? uid(unidad) : null, orden: i + 1,
    accion, rolId: rid(rol), rol: { codigo: rol, nombre: "" }, nivelUnidad: nivel, obligatorio: obligatorio !== false, activo: true,
  })),
);

// ───────────────────────────── Serialización ─────────────────────────────
const unidadRef = (id: string | null) => {
  const u = id ? unidades.find((x) => x.id === id) : null;
  return u ? { id: u.id, codigo: u.codigo, nombre: u.nombre, tipo: u.tipo } : null;
};
const rolRef = (id: string) => {
  const r = roles.find((x) => x.id === id)!;
  return { id: r.id, codigo: r.codigo, nombre: r.nombre, nivel: r.nivel };
};
function usuarioOut(u: UsuarioStore): Usuario {
  return {
    id: u.id, username: u.username, nombre: u.nombre, email: u.email, cargo: u.cargo, activo: u.activo,
    asignaciones: u.asign.filter((a) => roles.some((r) => r.id === a.rolId)).map<Asignacion>((a) => ({
      id: a.id, rol: rolRef(a.rolId), unidad: unidadRef(a.unidadId), vigenteDesde: a.vigenteDesde, vigenteHasta: a.vigenteHasta,
    })),
  };
}
function rolOut(r: Rol): Rol {
  return {
    ...r,
    nPermisos: asignPermisos.get(r.id)?.size ?? 0,
    nUsuarios: usuarios.filter((u) => u.activo && u.asign.some((a) => a.rolId === r.id)).length,
  };
}
function reglaOut(f: ReglaFirma): ReglaFirma {
  const r = roles.find((x) => x.id === f.rolId);
  return { ...f, rol: { codigo: r?.codigo ?? "?", nombre: r?.nombre ?? "?" }, unidad: unidadRef(f.unidadId) };
}
function nombreUsr(id: string | null) { return id ? usuarios.find((u) => u.id === id)?.nombre ?? "?" : null; }
function arbolOut(): NodoUnidad[] {
  const cuenta = (id: string) => usuarios.filter((u) => u.activo && u.asign.some((a) => a.unidadId === id)).length;
  const nodo = (u: Unidad): NodoUnidad => {
    const j = jefes.get(u.id);
    const lj: NodoUnidad["jefes"] = [];
    if (j?.titularId) lj.push({ usuarioId: j.titularId, nombre: nombreUsr(j.titularId)!, rol: "titular" });
    if (j?.subroganteId) lj.push({ usuarioId: j.subroganteId, nombre: nombreUsr(j.subroganteId)!, rol: "subrogante" });
    return { ...u, jefes: lj, nUsuarios: cuenta(u.id), hijos: unidades.filter((h) => h.padreId === u.id).map(nodo) };
  };
  return unidades.filter((u) => !u.padreId || !unidades.some((p) => p.id === u.padreId)).map(nodo);
}

// ───────────────────────────── Resolver ─────────────────────────────
function ancestroDeTipo(id: string, tipo: TipoUnidad): Unidad | null {
  let cur = unidades.find((u) => u.id === id);
  const vistos = new Set<string>();
  while (cur && !vistos.has(cur.id)) {
    if (cur.tipo === tipo) return cur;
    vistos.add(cur.id);
    cur = cur.padreId ? unidades.find((u) => u.id === cur!.padreId) : undefined;
  }
  return null;
}
function unidadObjetivo(origen: string, nivel: NivelUnidad): Unidad | null {
  switch (nivel) {
    case "MISMA": return unidades.find((u) => u.id === origen) ?? null;
    case "SECCION": return ancestroDeTipo(origen, "SECCION") ?? ancestroDeTipo(origen, "DEPARTAMENTO");
    case "DEPARTAMENTO": return ancestroDeTipo(origen, "DEPARTAMENTO");
    case "DIRECCION": return ancestroDeTipo(origen, "DIRECCION");
    case "CALIDAD": return unidades.find((u) => u.codigo === "CAL") ?? null;
    case "COMERCIAL": return unidades.find((u) => u.codigo === "DCOM") ?? null;
  }
}
function resolver(tipo: string, unidadId: string): PasoResuelto[] {
  // excepción más cercana (la propia unidad o un ancestro)
  let cur = unidades.find((u) => u.id === unidadId);
  let reglas: ReglaFirma[] = [];
  let origen: "defecto" | "override" = "defecto";
  const vistos = new Set<string>();
  while (cur && !vistos.has(cur.id)) {
    vistos.add(cur.id);
    const r = firmas.filter((f) => f.tipoDocumento === tipo && f.unidadId === cur!.id && f.activo);
    if (r.length) { reglas = r; origen = "override"; break; }
    cur = cur.padreId ? unidades.find((u) => u.id === cur!.padreId) : undefined;
  }
  if (!reglas.length) reglas = firmas.filter((f) => f.tipoDocumento === tipo && f.unidadId === null && f.activo);
  return [...reglas].sort((a, b) => a.orden - b.orden).map((f) => {
    const rol = roles.find((r) => r.id === f.rolId);
    const obj = unidadObjetivo(unidadId, f.nivelUnidad);
    const personas: PasoResuelto["personas"] = [];
    if (obj && rol?.codigo.startsWith("JEFE_")) {
      const j = jefes.get(obj.id);
      if (j?.titularId) personas.push({ usuarioId: j.titularId, nombre: nombreUsr(j.titularId)!, rol: "titular" });
      if (j?.subroganteId) personas.push({ usuarioId: j.subroganteId, nombre: nombreUsr(j.subroganteId)!, rol: "subrogante" });
    }
    if (!personas.length && rol) {
      for (const u of usuarios) {
        if (!u.activo) continue;
        if (u.asign.some((a) => a.rolId === rol.id && (rol.alcance === "GLOBAL" || a.unidadId === obj?.id))) {
          personas.push({ usuarioId: u.id, nombre: u.nombre });
        }
      }
    }
    return {
      orden: f.orden, accion: f.accion, rol: { codigo: rol?.codigo ?? "?", nombre: rol?.nombre ?? "?" },
      nivelUnidad: f.nivelUnidad, unidad: obj ? { codigo: obj.codigo, nombre: obj.nombre } : null, personas, origen,
    };
  });
}

// ───────────────────────────── Router ─────────────────────────────
class MockError extends Error {
  status: number; noDisponible = false;
  constructor(m: string, s: number) { super(m); this.status = s; }
}
const no = (m: string, s = 404) => { throw new MockError(m, s); };
const espera = () => new Promise((r) => setTimeout(r, 220));
const clon = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export async function mockRequest(method: string, fullPath: string, body?: any): Promise<any> {
  await espera();
  const [path, query = ""] = fullPath.split("?");
  const q = new URLSearchParams(query);
  const seg = path.split("/").filter(Boolean);
  const b = body ?? {};
  const M = method.toUpperCase();

  // /me/alcance
  if (seg[0] === "me" && seg[1] === "alcance") {
    return { usuario: { username: "admin.tic", nombre: "Administrador TIC" }, roles: ["SUPERADMIN"], perfil: null, esGlobal: true, unidadesVisibles: unidades.map((u) => u.id) };
  }

  // /unidades
  if (seg[0] === "unidades") {
    if (seg.length === 1 && M === "GET") return clon(unidades);
    if (seg[1] === "arbol" && M === "GET") return clon(arbolOut());
    if (seg.length === 1 && M === "POST") {
      if (!b.codigo || !b.nombre || !b.tipo) no("Código, nombre y tipo son obligatorios", 400);
      if (unidades.some((u) => u.codigo === b.codigo)) no(`Ya existe una unidad con código ${b.codigo}`, 409);
      const u: Unidad = { id: nuevoId("u"), codigo: b.codigo, nombre: b.nombre, tipo: b.tipo, padreId: b.padreId ?? null, sigla: b.sigla ?? null, icono: b.icono ?? null, color: b.color ?? null, codsucdel: b.codsucdel ?? null, centroCosto: b.centroCosto ?? null, activo: b.activo ?? true };
      unidades.push(u);
      return clon(u);
    }
    const u = unidades.find((x) => x.id === seg[1]) ?? no("Unidad no encontrada");
    if (seg[2] === "jefes" && M === "PUT") {
      const j = jefes.get(u.id) ?? { titularId: null, subroganteId: null };
      if ("titularId" in b) j.titularId = b.titularId ?? null;
      if ("subroganteId" in b) j.subroganteId = b.subroganteId ?? null;
      jefes.set(u.id, j);
      return { ok: true };
    }
    if (M === "PATCH") {
      if (b.padreId && (b.padreId === u.id)) no("Una unidad no puede depender de sí misma", 400);
      Object.assign(u, b);
      return clon(u);
    }
    if (M === "DELETE") { u.activo = false; return undefined; }
  }

  // /usuarios
  if (seg[0] === "usuarios") {
    if (seg.length === 1 && M === "GET") {
      let out = usuarios.map(usuarioOut);
      const txt = q.get("q")?.toLowerCase();
      if (txt) out = out.filter((u) => `${u.nombre} ${u.username} ${u.cargo}`.toLowerCase().includes(txt));
      if (q.get("rolId")) out = out.filter((u) => u.asignaciones.some((a) => a.rol.id === q.get("rolId")));
      if (q.get("unidadId")) out = out.filter((u) => u.asignaciones.some((a) => a.unidad?.id === q.get("unidadId")));
      if (q.get("activo")) out = out.filter((u) => String(u.activo) === q.get("activo"));
      return clon(out);
    }
    if (seg.length === 1 && M === "POST") {
      if (!b.username || !b.nombre) no("Usuario y nombre son obligatorios", 400);
      if (usuarios.some((u) => u.username === b.username)) no(`El usuario «${b.username}» ya existe`, 409);
      const u: UsuarioStore = { id: nuevoId("usr"), username: b.username, nombre: b.nombre, email: b.email ?? null, cargo: b.cargo ?? null, activo: true, asign: [] };
      usuarios.push(u);
      return { ...usuarioOut(u), passwordTemporal: "Temp-" + Math.random().toString(36).slice(2, 8) + "!" };
    }
    const u = usuarios.find((x) => x.id === seg[1]) ?? no("Usuario no encontrado");
    if (seg.length === 2) {
      if (M === "GET") return clon(usuarioOut(u));
      if (M === "PATCH") {
        if (b.username && usuarios.some((x) => x.username === b.username && x.id !== u.id)) no(`El usuario «${b.username}» ya existe`, 409);
        Object.assign(u, b);
        return clon(usuarioOut(u));
      }
      if (M === "DELETE") { u.activo = false; return undefined; }
    }
    if (seg[2] === "asignaciones") {
      if (M === "POST") {
        const rol = roles.find((r) => r.id === b.rolId) ?? no("Rol no encontrado", 400);
        if (rol.alcance !== "GLOBAL" && !b.unidadId) no(`El rol ${rol.codigo} requiere una unidad`, 400);
        const a = { id: nuevoId("asg"), rolId: rol.id, unidadId: rol.alcance === "GLOBAL" ? null : b.unidadId, vigenteDesde: b.vigenteDesde || null, vigenteHasta: b.vigenteHasta || null };
        u.asign.push(a);
        return clon(usuarioOut(u).asignaciones.find((x) => x.id === a.id));
      }
      if (M === "DELETE" && seg[3]) { u.asign = u.asign.filter((a) => a.id !== seg[3]); return undefined; }
    }
    if (seg[2] === "reset-password" && M === "POST") {
      return { passwordTemporal: "Idic-" + Math.random().toString(36).slice(2, 7) + "-" + Math.floor(Math.random() * 90 + 10) };
    }
  }

  // /roles
  if (seg[0] === "roles") {
    if (seg.length === 1 && M === "GET") return clon(roles.map(rolOut));
    if (seg.length === 1 && M === "POST") {
      if (!b.codigo || !b.nombre) no("Código y nombre son obligatorios", 400);
      if (roles.some((r) => r.codigo === b.codigo)) no(`Ya existe el rol ${b.codigo}`, 409);
      const r: Rol = { id: nuevoId("rol"), codigo: String(b.codigo).toUpperCase(), nombre: b.nombre, nivel: b.nivel ?? "OPERATIVO", alcance: b.alcance ?? "UNIDAD", descripcion: b.descripcion ?? null, esSistema: false };
      roles.push(r);
      asignPermisos.set(r.id, new Set());
      return clon(rolOut(r));
    }
    const r = roles.find((x) => x.id === seg[1]) ?? no("Rol no encontrado");
    if (seg.length === 2 && M === "PATCH") { Object.assign(r, b); return clon(rolOut(r)); }
    if (seg[2] === "permisos" && M === "GET") return [...(asignPermisos.get(r.id) ?? [])];
    if (seg[2] === "permisos" && M === "PUT") {
      const validos = new Set(TODOS);
      asignPermisos.set(r.id, new Set((b.codigos ?? []).filter((c: string) => validos.has(c))));
      return { ok: true };
    }
  }

  // /permisos/matriz
  if (seg[0] === "permisos" && seg[1] === "matriz" && M === "GET") {
    return {
      modulos: Object.entries(MODULOS).map(([modulo, acc]) => ({
        modulo, permisos: acc.map(([accion, descripcion]) => ({ id: `perm-${modulo}.${accion}`, codigo: `${modulo}.${accion}`, accion, descripcion })),
      })),
      roles: roles.map((r) => rolRef(r.id)),
      asignaciones: Object.fromEntries(roles.map((r) => [r.id, [...(asignPermisos.get(r.id) ?? [])]])),
    };
  }

  // /firmas-matriz
  if (seg[0] === "firmas-matriz") {
    if (seg[1] === "resolver" && M === "GET") {
      const tipo = q.get("tipoDocumento") ?? no("tipoDocumento requerido", 400);
      const un = q.get("unidadId") ?? no("unidadId requerido", 400);
      return clon(resolver(tipo, un));
    }
    if (seg.length === 1 && M === "GET") {
      let out = firmas;
      if (q.get("tipoDocumento")) out = out.filter((f) => f.tipoDocumento === q.get("tipoDocumento"));
      if (q.get("unidadId")) out = out.filter((f) => f.unidadId === q.get("unidadId"));
      return clon(out.map(reglaOut).sort((a, b) => a.orden - b.orden));
    }
    if (seg.length === 1 && M === "POST") {
      if (!b.tipoDocumento || !b.accion || !b.rolId || !b.nivelUnidad) no("Faltan datos del paso", 400);
      const f: ReglaFirma = { id: nuevoId("fm"), tipoDocumento: b.tipoDocumento, unidadId: b.unidadId ?? null, orden: b.orden ?? 99, accion: b.accion, rolId: b.rolId, rol: { codigo: "", nombre: "" }, nivelUnidad: b.nivelUnidad, obligatorio: b.obligatorio ?? true, activo: b.activo ?? true };
      firmas.push(f);
      return clon(reglaOut(f));
    }
    const f = firmas.find((x) => x.id === seg[1]) ?? no("Regla no encontrada");
    if (M === "PATCH") { Object.assign(f, b); return clon(reglaOut(f)); }
    if (M === "DELETE") { firmas = firmas.filter((x) => x.id !== f.id); return undefined; }
  }

  throw new MockError(`Cannot ${M} ${path}`, 404);
}
