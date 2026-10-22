/**
 * Vocabulario de la administración de roles con alcance por laboratorio.
 * Fuente de verdad de los valores: packages/db/align_admin_roles.sql (CHECKs).
 * Contrato documentado en docs/ADMIN_ROLES.md.
 */

export const TIPOS_UNIDAD = [
  "DIRECCION",
  "DEPARTAMENTO",
  "SECCION",
  "LABORATORIO",
  "SUCURSAL",
  "DELEGACION",
  "APOYO",
] as const;
export type TipoUnidad = (typeof TIPOS_UNIDAD)[number];

export const NIVELES_ROL = ["OPERATIVO", "JEFATURA", "DIRECCION", "SOPORTE", "SISTEMA"] as const;
export type NivelRol = (typeof NIVELES_ROL)[number];

export const ALCANCES = ["UNIDAD", "DESCENDENCIA", "GLOBAL"] as const;
export type Alcance = (typeof ALCANCES)[number];

export const TIPOS_DOCUMENTO = [
  "INFORME_ENSAYO",
  "IVC",
  "INFORME_TECNICO",
  "CERTIFICADO_CALIBRACION",
  "INFORME_INSPECCION",
  "CERTIFICADO_CONFORMIDAD",
  "INFORME_INCUMPLIMIENTO",
  "COTIZACION",
  "OT_DISPOSICION",
  "SOLICITUD_ADQUISICION",
  "OFICIO",
  "CERTIFICADO_RESISTENCIA_BALISTICA",
  "INFORME_RECHAZO",
  // Delegación Nº 11 (EP-11 11.42, align_r4b_d11.sql)
  "CERTIFICADO_ARMA",
  "INFORME_INCUMPLIMIENTO_ARMA",
  "CERTIFICADO_EVIDENCIA",
  "INFORME_PERICIAL",
  "NOTA_NO_CONFORMIDAD",
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/** ELABORA se añade al vocabulario pedido (REVISA..VB) para «comercial elabora», «metrólogo calibra». */
export const ACCIONES_FIRMA = ["ELABORA", "REVISA", "APRUEBA", "FIRMA", "OFICIALIZA", "VB"] as const;
export type AccionFirma = (typeof ACCIONES_FIRMA)[number];

/** FIJA = la unidad indicada en unidadDestinoId (p. ej. SCC, SAB). */
export const NIVELES_UNIDAD_FIRMA = [
  "MISMA",
  "SECCION",
  "DEPARTAMENTO",
  "DIRECCION",
  "CALIDAD",
  "COMERCIAL",
  "FIJA",
] as const;
export type NivelUnidadFirma = (typeof NIVELES_UNIDAD_FIRMA)[number];

/** Códigos de unidad de referencia para los niveles DIRECCION / CALIDAD / COMERCIAL. */
export const UNIDADES_REFERENCIA = { direccion: "DIR", calidad: "DGC", comercial: "DCO" } as const;

/** Alias de códigos legados (BD antiguas) → código canónico. También en BD: rol.alias_de. */
export const ALIAS_ROL: Record<string, string> = {
  JEFELAB: "JEFE_LAB",
  JEFEDCO: "JEFE_DEPTO",
  ANALISTA_SR: "REVISOR",
};

/** Roles que SIEMPRE ven todo, con independencia de lo que diga rol.alcance. */
export const ROLES_SIEMPRE_GLOBALES = ["SUPERADMIN", "ADMIN", "DIRECTOR", "SUBDIRECTOR"];

/**
 * Ámbitos de módulo (@AmbitoUnidad y menú). Un código que no esté aquí se
 * interpreta como { raiz: código }.
 *   · D11       · SAEC (evidencias, armas, IBIS). Estricto: el alcance global
 *                 solo deja pasar a Superadministración, Dirección, Subdirección
 *                 y Lector/Auditor (este, con permisos de solo lectura). El
 *                 resto necesita una unidad de la Delegación Nº 11 (o que la
 *                 tenga bajo su mando).
 *   · BPCH      · procesos con unidad que inspecciona (internación, reinspección,
 *                 prototipos, clasificación): la Delegación Nº 11 entra, pero
 *                 los listados la dejan solo en lo que inspecciona ella.
 *   · BPCH_CERT · registros nacionales de BPCH Certificación (Codificación
 *                 Única, Producción Nacional): toda la rama BPCH menos la D11.
 */
export const AMBITOS: Record<string, { raiz: string; excluye?: string[]; globalSolo?: string[] }> = {
  D11: { raiz: "D11", globalSolo: ["SUPERADMIN", "DIRECTOR", "SUBDIRECTOR", "LECTOR"] },
  BPCH: { raiz: "BPCH" },
  BPCH_CERT: { raiz: "BPCH", excluye: ["D11"] },
  DCO: { raiz: "DCO" },
  SAM: { raiz: "SAM" },
};

export function definicionAmbito(codigo: string) {
  return AMBITOS[codigo] ?? { raiz: codigo };
}

/** Alcance por defecto si la BD no lo tiene (BD sin align_admin_roles.sql). */
export const ALCANCE_POR_DEFECTO: Record<string, Alcance> = {
  SUPERADMIN: "GLOBAL",
  ADMIN: "GLOBAL",
  DIRECTOR: "GLOBAL",
  SUBDIRECTOR: "GLOBAL",
  JEFE_DEPTO: "DESCENDENCIA",
  JEFE_SECCION: "DESCENDENCIA",
  JEFE_LAB: "UNIDAD",
  REVISOR: "UNIDAD",
  ANALISTA: "UNIDAD",
  TECNICO: "UNIDAD",
  INSPECTOR: "UNIDAD",
  METROLOGO: "UNIDAD",
  RECEPCION: "GLOBAL",
  COMERCIAL: "GLOBAL",
  PLANIFICACION: "GLOBAL",
  MUESTREO: "GLOBAL",
  FINANZAS: "GLOBAL",
  COBRANZA: "GLOBAL",
  ABASTECIMIENTO: "GLOBAL",
  CALIDAD: "GLOBAL",
  LECTOR: "GLOBAL",
  CLIENTE: "UNIDAD",
};

/** Perfiles de bandeja, de mayor a menor prioridad (se elige el más alto). */
export const PERFILES = [
  "DIRECTOR",
  "JEFE_DEPTO",
  "JEFE_SECCION",
  "JEFE_LAB",
  "REVISOR",
  "ANALISTA",
  "COMERCIAL",
  "PLANIFICACION",
  "FINANZAS",
  "ABASTECIMIENTO",
  "CALIDAD",
  "ADMIN",
  "LECTOR",
] as const;
export type Perfil = (typeof PERFILES)[number];

/** Rol canónico → perfil de bandeja. */
export const ROL_A_PERFIL: Record<string, Perfil> = {
  SUPERADMIN: "ADMIN",
  ADMIN: "ADMIN",
  DIRECTOR: "DIRECTOR",
  SUBDIRECTOR: "DIRECTOR",
  JEFE_DEPTO: "JEFE_DEPTO",
  JEFE_SECCION: "JEFE_SECCION",
  JEFE_LAB: "JEFE_LAB",
  REVISOR: "REVISOR",
  ANALISTA: "ANALISTA",
  TECNICO: "ANALISTA",
  METROLOGO: "ANALISTA",
  INSPECTOR: "ANALISTA",
  RECEPCION: "ANALISTA",
  COMERCIAL: "COMERCIAL",
  MUESTREO: "COMERCIAL",
  PLANIFICACION: "PLANIFICACION",
  FINANZAS: "FINANZAS",
  COBRANZA: "FINANZAS",
  ABASTECIMIENTO: "ABASTECIMIENTO",
  CALIDAD: "CALIDAD",
  LECTOR: "LECTOR",
  CLIENTE: "LECTOR",
};

/** Roles personalizados (sin mapeo) → perfil según su nivel. */
export const NIVEL_A_PERFIL: Record<string, Perfil> = {
  DIRECCION: "DIRECTOR",
  JEFATURA: "JEFE_LAB",
  OPERATIVO: "ANALISTA",
  SOPORTE: "LECTOR",
  SISTEMA: "ADMIN",
};

/** Ser jefe (unidad_jefe) de una unidad de este tipo implica este perfil. */
export const TIPO_JEFATURA_A_PERFIL: Partial<Record<TipoUnidad, Perfil>> = {
  DIRECCION: "DIRECTOR",
  DEPARTAMENTO: "JEFE_DEPTO",
  SECCION: "JEFE_SECCION",
  LABORATORIO: "JEFE_LAB",
  SUCURSAL: "JEFE_LAB",
  DELEGACION: "JEFE_LAB",
};

export function codigoCanonico(codigo: string, aliasDe?: string | null): string {
  return aliasDe || ALIAS_ROL[codigo] || codigo;
}
