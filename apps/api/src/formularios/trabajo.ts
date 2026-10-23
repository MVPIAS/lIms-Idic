/**
 * Preparación del trabajo del DSA (tema T26, EP-05 F2) · reglas PURAS,
 * probadas en trabajo.spec.ts.
 *
 *   2.1 Asignar personal y equipos: inspectores y Jefe de Comisión (SVM) y
 *       equipos reservados; un equipo con la calibración vencida (o no apto)
 *       no se puede reservar.
 *   2.2 Preparar la documentación del trabajo, con un formulario por
 *       laboratorio: Planilla de trabajo (LRB), Plan de trabajo (LAM), Plan de
 *       inspección (SEO), Paquete técnico (SVM) y Proyecto de Párrafo del
 *       trabajo en terreno (LEM). Botón «Enviar a aprobación → Jefe».
 *   2.3 Aprobar la documentación: LRB y SVM, el Jefe de Laboratorio; LEM en
 *       terreno, el Jefe de Sección valida y el Jefe DSA aprueba. «Devolver con
 *       comentario» (obligatorio) vuelve a 2.2. Todo queda en la bitácora.
 *
 * Qué laboratorios exigen la aprobación y si la captura espera a que esté
 * aprobada son parámetros (`preparacion_trabajo`). Los viáticos y la rendición
 * de la comisión quedan fuera de alcance (EP-05 2.4, P22).
 */

export const LABS_DSA = ["LRB", "LAM", "SEO", "SVM", "LEM"] as const;

export type TipoCampoTrabajo = "texto" | "texto_largo" | "fecha" | "entero" | "lista" | "multiple" | "amenazas" | "hcp" | "casilla";

export interface CampoTrabajo {
  campo: string;
  etiqueta: string;
  tipo: TipoCampoTrabajo;
  obligatorio?: boolean;
  /** Solo se pide si la casilla `si` está marcada (p. ej. LEM en terreno). */
  si?: string;
  opciones?: { valor: string; etiqueta: string }[];
  ayuda?: string;
}

export interface FormularioTrabajo {
  lab: string;
  titulo: string;
  /** Quién lo prepara (texto para la pantalla). */
  prepara: string;
  campos: CampoTrabajo[];
}

const ops = (...xs: string[]) => xs.map((x) => ({ valor: x, etiqueta: x }));

export const FORMULARIOS_TRABAJO: Record<string, FormularioTrabajo> = {
  LRB: {
    lab: "LRB",
    titulo: "Planilla de trabajo",
    prepara: "Analista LRB",
    campos: [
      { campo: "amenazas", etiqueta: "Norma, nivel y munición (tabla de amenazas)", tipo: "amenazas", obligatorio: true },
      { campo: "plan_disparos", etiqueta: "Plan de disparos", tipo: "texto", obligatorio: true, ayuda: "Por elemento: chaleco 6 disparos por panel; casco 4; probeta UL 3." },
      { campo: "cartuchos", etiqueta: "Munición requerida · Nº de cartuchos", tipo: "entero", obligatorio: true },
      { campo: "recursos", etiqueta: "Apoyo no operativo pedido a la Sección (si faltan recursos)", tipo: "texto_largo" },
    ],
  },
  LAM: {
    lab: "LAM",
    titulo: "Plan de trabajo",
    prepara: "Jefe LAM",
    campos: [
      { campo: "lugar", etiqueta: "Lugar", tipo: "texto", obligatorio: true },
      { campo: "fecha_inicio", etiqueta: "Fecha de inicio", tipo: "fecha", obligatorio: true },
      { campo: "fecha_termino", etiqueta: "Fecha de término", tipo: "fecha" },
      { campo: "normas", etiqueta: "Normas", tipo: "multiple", obligatorio: true, opciones: ops("NCh 43", "NCh 44", "STANAG", "MIL-STD", "MULTIMOPI") },
    ],
  },
  SEO: {
    lab: "SEO",
    titulo: "Plan de inspección",
    prepara: "Jefe Técnico SEO",
    campos: [
      { campo: "tipo", etiqueta: "Tipo de inspección", tipo: "lista", obligatorio: true, opciones: ops("FAT", "SAT", "Verificación de calidad", "Recepción cualitativa", "Reinspección") },
      { campo: "et_contrato", etiqueta: "E.T. del contrato y versión", tipo: "texto", obligatorio: true },
      { campo: "lugar", etiqueta: "Lugar", tipo: "texto" },
      { campo: "fecha_inicio", etiqueta: "Fecha de inicio", tipo: "fecha" },
    ],
  },
  SVM: {
    lab: "SVM",
    titulo: "Paquete técnico",
    prepara: "Analista SVM",
    campos: [
      { campo: "resolucion", etiqueta: "Resolución", tipo: "texto", obligatorio: true },
      { campo: "proyecto_parrafo", etiqueta: "Proyecto de Párrafo O/D", tipo: "texto" },
      { campo: "hcp", etiqueta: "HCP del tipo de vehículo", tipo: "hcp", obligatorio: true },
      { campo: "planilla_muestreo", etiqueta: "Planilla de muestreo (NCh 44)", tipo: "texto" },
      { campo: "guia_despacho", etiqueta: "Guía de despacho de equipos", tipo: "texto" },
      { campo: "eett", etiqueta: "EE.TT. / RTs y versión", tipo: "texto", obligatorio: true },
      { campo: "protocolo", etiqueta: "Protocolo", tipo: "lista", opciones: ops("Protocolo de Recepción (PR)", "Protocolo de Pruebas (PP)") },
    ],
  },
  LEM: {
    lab: "LEM",
    titulo: "Proyecto de Párrafo (trabajo en terreno)",
    prepara: "Jefe LEM",
    campos: [
      { campo: "terreno", etiqueta: "El trabajo es en terreno", tipo: "casilla", ayuda: "Solo el trabajo en terreno lleva Proyecto de Párrafo y aprobación (Jefe de Sección valida, Jefe DSA aprueba)." },
      { campo: "lugar", etiqueta: "Lugar", tipo: "texto", obligatorio: true, si: "terreno" },
      { campo: "fecha_inicio", etiqueta: "Fecha de inicio", tipo: "fecha", obligatorio: true, si: "terreno" },
      { campo: "fecha_termino", etiqueta: "Fecha de término", tipo: "fecha", si: "terreno" },
      { campo: "personal", etiqueta: "Personal", tipo: "texto", obligatorio: true, si: "terreno" },
      { campo: "transporte", etiqueta: "Pasajes / transporte", tipo: "texto", si: "terreno" },
      { campo: "combustible", etiqueta: "Combustible", tipo: "texto", si: "terreno" },
    ],
  },
};

export type EstadoTrabajo = "borrador" | "en_aprobacion" | "validada" | "aprobada" | "devuelta" | "registrada";

export const TEXTO_ESTADO_TRABAJO: Record<EstadoTrabajo, string> = {
  borrador: "Borrador",
  en_aprobacion: "Pendiente de aprobación",
  validada: "Validada por el Jefe de Sección · falta el Jefe DSA",
  aprobada: "Aprobada",
  devuelta: "Devuelta con comentario",
  registrada: "Registrada (no requiere aprobación)",
};

/* ------------------------------------------------------- 2.1 asignación --- */

export interface EquipoReserva {
  id: string;
  codigo: string;
  apto: boolean;
  motivo: string | null;
}

/** Equipos que no se pueden reservar (calibración vencida, en calibración, fuera de servicio). */
export function erroresReserva(equipos: EquipoReserva[], pedidos: string[]): string[] {
  const e: string[] = [];
  const porId = new Map(equipos.map((x) => [x.id, x]));
  for (const id of new Set(pedidos)) {
    const eq = porId.get(id);
    if (!eq) e.push("Uno de los equipos no es del laboratorio de la OT.");
    else if (!eq.apto) e.push(`El equipo ${eq.codigo} no se puede reservar: ${eq.motivo ?? "calibración vencida"}.`);
  }
  return e;
}

/** Jefe de Comisión e inspectores: personas del laboratorio, el jefe entre ellos o aparte, sin repetir. */
export function erroresComision(p: { jefeComision: string | null; inspectores: string[] }, personal: Set<string>): string[] {
  const e: string[] = [];
  if (p.jefeComision && !personal.has(p.jefeComision)) e.push("El Jefe de Comisión debe ser personal con rol vigente en el laboratorio.");
  if (p.inspectores.some((x) => !personal.has(x))) e.push("Los inspectores deben ser personal con rol vigente en el laboratorio.");
  if (new Set(p.inspectores).size !== p.inspectores.length) e.push("Hay inspectores repetidos.");
  return e;
}

/* -------------------------------------------------- 2.2 documentación --- */

export interface ContextoTrabajo {
  /** Claves de la tabla de amenazas del LRB. */
  amenazas: string[];
  /** Códigos de las plantillas de HCP. */
  plantillasHcp: string[];
}

export function erroresDocumentacion(f: FormularioTrabajo, datos: Record<string, unknown>, ctx: ContextoTrabajo): string[] {
  const e: string[] = [];
  const conocidos = new Set(f.campos.map((c) => c.campo));
  for (const k of Object.keys(datos)) if (!conocidos.has(k)) e.push(`El campo «${k}» no es de la ${f.titulo}.`);
  for (const c of f.campos) {
    if (c.si && datos[c.si] !== true) continue;
    const v = datos[c.campo];
    const vacio = v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
    if (vacio) {
      if (c.obligatorio) e.push(`${c.etiqueta}: es obligatorio.`);
      continue;
    }
    switch (c.tipo) {
      case "texto":
      case "texto_largo":
        if (typeof v !== "string" || v.length > (c.tipo === "texto" ? 300 : 2000)) e.push(`${c.etiqueta}: texto demasiado largo.`);
        break;
      case "fecha":
        if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) e.push(`${c.etiqueta}: fecha no válida.`);
        break;
      case "entero":
        if (!Number.isInteger(Number(v)) || Number(v) < 0) e.push(`${c.etiqueta}: escriba un número entero.`);
        break;
      case "lista":
        if (!c.opciones?.some((o) => o.valor === v)) e.push(`${c.etiqueta}: elija una de las opciones.`);
        break;
      case "multiple":
        if (!Array.isArray(v) || v.some((x) => !c.opciones?.some((o) => o.valor === x))) e.push(`${c.etiqueta}: opciones no válidas.`);
        break;
      case "amenazas":
        if (!Array.isArray(v) || v.some((x) => !ctx.amenazas.includes(String(x)))) e.push(`${c.etiqueta}: elija filas de la tabla de amenazas.`);
        break;
      case "hcp":
        if (!ctx.plantillasHcp.includes(String(v))) e.push(`${c.etiqueta}: elija una HCP configurada.`);
        break;
      case "casilla":
        if (typeof v !== "boolean") e.push(`${c.etiqueta}: marque o desmarque.`);
        break;
    }
  }
  const fi = datos.fecha_inicio, ft = datos.fecha_termino;
  if (typeof fi === "string" && typeof ft === "string" && ft < fi) e.push("La fecha de término no puede ser anterior a la de inicio.");
  return e;
}

/* -------------------------------------------------------- 2.3 aprobación --- */

export interface ConfigTrabajo {
  /** Laboratorios cuya documentación se aprueba antes de ejecutar. */
  exigeAprobacion: string[];
  /** Mientras no esté aprobada, la captura de esos laboratorios espera. */
  bloqueaCaptura: boolean;
}

/** ¿La documentación de este laboratorio pasa por aprobación? (LEM solo en terreno.) */
/**
 * B-089 · ¿El lugar de ejecución del encargo es fuera del IDIC? (fábrica nacional
 * o extranjera, unidad militar). Entonces el trabajo del LEM se propone «en
 * terreno» (lo que exige la aprobación previa) mientras nadie haya marcado otra cosa.
 */
export function terrenoPorLugar(lugarEjecucion: string | null | undefined): boolean {
  const l = String(lugarEjecucion ?? "").trim().toUpperCase();
  return l !== "" && l !== "IDIC";
}

/** La documentación con «terreno» propuesto por el lugar de ejecución si aún no se marcó. */
export function conTerrenoPropuesto(lab: string, documentacion: Record<string, unknown>, lugarEjecucion: string | null | undefined): Record<string, unknown> {
  if (lab !== "LEM" || typeof documentacion.terreno === "boolean") return documentacion;
  return terrenoPorLugar(lugarEjecucion) ? { ...documentacion, terreno: true } : documentacion;
}

export function exigeAprobacion(lab: string, datos: Record<string, unknown>, cfg: ConfigTrabajo): boolean {
  if (lab === "LEM") return datos.terreno === true;
  return cfg.exigeAprobacion.includes(lab);
}

/** Circuito de aprobación: LEM terreno en dos pasos; el resto, el Jefe de Laboratorio. */
export function pasosAprobacion(lab: string): { paso: "validar" | "aprobar"; rol: "JEFE_LAB" | "JEFE_SECCION" | "JEFE_DEPTO"; texto: string }[] {
  if (lab === "LEM")
    return [
      { paso: "validar", rol: "JEFE_SECCION", texto: "Valida el Jefe de la Sección Ensayos Mecánicos" },
      { paso: "aprobar", rol: "JEFE_DEPTO", texto: "Aprueba el Jefe del Departamento Sistemas de Armas" },
    ];
  return [{ paso: "aprobar", rol: "JEFE_LAB", texto: `Aprueba el Jefe de ${lab}` }];
}

export type AccionTrabajo = "guardar" | "enviar" | "validar" | "aprobar" | "devolver";

export interface ContextoAccion {
  estado: EstadoTrabajo;
  lab: string;
  exige: boolean;
  /** Roles del usuario en la unidad que corresponde (con alcance ya comprobado). */
  rolesUsuario: string[];
  esSuperadmin?: boolean;
  documentacionCompleta: boolean;
  comentario?: string | null;
}

/** Siguiente estado de una acción, o el motivo por el que no se puede. */
export function transicion(accion: AccionTrabajo, c: ContextoAccion): { estado: EstadoTrabajo } | { error: string } {
  const editable = ["borrador", "devuelta", "registrada"].includes(c.estado);
  const pasos = pasosAprobacion(c.lab);
  const tiene = (rol: string) => c.esSuperadmin || c.rolesUsuario.includes(rol);
  switch (accion) {
    case "guardar":
      if (!editable) return { error: "La documentación está en aprobación o aprobada: no se modifica (si hay que cambiarla, que la devuelvan)." };
      return { estado: c.estado === "registrada" ? "registrada" : c.estado === "devuelta" ? "devuelta" : "borrador" };
    case "enviar":
      if (!editable) return { error: "La documentación ya fue enviada." };
      if (!c.documentacionCompleta) return { error: "Complete los campos obligatorios antes de enviarla." };
      return { estado: c.exige ? "en_aprobacion" : "registrada" };
    case "validar": {
      if (pasos.length < 2) return { error: "La documentación de este laboratorio no lleva validación del Jefe de Sección." };
      if (c.estado !== "en_aprobacion") return { error: "No hay documentación pendiente de validación." };
      if (!tiene("JEFE_SECCION")) return { error: "Valida el Jefe de la Sección Ensayos Mecánicos." };
      return { estado: "validada" };
    }
    case "aprobar": {
      const ultimo = pasos[pasos.length - 1];
      const esperado = pasos.length > 1 ? "validada" : "en_aprobacion";
      if (c.estado !== esperado)
        return { error: pasos.length > 1 && c.estado === "en_aprobacion" ? "Primero la valida el Jefe de Sección." : "No hay documentación pendiente de aprobación." };
      if (!tiene(ultimo.rol)) return { error: `${ultimo.texto}.` };
      return { estado: "aprobada" };
    }
    case "devolver": {
      if (!["en_aprobacion", "validada"].includes(c.estado)) return { error: "Solo se devuelve una documentación en aprobación." };
      if ((c.comentario ?? "").trim().length < 5) return { error: "Indique el comentario de la devolución (mínimo 5 caracteres)." };
      const puede = c.estado === "validada" ? tiene(pasos[pasos.length - 1].rol) : tiene(pasos[0].rol);
      if (!puede) return { error: "Devuelve quien debe aprobar o validar en este paso." };
      return { estado: "devuelta" };
    }
  }
}

/** Motivo por el que la captura espera (null = se puede capturar). */
export function motivoBloqueoTrabajo(p: { lab: string; exige: boolean; estado: EstadoTrabajo | null; bloqueaCaptura: boolean }): string | null {
  if (!p.exige || !p.bloqueaCaptura || p.estado === "aprobada") return null;
  const como = p.estado === "en_aprobacion" || p.estado === "validada" ? "está pendiente de aprobación" : p.estado === "devuelta" ? "fue devuelta y hay que corregirla" : "no se ha preparado";
  return `La documentación del trabajo (${FORMULARIOS_TRABAJO[p.lab]?.titulo ?? "preparación"}) ${como}: la ejecución espera su aprobación (EP-05 2.3). OT › Preparación.`;
}

export function leerConfigTrabajo(filas: { codigo: string; valor: string | null; activo: boolean }[]): ConfigTrabajo {
  const exige = filas.find((f) => f.codigo === "exige_aprobacion" && f.activo);
  const bloquea = filas.find((f) => f.codigo === "bloquea_captura" && f.activo);
  return {
    exigeAprobacion: exige ? String(exige.valor ?? "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean) : ["LRB", "SVM"],
    bloqueaCaptura: bloquea ? !["no", "false", "0"].includes(String(bloquea.valor ?? "").trim().toLowerCase()) : true,
  };
}

/**
 * Concordancia del documento de trabajo en los textos (B-085: «Preparar la
 * Paquete técnico»). Masculinos: «Plan …», «Paquete …», «Proyecto …».
 */
export function generoDocumentoTrabajo(titulo: string): { art: "el" | "la"; o: "o" | "a"; lo: "lo" | "la" } {
  const m = /^(plan|paquete|proyecto)\b/i.test(String(titulo ?? "").trim());
  return m ? { art: "el", o: "o", lo: "lo" } : { art: "la", o: "a", lo: "la" };
}
