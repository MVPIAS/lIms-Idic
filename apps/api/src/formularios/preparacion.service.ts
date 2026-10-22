/**
 * Preparación y acondicionamiento de muestras (T29) y preparación del trabajo
 * del DSA (T26: asignación de comisión y equipos, documentación y su
 * aprobación). Reglas puras: preparacion.ts y trabajo.ts.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { hoyChile } from "../common/fecha-chile";
import { AlcanceService } from "../rbac/alcance.service";
import { FormulariosDatos, tenantDe, usuarioDe, type OtFormulario } from "./formularios.datos";
import { ReglasCapturaService } from "./reglas-captura.service";
import { evaluarPreparacion, leerCampoPrep, type CampoPrep } from "./preparacion";
import {
  erroresComision, erroresDocumentacion, erroresReserva, exigeAprobacion, FORMULARIOS_TRABAJO, LABS_DSA, leerConfigTrabajo, pasosAprobacion, TEXTO_ESTADO_TRABAJO, transicion,
  type AccionTrabajo, type EstadoTrabajo,
} from "./trabajo";
import { leerAmenazas } from "./lrb";
import { LaboratorioOtService } from "../ot/laboratorio-ot.service";

/** Adjuntos admitidos: PDF e imágenes (proyectos de párrafo, oficios, planillas escaneadas). */
const MIME_ADJUNTO = new Set(["application/pdf", "image/png", "image/jpeg"]);
export const MAX_ADJUNTO_BYTES = 5 * 1024 * 1024;

@Injectable()
export class PreparacionService {
  constructor(
    private readonly d: FormulariosDatos,
    private readonly reglas: ReglasCapturaService,
    private readonly alcance: AlcanceService,
    private readonly labs: LaboratorioOtService,
  ) {}

  /* ---------------------------------------------------- muestras (T29) --- */

  /** Campos configurados de la preparación de un laboratorio (activos, en orden). */
  private async campos(tenantId: string, lab: string): Promise<CampoPrep[]> {
    const filas = await this.d.prisma.$queryRawUnsafe<{ codigo: string; etiqueta: string; valor: string | null; activo: boolean; orden: number }[]>(
      `SELECT codigo, etiqueta, valor, activo, orden FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND categoria = 'preparacion_campo' AND split_part(codigo, '.', 1) = $2 ORDER BY orden, codigo`,
      tenantId,
      lab,
    );
    return filas.map((f) => leerCampoPrep(f)).filter((c): c is CampoPrep => !!c);
  }

  /** Laboratorios que trabajan cada muestra (dueños de sus ensayos), con su código. */
  private async labsPorMuestra(otId: string) {
    const ensayos = await this.d.ensayosOt(otId);
    const det = await this.reglas.ensayos(ensayos.map((e) => e.id));
    const m = new Map<string, Map<string, string>>();
    for (const e of det) if (e.laboratorio && e.laboratorioId) (m.get(e.muestraId) ?? m.set(e.muestraId, new Map()).get(e.muestraId)!).set(e.laboratorio, e.laboratorioId);
    return m;
  }

  async muestrasVer(otId: string, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    const vista = await this.d.vista(req, ot, "resultado.ver");
    const [muestras, porMuestra, regs] = await Promise.all([this.d.muestras(otId), this.labsPorMuestra(otId), this.d.registros(otId, "preparacion")]);
    let vistaCaptura: { todo: boolean; labs: Set<string> } | null = null;
    try {
      vistaCaptura = await this.d.vista(req, ot, "resultado.crear");
    } catch {
      vistaCaptura = null;
    }
    const obligatorias = await this.d.params(tenantId, "preparacion_obligatoria");
    const labsCodigo = new Map<string, string>();
    if (ot.laboratorio && ot.unidadPrincipal) labsCodigo.set(ot.laboratorio, ot.unidadPrincipal);
    for (const ls of porMuestra.values()) for (const [c, id] of ls) labsCodigo.set(c, id);
    const camposPorLab = new Map<string, CampoPrep[]>();
    for (const lab of labsCodigo.keys()) camposPorLab.set(lab, await this.campos(tenantId, lab));
    const equipos = await this.d.equipos(tenantId, [...labsCodigo.values()]);
    const filas = muestras.flatMap((m) => {
      const labs = porMuestra.get(m.id) ?? new Map(ot.laboratorio && ot.unidadPrincipal ? [[ot.laboratorio, ot.unidadPrincipal]] : []);
      return [...labs].map(([lab, labId]) => {
        if (!vista.todo && !vista.labs.has(labId)) return null;
        const reg = regs.find((r) => r.clave === `${m.id}:${lab}`) ?? null;
        return {
          muestra: m,
          laboratorio: lab,
          laboratorioId: labId,
          campos: camposPorLab.get(lab) ?? [],
          obligatoria: obligatorias.some((o) => o.codigo === lab && o.activo),
          registro: reg ? { id: reg.id, version: reg.version, estado: reg.estado, datos: reg.datos, actualizadoPorNombre: reg.actualizadoPorNombre, updatedAt: reg.updatedAt } : null,
          puedeEditar: !!vistaCaptura && (vistaCaptura.todo || vistaCaptura.labs.has(labId)) && !["cerrada", "anulada"].includes(ot.estado),
        };
      });
    }).filter(Boolean);
    return { ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, laboratorio: ot.laboratorio }, filas, equipos };
  }

  /** «Registrar preparación → análisis». Corregir una preparación ya registrada exige motivo. */
  async muestraGuardar(otId: string, muestraId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const muestra = (await this.d.muestras(otId)).find((m) => m.id === muestraId);
    if (!muestra) throw new NotFoundException("La muestra no es de esta OT.");
    const lab = String(body?.laboratorio ?? "").toUpperCase();
    const labId = (await this.labsPorMuestra(otId)).get(muestraId)?.get(lab) ?? (lab === ot.laboratorio ? ot.unidadPrincipal : null);
    if (!labId) throw new BadRequestException(`La muestra ${muestra.codigo} no tiene ensayos de ${lab || "ese laboratorio"}.`);
    await this.d.exigirLab(req, ot, "resultado.crear", labId, `la preparación de ${lab}`);
    const campos = await this.campos(tenantId, lab);
    if (!campos.length) throw new BadRequestException(`El laboratorio ${lab} no tiene campos de preparación configurados (Parámetros › Preparación).`);
    const equipos = await this.d.equipos(tenantId, [labId]);
    const ev = evaluarPreparacion(campos, typeof body?.datos === "object" && body.datos ? body.datos : {}, {
      hoy: hoyChile(),
      muestraCodigo: muestra.codigo,
      equipos: new Map(equipos.map((e) => [e.id, { id: e.id, codigo: e.codigo, apto: e.apto, motivo: e.motivo }])),
    });
    if (ev.errores.length) throw new BadRequestException(ev.errores.join(" "));
    const clave = `${muestraId}:${lab}`;
    const previo = await this.d.registro(otId, "preparacion", clave);
    const corrige = previo && JSON.stringify(previo.datos?.valores ?? {}) !== JSON.stringify(ev.datos);
    const motivo = corrige ? (typeof body?.motivo === "string" && body.motivo.trim().length >= 5 ? body.motivo.trim() : null) : null;
    if (corrige && !motivo) throw new BadRequestException("Indique el motivo de la corrección de la preparación (mínimo 5 caracteres). Queda en la bitácora.");
    const equiposUsados = equipos.filter((e) => Object.values(ev.datos).includes(e.id)).map((e) => ({ id: e.id, codigo: e.codigo, apto: e.apto, proximaCalibracion: e.proximaCalibracion }));
    const reg = await this.d.guardar(
      {
        tenantId,
        otId,
        variante: "preparacion",
        clave,
        muestraId,
        unidadId: labId,
        datos: { laboratorio: lab, valores: ev.datos, bloqueos: ev.bloqueos, probetas: ev.probetas, equipos: equiposUsados },
        estado: ev.bloqueos.length ? "bloqueada" : "registrada",
        veredicto: ev.bloqueos.length ? "no_cumple" : "cumple",
        resumen: ev.bloqueos.join(" ") || null,
      },
      { accion: corrige ? "corregir" : previo ? "guardar" : "registrar", motivo, usuarioId: usuarioDe(req) },
    );
    return { registro: reg, bloqueos: ev.bloqueos, probetas: ev.probetas, eventos: await this.d.eventos(reg.id) };
  }

  async eventosRegistro(registroId: string, req: any) {
    const tenantId = tenantDe(req);
    const r = await this.d.prisma.$queryRawUnsafe<{ ot_id: string }[]>(`SELECT ot_id FROM registro_especializado WHERE id = $1::uuid AND tenant_id = $2::uuid`, registroId, tenantId);
    if (!r[0]) throw new NotFoundException("Registro no encontrado.");
    const ot = await this.d.ot(r[0].ot_id, tenantId);
    await this.d.vista(req, ot, "resultado.ver");
    return this.d.eventos(registroId);
  }

  /* ----------------------------------------------- trabajo DSA (T26) --- */

  private labDsa(ot: OtFormulario): string {
    if (!ot.laboratorio || !(LABS_DSA as readonly string[]).includes(ot.laboratorio))
      throw new BadRequestException(`La preparación del trabajo es de los laboratorios del DSA (${LABS_DSA.join(", ")}); esta OT es de ${ot.laboratorio ?? "ningún laboratorio"}.`);
    return ot.laboratorio;
  }

  /** Personal con rol vigente en el laboratorio (para la comisión). */
  private personal(unidadId: string) {
    return this.labs.personalDeUnidad(unidadId);
  }

  /** Roles del usuario en el laboratorio y sus unidades superiores (sección, departamento). */
  private async rolesEnRama(req: any, unidadId: string): Promise<string[]> {
    const ctx = await this.alcance.paraRequest(req);
    const rama = await this.d.prisma.$queryRawUnsafe<{ id: string }[]>(
      `WITH RECURSIVE r AS (SELECT id, padre_id FROM unidad WHERE id = $1::uuid UNION ALL SELECT u.id, u.padre_id FROM unidad u JOIN r ON u.id = r.padre_id) SELECT id FROM r`,
      unidadId,
    );
    const ids = new Set(rama.map((x) => x.id));
    const ahora = new Date();
    return ctx.asignacionesVigentes
      .filter((a) => a.unidadId && ids.has(a.unidadId) && (!a.vigenteHasta || new Date(a.vigenteHasta) >= ahora))
      .map((a) => a.aliasDe ?? a.rolCodigo);
  }

  private async configTrabajo(tenantId: string) {
    return leerConfigTrabajo(await this.d.params(tenantId, "preparacion_trabajo"));
  }

  async trabajoVer(otId: string, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    await this.d.vista(req, ot, "ot.ver");
    const lab = this.labDsa(ot);
    const [reg, cfg, personal, equipos, amenazas, hcp] = await Promise.all([
      this.d.registro(otId, "trabajo", lab),
      this.configTrabajo(tenantId),
      this.personal(ot.unidadPrincipal!),
      this.d.equipos(tenantId, [ot.unidadPrincipal!]),
      this.d.param(tenantId, "lrb", "amenazas", ""),
      this.d.params(tenantId, "hcp_plantilla"),
    ]);
    const datos = reg?.datos ?? {};
    const documentacion = datos.documentacion ?? {};
    const exige = exigeAprobacion(lab, documentacion, cfg);
    const estado = (reg?.estado as EstadoTrabajo) ?? "borrador";
    const roles = req?.user?.roles?.includes("SUPERADMIN") ? ["SUPERADMIN"] : await this.rolesEnRama(req, ot.unidadPrincipal!);
    const permisos: string[] = req?.user?.permisos ?? [];
    const superadmin = (req?.user?.roles ?? []).includes("SUPERADMIN");
    const tiene = (p: string) => superadmin || permisos.includes(p);
    const posible = (a: AccionTrabajo) =>
      "estado" in transicion(a, { estado, lab, exige, rolesUsuario: roles, esSuperadmin: superadmin, documentacionCompleta: true, comentario: "xxxxx" });
    let alcanceLab = true;
    try {
      await this.d.exigirLab(req, ot, "resultado.crear", ot.unidadPrincipal, "la OT");
    } catch {
      alcanceLab = false;
    }
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, laboratorio: lab, cliente: ot.cliente },
      formulario: FORMULARIOS_TRABAJO[lab],
      registro: reg ? { id: reg.id, version: reg.version, estado: reg.estado, textoEstado: TEXTO_ESTADO_TRABAJO[estado], actualizadoPorNombre: reg.actualizadoPorNombre, updatedAt: reg.updatedAt } : null,
      estado,
      textoEstado: TEXTO_ESTADO_TRABAJO[estado],
      comision: { jefeComision: datos.jefeComision ?? null, inspectores: datos.inspectores ?? [], equipos: datos.equipos ?? [] },
      documentacion,
      exige,
      /** Si la aprobación depende de una casilla del formulario (LEM: «en terreno»), cuál; la pantalla la recalcula al marcarla. */
      exigeSi: lab === "LEM" ? "terreno" : null,
      bloqueaCaptura: cfg.bloqueaCaptura,
      pasos: pasosAprobacion(lab),
      personal,
      equipos,
      opciones: { amenazas: leerAmenazas(amenazas).map((a) => ({ valor: a.clave, etiqueta: `${a.norma} ${a.nivel} · ${a.municion} (${a.v_min}–${a.v_max} m/s)` })), hcp: hcp.filter((h) => h.activo).map((h) => ({ valor: h.codigo, etiqueta: h.etiqueta })) },
      adjuntos: reg ? await this.adjuntos(reg.id) : [],
      eventos: reg ? await this.d.eventos(reg.id) : [],
      puedo: {
        asignar: tiene("ot.asignar") && alcanceLab && !["cerrada", "anulada"].includes(ot.estado),
        preparar: (tiene("resultado.crear") || tiene("ot.asignar")) && alcanceLab && ["borrador", "devuelta", "registrada"].includes(estado) && !["cerrada", "anulada"].includes(ot.estado),
        validar: tiene("ot.preparacion.aprobar") && posible("validar"),
        aprobar: tiene("ot.preparacion.aprobar") && posible("aprobar"),
        devolver: tiene("ot.preparacion.aprobar") && posible("devolver"),
      },
    };
  }

  /** 2.1 «Asignar → preparar documentación»: Jefe de Comisión, inspectores y equipos reservados. */
  async trabajoComision(otId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const lab = this.labDsa(ot);
    await this.d.exigirLab(req, ot, "ot.asignar", ot.unidadPrincipal, "la OT");
    const personal = new Set((await this.personal(ot.unidadPrincipal!)).map((p) => p.id));
    const jefeComision = body?.jefeComision ? String(body.jefeComision) : null;
    const inspectores: string[] = Array.isArray(body?.inspectores) ? body.inspectores.map(String).slice(0, 12) : [];
    const pedidos: string[] = Array.isArray(body?.equipos) ? body.equipos.map(String).slice(0, 30) : [];
    const equipos = await this.d.equipos(tenantId, [ot.unidadPrincipal!]);
    const errores = [...erroresComision({ jefeComision, inspectores }, personal), ...erroresReserva(equipos, pedidos)];
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const reg = await this.d.registro(otId, "trabajo", lab);
    const reservados = equipos.filter((e) => pedidos.includes(e.id)).map((e) => ({ id: e.id, codigo: e.codigo, nombre: e.nombre, proximaCalibracion: e.proximaCalibracion }));
    await this.d.guardar(
      { tenantId, otId, variante: "trabajo", clave: lab, unidadId: ot.unidadPrincipal, datos: { ...(reg?.datos ?? {}), jefeComision, inspectores, equipos: reservados }, estado: reg?.estado ?? "borrador" },
      { accion: "asignar", usuarioId: usuarioDe(req) },
    );
    return this.trabajoVer(otId, req);
  }

  /** 2.2 Guardar la documentación (y «Enviar a aprobación → Jefe» con `enviar`). */
  async trabajoDocumentacion(otId: string, body: any, req: any, enviar: boolean) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const lab = this.labDsa(ot);
    const permisos: string[] = req?.user?.permisos ?? [];
    if (!(req?.user?.roles ?? []).includes("SUPERADMIN") && !permisos.includes("resultado.crear") && !permisos.includes("ot.asignar"))
      throw new ForbiddenException("Prepara la documentación el personal del laboratorio (captura o asignación).");
    await this.d.exigirLab(req, ot, permisos.includes("resultado.crear") ? "resultado.crear" : "ot.asignar", ot.unidadPrincipal, "la OT");
    const f = FORMULARIOS_TRABAJO[lab];
    const reg = await this.d.registro(otId, "trabajo", lab);
    const cfg = await this.configTrabajo(tenantId);
    const entrada = typeof body?.documentacion === "object" && body.documentacion ? body.documentacion : reg?.datos?.documentacion ?? {};
    const documentacion: Record<string, unknown> = {};
    for (const c of f.campos) if (c.campo in entrada) documentacion[c.campo] = entrada[c.campo];
    const ctx = {
      amenazas: leerAmenazas(await this.d.param(tenantId, "lrb", "amenazas", "")).map((a) => a.clave),
      plantillasHcp: (await this.d.params(tenantId, "hcp_plantilla")).filter((h) => h.activo).map((h) => h.codigo),
    };
    const errores = erroresDocumentacion(f, documentacion, ctx);
    const estado = (reg?.estado as EstadoTrabajo) ?? "borrador";
    const exige = exigeAprobacion(lab, documentacion, cfg);
    const t = transicion(enviar ? "enviar" : "guardar", { estado, lab, exige, rolesUsuario: [], documentacionCompleta: errores.length === 0 });
    if ("error" in t) throw new ConflictException(t.error);
    // Guardar un borrador admite campos vacíos, pero no valores inválidos.
    const invalidos = errores.filter((e) => !/es obligatorio/.test(e));
    if (invalidos.length) throw new BadRequestException(invalidos.join(" "));
    await this.d.guardar(
      { tenantId, otId, variante: "trabajo", clave: lab, unidadId: ot.unidadPrincipal, datos: { ...(reg?.datos ?? {}), documentacion }, estado: t.estado },
      { accion: enviar ? "enviar" : "guardar", usuarioId: usuarioDe(req) },
    );
    return this.trabajoVer(otId, req);
  }

  /** 2.3 Validar, aprobar o devolver con comentario (bitácora). */
  async trabajoDecidir(otId: string, accion: "validar" | "aprobar" | "devolver", body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    const lab = this.labDsa(ot);
    const reg = await this.d.registro(otId, "trabajo", lab);
    if (!reg) throw new NotFoundException("La OT no tiene documentación del trabajo.");
    // Alcance: el laboratorio de la OT con el permiso de aprobar (Jefe de Lab, Sección o Depto. por la cascada).
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`, "ot.preparacion.aprobar");
    const superadmin = (req?.user?.roles ?? []).includes("SUPERADMIN");
    const roles = superadmin ? ["SUPERADMIN"] : await this.rolesEnRama(req, ot.unidadPrincipal!);
    const cfg = await this.configTrabajo(tenantId);
    const comentario = typeof body?.comentario === "string" ? body.comentario.trim().slice(0, 1000) : null;
    const t = transicion(accion, {
      estado: reg.estado as EstadoTrabajo,
      lab,
      exige: exigeAprobacion(lab, reg.datos?.documentacion ?? {}, cfg),
      rolesUsuario: roles,
      esSuperadmin: superadmin,
      documentacionCompleta: true,
      comentario,
    });
    if ("error" in t) throw new ConflictException(t.error);
    await this.d.guardar(
      { tenantId, otId, variante: "trabajo", clave: lab, datos: reg.datos, estado: t.estado },
      { accion, motivo: comentario, usuarioId: usuarioDe(req) },
    );
    return this.trabajoVer(otId, req);
  }

  /* ------------------------------------------------------------- adjuntos --- */

  private adjuntos(registroId: string) {
    return this.d.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.id, a.nombre, a.mime, a.bytes, a.hash_sha256 AS hash, a.created_at AS "createdAt", u.nombre_completo AS "subidoPor"
         FROM registro_especializado_adjunto a LEFT JOIN usuario u ON u.id = a.subido_por
        WHERE a.registro_id = $1::uuid AND a.deleted_at IS NULL ORDER BY a.created_at`,
      registroId,
    );
  }

  async adjuntoSubir(otId: string, archivo: { originalname?: string; mimetype?: string; buffer?: Buffer; size?: number } | undefined, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    const lab = this.labDsa(ot);
    await this.d.exigirLab(req, ot, (req?.user?.permisos ?? []).includes("resultado.crear") ? "resultado.crear" : "ot.asignar", ot.unidadPrincipal, "la OT");
    if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte un archivo PDF, PNG o JPEG.");
    if (!MIME_ADJUNTO.has(archivo.mimetype ?? "")) throw new BadRequestException("Solo se admiten PDF, PNG o JPEG.");
    if (archivo.buffer.length > MAX_ADJUNTO_BYTES) throw new BadRequestException("El archivo no puede superar 5 MB.");
    // Firma real del archivo (no basta la extensión).
    const b = archivo.buffer;
    const firma = b.subarray(0, 4).toString("hex");
    const ok = (archivo.mimetype === "application/pdf" && firma === "25504446") || (archivo.mimetype === "image/png" && firma === "89504e47") || (archivo.mimetype === "image/jpeg" && firma.startsWith("ffd8ff"));
    if (!ok) throw new BadRequestException("El contenido del archivo no corresponde a su tipo.");
    let reg = await this.d.registro(otId, "trabajo", lab);
    if (!reg) reg = await this.d.guardar({ tenantId, otId, variante: "trabajo", clave: lab, unidadId: ot.unidadPrincipal, datos: {}, estado: "borrador" }, { accion: "crear", usuarioId: usuarioDe(req) });
    if (!["borrador", "devuelta", "registrada"].includes(reg.estado)) throw new ConflictException("La documentación está en aprobación o aprobada: no se agregan adjuntos.");
    const n = await this.d.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM registro_especializado_adjunto WHERE registro_id = $1::uuid AND deleted_at IS NULL`, reg.id);
    if ((n[0]?.n ?? 0) >= 20) throw new BadRequestException("Como máximo 20 adjuntos.");
    const nombre = (archivo.originalname ?? "adjunto").replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 200);
    await this.d.prisma.$executeRawUnsafe(
      `INSERT INTO registro_especializado_adjunto (tenant_id, registro_id, nombre, mime, bytes, datos, hash_sha256, subido_por)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid)`,
      tenantId,
      reg.id,
      nombre,
      archivo.mimetype,
      b.length,
      b.toString("base64"),
      createHash("sha256").update(b).digest("hex"),
      usuarioDe(req),
    );
    return this.trabajoVer(otId, req);
  }

  async adjuntoDescargar(id: string, req: any) {
    const tenantId = tenantDe(req);
    const f = await this.d.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.nombre, a.mime, a.datos, r.ot_id FROM registro_especializado_adjunto a JOIN registro_especializado r ON r.id = a.registro_id
        WHERE a.id = $1::uuid AND a.tenant_id = $2::uuid AND a.deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!f[0]) throw new NotFoundException("Adjunto no encontrado.");
    const ot = await this.d.ot(f[0].ot_id, tenantId);
    await this.d.vista(req, ot, "ot.ver");
    return { nombre: f[0].nombre as string, mime: f[0].mime as string, datos: Buffer.from(f[0].datos, "base64") };
  }

  async adjuntoQuitar(id: string, req: any) {
    const tenantId = tenantDe(req);
    const f = await this.d.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.id, r.ot_id, r.estado FROM registro_especializado_adjunto a JOIN registro_especializado r ON r.id = a.registro_id
        WHERE a.id = $1::uuid AND a.tenant_id = $2::uuid AND a.deleted_at IS NULL`,
      id,
      tenantId,
    );
    if (!f[0]) throw new NotFoundException("Adjunto no encontrado.");
    const ot = await this.d.ot(f[0].ot_id, tenantId);
    await this.d.exigirLab(req, ot, (req?.user?.permisos ?? []).includes("resultado.crear") ? "resultado.crear" : "ot.asignar", ot.unidadPrincipal, "la OT");
    if (!["borrador", "devuelta", "registrada"].includes(f[0].estado)) throw new ConflictException("La documentación está en aprobación o aprobada: no se quitan adjuntos.");
    await this.d.prisma.$executeRawUnsafe(`UPDATE registro_especializado_adjunto SET deleted_at = now() WHERE id = $1::uuid`, id);
    return this.trabajoVer(f[0].ot_id, req);
  }

  /* --------------------------------------------------------- bandeja --- */

  /**
   * «Pendiente de tu aprobación» (Mi bandeja y ficha de la OT): documentación
   * del trabajo en aprobación o validada que le toca decidir al usuario.
   */
  async pendientesAprobacion(req: any) {
    const tenantId = tenantDe(req);
    const permisos: string[] = req?.user?.permisos ?? [];
    const superadmin = (req?.user?.roles ?? []).includes("SUPERADMIN");
    if (!superadmin && !permisos.includes("ot.preparacion.aprobar")) return [];
    const filtro = await this.alcance.filtroUnidades(req, "ot.preparacion.aprobar");
    const filas = await this.d.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, r.ot_id AS "otId", o.codigo AS "otCodigo", r.clave AS laboratorio, r.estado, r.updated_at AS "updatedAt", o.unidad_principal AS "unidadId",
              u.nombre_completo AS "enviadoPor"
         FROM registro_especializado r JOIN orden_trabajo o ON o.id = r.ot_id
         LEFT JOIN usuario u ON u.id = r.actualizado_por
        WHERE r.tenant_id = $1::uuid AND r.variante = 'trabajo' AND r.estado IN ('en_aprobacion', 'validada')
          AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))
        ORDER BY r.updated_at LIMIT 100`,
      tenantId,
      filtro,
    );
    const out = [];
    for (const f of filas) {
      const roles = superadmin ? ["SUPERADMIN"] : await this.rolesEnRama(req, f.unidadId);
      const pasos = pasosAprobacion(f.laboratorio);
      const paso = f.estado === "validada" ? pasos[pasos.length - 1] : pasos[0];
      if (!superadmin && !roles.includes(paso.rol)) continue;
      out.push({ ...f, titulo: FORMULARIOS_TRABAJO[f.laboratorio]?.titulo ?? "Documentación del trabajo", paso: paso.texto, accion: paso.paso, ruta: `/ot/${f.otId}?tab=preparacion` });
    }
    return out;
  }
}

