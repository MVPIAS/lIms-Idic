/**
 * Formularios especializados (T10): Registro de disparos del LRB (EP-05 4.1),
 * HCP por vehículo y novedades del lote del SVM (4.6–4.8), inspección por
 * atributos AQL del IVC (EP-03 3.7). Cada uno guarda su dato primario en
 * `registro_especializado` (con bitácora) y lleva el valor y el veredicto al
 * resultado estándar. Reglas puras: lrb.ts, hcp.ts, aql.ts, variantes.ts.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { createHash } from "crypto";
import { PlantillaRenderService } from "../plantilla-render/plantilla-render.service";
import { ESTILOS_DOCUMENTO } from "../plantilla-render/plantilla-defecto";
import { fechaChile, fechaHoraChile } from "../common/fecha-chile";
import { escapeHtml } from "../plantilla-render/html.util";
import { FormulariosDatos, tenantDe, usuarioDe, type OtFormulario, type Registro } from "./formularios.datos";
import { ReglasCapturaService } from "./reglas-captura.service";
import {
  cantidadEnPalabras, erroresNuevoDisparo, evaluarLote, evaluarPanel, faltantesDocumentoLrb, leerAmenazas, leerVelocidadManda, seriesPorTalla, veredictoParaMuestra,
  type Disparo, type RegistroDisparos, type UnidadMuestreada,
} from "./lrb";
import { cabeceraDesdeRecepcion, evaluarLoteSvm, evaluarVehiculo, leerPlantilla, novedades, veredictoMetodo, type InspeccionVehiculo } from "./hcp";
import { AqlError, esNivel, evaluarInspeccion, letraCodigo, N_POR_LETRA, normalizarAql, type FilaInspeccionAql, type Nivel } from "./aql";
import { actaNovedades, tablaAql, tablaDisparos, tablaExigencia, tablaReemplazos } from "./bloques-formularios";
import { DEF_VARIANTE, type Variante } from "./variantes";

const CERRADO = "cerrado";
const motivoOk = (m: unknown) => typeof m === "string" && m.trim().length >= 5;
const exigirMotivo = (m: unknown, que: string) => {
  if (!motivoOk(m)) throw new BadRequestException(`Indique el motivo (mínimo 5 caracteres): ${que}. Queda en la bitácora.`);
  return String(m).trim();
};
const editableOt = (ot: OtFormulario) => {
  if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}: no admite cambios.`);
};

@Injectable()
export class FormulariosService implements OnModuleInit {
  constructor(
    private readonly d: FormulariosDatos,
    private readonly reglas: ReglasCapturaService,
    private readonly render: PlantillaRenderService,
  ) {}

  onModuleInit() {
    // Datos y bloques del registro de disparos para el CRB, el Informe de Rechazo y el IE del LRB.
    this.render.registrarContexto("lrb", (otId, tenantId, plantilla) => this.contextoLrb(otId, tenantId, plantilla));
    // Sección V del IVC: inspección por atributos (AQL).
    this.render.registrarContexto("aql", (otId) => this.contextoAql(otId));
    // El CRB solo si el lote cumple; el Informe de Rechazo solo si no cumple (EP-05 5.3).
    this.render.registrarValidadorEmision(async (otId, tipoDocumento) => {
      if (tipoDocumento !== "CERTIFICADO_RESISTENCIA_BALISTICA" && tipoDocumento !== "INFORME_RECHAZO") return [];
      const reg = await this.d.registro(otId, "lrb_disparos", "lote");
      const ot = await this.d.prisma.ordenTrabajo.findFirst({ where: { id: otId }, select: { tenantId: true } });
      if (!ot) return [];
      const { amenazas, manda } = await this.configLrb(ot.tenantId);
      const datos = this.datosLrb(reg);
      return faltantesDocumentoLrb(tipoDocumento, evaluarLote(datos, amenazas, manda), datos, reg?.estado === CERRADO);
    });
  }

  /* ------------------------------------------------------------- resumen --- */

  /** Variante de cada ensayo de la OT y los formularios que aplican (para la captura y la OT). */
  async resumen(otId: string, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    await this.d.vista(req, ot, "resultado.ver");
    const ensayos = await this.d.ensayosOt(otId);
    const detalle = await this.reglas.ensayos(ensayos.map((e) => e.id));
    const variantes = await this.reglas.variantes(tenantId, detalle);
    const regs = await this.d.prisma.$queryRawUnsafe<{ variante: string; estado: string; veredicto: string | null; n: number }[]>(
      `SELECT variante, estado, veredicto, count(*)::int AS n FROM registro_especializado WHERE ot_id = $1::uuid GROUP BY 1, 2, 3`,
      otId,
    );
    const formularios = Object.values(DEF_VARIANTE)
      .map((def) => {
        const propios = ensayos.filter((e) => variantes.get(e.id) === def.variante);
        if (!propios.length) return null;
        const r = regs.filter((x) => x.variante === def.variante || (def.variante === "svm_hcp" && x.variante === "svm_lote"));
        return {
          variante: def.variante,
          nombre: def.nombre,
          paso: def.paso,
          ruta: def.ruta({ otId }),
          ensayos: propios.length,
          capturados: propios.filter((e) => e.estado !== "pendiente").length,
          registros: r.reduce((s, x) => s + x.n, 0),
          cerrado: r.some((x) => x.estado === CERRADO || x.estado === "acta_emitida"),
        };
      })
      .filter(Boolean);
    return {
      otId,
      laboratorio: ot.laboratorio,
      ensayos: ensayos.map((e) => {
        const v = variantes.get(e.id) ?? "estandar";
        return { id: e.id, variante: v, formulario: v === "estandar" ? null : { nombre: DEF_VARIANTE[v].nombre, paso: DEF_VARIANTE[v].paso, ruta: DEF_VARIANTE[v].ruta({ otId, resultadoId: e.id, muestraId: e.muestraId }) } };
      }),
      formularios,
    };
  }

  /** Ensayos de la OT de una variante (con su estado), para llevarles el valor. */
  private async ensayosDe(otId: string, tenantId: string, variante: Variante) {
    const ensayos = await this.d.ensayosOt(otId);
    const detalle = await this.reglas.ensayos(ensayos.map((e) => e.id));
    const v = await this.reglas.variantes(tenantId, detalle);
    return ensayos.filter((e) => v.get(e.id) === variante);
  }

  /** ¿Puede capturar en la OT? (resultado.crear con alcance; para la pantalla). */
  private async puedeCapturar(req: any, ot: OtFormulario) {
    try {
      await this.d.vista(req, ot, "resultado.crear");
      return !["cerrada", "anulada"].includes(ot.estado);
    } catch {
      return false;
    }
  }

  /** 409 si la documentación del trabajo no está aprobada o la preparación de una muestra bloquea. */
  private async exigirEjecutable(tenantId: string, ot: OtFormulario, muestras: { id: string; codigo: string }[]) {
    const t = await this.reglas.motivoTrabajo(tenantId, ot.id, ot.laboratorio);
    if (t) throw new ConflictException(t);
    for (const m of muestras) {
      const p = await this.reglas.motivoPreparacion(tenantId, { otId: ot.id, muestraId: m.id, muestraCodigo: m.codigo, laboratorio: ot.laboratorio });
      if (p) throw new ConflictException(p);
    }
  }

  /* =================================================================== LRB === */

  private async configLrb(tenantId: string) {
    const [tabla, manda, plazo] = await Promise.all([
      this.d.param(tenantId, "lrb", "amenazas", ""),
      this.d.param(tenantId, "lrb", "velocidad_manda", "v1"),
      this.d.param(tenantId, "lrb", "plazo_apelacion", "5"),
    ]);
    return { amenazas: leerAmenazas(tabla), manda: leerVelocidadManda(manda), plazoApelacion: Number(plazo) || 5 };
  }

  private datosLrb(reg: Registro | null): RegistroDisparos & { material?: string; fechaEnsayo?: string; tipoCertificacion?: string } {
    const d = reg?.datos ?? {};
    return {
      certificacionLote: d.certificacionLote === true,
      lote: d.lote ?? {},
      composicion: Array.isArray(d.composicion) ? d.composicion : [],
      unidades: Array.isArray(d.unidades) ? d.unidades : [],
      material: d.material ?? "",
      fechaEnsayo: d.fechaEnsayo ?? "",
      tipoCertificacion: d.tipoCertificacion ?? "",
    };
  }

  async lrbVer(otId: string, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    await this.d.vista(req, ot, "resultado.ver");
    const [reg, cfg, muestras, ensayos] = await Promise.all([
      this.d.registro(otId, "lrb_disparos", "lote"),
      this.configLrb(tenantId),
      this.d.muestras(otId),
      this.ensayosDe(otId, tenantId, "lrb_disparos"),
    ]);
    const datos = this.datosLrb(reg);
    const evaluacion = evaluarLote(datos, cfg.amenazas, cfg.manda);
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, laboratorio: ot.laboratorio, cliente: ot.cliente },
      registro: reg ? { id: reg.id, estado: reg.estado, version: reg.version, actualizadoPorNombre: reg.actualizadoPorNombre, updatedAt: reg.updatedAt } : null,
      datos,
      evaluacion,
      amenazas: cfg.amenazas,
      velocidadManda: cfg.manda,
      muestras,
      ensayos,
      eventos: reg ? await this.d.eventos(reg.id) : [],
      puedeEditar: await this.puedeCapturar(req, ot),
      bloqueo: await this.reglas.motivoTrabajo(tenantId, ot.id, ot.laboratorio),
      faltantesCrb: faltantesDocumentoLrb("CERTIFICADO_RESISTENCIA_BALISTICA", evaluacion, datos, reg?.estado === CERRADO),
      faltantesRechazo: faltantesDocumentoLrb("INFORME_RECHAZO", evaluacion, datos, reg?.estado === CERRADO),
    };
  }

  /** Lote, nómina, unidades muestreadas y sus paneles (sin los disparos, que se registran uno a uno). */
  async lrbCabecera(otId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const t = await this.reglas.motivoTrabajo(tenantId, ot.id, ot.laboratorio);
    if (t) throw new ConflictException(t);
    const reg = await this.d.registro(otId, "lrb_disparos", "lote");
    if (reg?.estado === CERRADO) throw new ConflictException("El registro de disparos está concluido: reábralo con motivo para cambiarlo.");
    const { amenazas } = await this.configLrb(tenantId);
    const previo = this.datosLrb(reg);
    const muestras = new Set((await this.d.muestras(otId)).map((m) => m.id));
    const errores: string[] = [];
    const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const entero = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : NaN);
    const unidadesEntrada: any[] = Array.isArray(body?.unidades) ? body.unidades : [];
    if (unidadesEntrada.length > 60) errores.push("Como máximo 60 unidades muestreadas.");
    const series = new Set<string>();
    let pierdeDisparos = false;
    const unidades: UnidadMuestreada[] = unidadesEntrada.map((u, i) => {
      const serie = txt(u?.serie, 60);
      if (!serie) errores.push(`Unidad ${i + 1}: indique la serie.`);
      if (series.has(serie)) errores.push(`La serie ${serie} está repetida.`);
      series.add(serie);
      const muestraId = u?.muestraId ? String(u.muestraId) : null;
      if (muestraId && !muestras.has(muestraId)) errores.push(`Unidad ${serie}: la muestra no es de esta OT.`);
      const anterior = previo.unidades.find((x) => x.id === u?.id);
      const paneles = (Array.isArray(u?.paneles) ? u.paneles : []).slice(0, 8).map((p: any, j: number) => {
        const amenaza = txt(p?.amenaza, 60);
        if (!amenazas.some((a) => a.clave === amenaza)) errores.push(`Unidad ${serie}, panel ${j + 1}: elija la munición de la tabla de amenazas.`);
        const zona = txt(p?.zona, 30) || "anterior";
        const panelPrevio = anterior?.paneles.find((x) => x.id === p?.id);
        if (panelPrevio && panelPrevio.disparos.length && panelPrevio.amenaza !== amenaza) pierdeDisparos = true;
        return { id: txt(p?.id, 40) || `p${Date.now().toString(36)}${i}${j}`, zona, amenaza, disparos: panelPrevio?.disparos ?? [], cerrado: panelPrevio?.cerrado ?? false };
      });
      if (anterior) for (const p of anterior.paneles) if (p.disparos.length && !paneles.some((x: any) => x.id === p.id)) pierdeDisparos = true;
      return { id: txt(u?.id, 40) || `u${Date.now().toString(36)}${i}`, serie, talla: txt(u?.talla, 10) || null, muestraId, reemplazo: txt(u?.reemplazo, 60) || null, paneles };
    });
    for (const u of previo.unidades) if (u.paneles.some((p) => p.disparos.length) && !unidades.some((x) => x.id === u.id)) pierdeDisparos = true;
    const motivo = pierdeDisparos ? exigirMotivo(body?.motivo, "se quitan paneles con disparos registrados o se cambia su munición") : null;
    const composicion = (Array.isArray(body?.composicion) ? body.composicion : []).slice(0, 20).map((c: any) => {
      const cantidad = entero(c?.cantidad);
      if (!txt(c?.talla, 10) || cantidad === null || Number.isNaN(cantidad)) errores.push("Nómina del lote: cada fila lleva talla y cantidad (entero).");
      return { talla: txt(c?.talla, 10), cantidad: Number(cantidad) || 0, series: txt(c?.series, 200) || null };
    });
    const tamano = entero(body?.lote?.tamano);
    const garantia = entero(body?.lote?.garantiaAnios);
    if (Number.isNaN(tamano) || Number.isNaN(garantia)) errores.push("El tamaño del lote y la garantía son números enteros.");
    const fab = txt(body?.lote?.fabricacion, 10);
    const fechaEnsayo = txt(body?.fechaEnsayo, 10);
    if ((fab && !/^\d{4}-\d{2}-\d{2}$/.test(fab)) || (fechaEnsayo && !/^\d{4}-\d{2}-\d{2}$/.test(fechaEnsayo))) errores.push("Fechas en formato AAAA-MM-DD.");
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const datos = {
      certificacionLote: body?.certificacionLote === true,
      material: txt(body?.material, 200),
      tipoCertificacion: txt(body?.tipoCertificacion, 120),
      fechaEnsayo,
      lote: { tamano, modelo: txt(body?.lote?.modelo, 120) || null, reposicion: entero(body?.lote?.reposicion), fabricacion: fab || null, garantiaAnios: garantia },
      composicion,
      unidades,
    };
    const { manda } = await this.configLrb(tenantId);
    const ev = evaluarLote(datos, amenazas, manda);
    await this.d.guardar(
      { tenantId, otId, variante: "lrb_disparos", clave: "lote", datos, estado: "borrador", veredicto: ev.veredicto, resumen: ev.falla, unidadId: ot.unidadPrincipal },
      { accion: reg ? "cabecera" : "crear", motivo, usuarioId: usuarioDe(req) },
    );
    return this.lrbVer(otId, req);
  }

  /** «Guardar disparo → siguiente disparo». Corregir un disparo ya registrado exige motivo. */
  async lrbDisparo(otId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const reg = await this.d.registro(otId, "lrb_disparos", "lote");
    if (!reg) throw new BadRequestException("Registre primero el lote y las unidades muestreadas.");
    if (reg.estado === CERRADO) throw new ConflictException("El registro de disparos está concluido: reábralo con motivo para corregir un disparo.");
    const datos = this.datosLrb(reg);
    const u = datos.unidades.find((x) => x.id === body?.unidadId);
    const p = u?.paneles.find((x) => x.id === body?.panelId);
    if (!u || !p) throw new NotFoundException("Unidad o panel no encontrado en el registro de disparos.");
    const muestrasOt = await this.d.muestras(otId);
    await this.exigirEjecutable(tenantId, ot, u.muestraId ? muestrasOt.filter((m) => m.id === u.muestraId) : muestrasOt);
    const { amenazas, manda } = await this.configLrb(tenantId);
    const e = body?.disparo ?? {};
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(String(v).replace(",", ".")));
    const disparo: Disparo = {
      n: Number(e.n),
      zonaImpacto: typeof e.zonaImpacto === "string" ? e.zonaImpacto.trim().slice(0, 40) || null : null,
      v1: num(e.v1),
      v2: num(e.v2),
      trauma: num(e.trauma),
      laminasPerforadas: num(e.laminasPerforadas),
      laminasTotal: num(e.laminasTotal),
      penetracion: e.penetracion === true ? true : e.penetracion === false ? false : null,
      danoTestigo: e.danoTestigo === true ? true : e.danoTestigo === false ? false : null,
      observacion: typeof e.observacion === "string" ? e.observacion.trim().slice(0, 300) || null : null,
    };
    for (const k of ["v1", "v2", "trauma", "laminasPerforadas", "laminasTotal"] as const)
      if (disparo[k] != null && !Number.isFinite(disparo[k] as number)) throw new BadRequestException(`El valor de ${k} no es un número.`);
    const errores = erroresNuevoDisparo(p, disparo, amenazas, manda);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const corrige = p.disparos.some((x) => x.n === disparo.n);
    const motivo = corrige ? exigirMotivo(body?.motivo, `corrección del disparo ${disparo.n} del panel ${p.zona} de ${u.serie}`) : null;
    p.disparos = [...p.disparos.filter((x) => x.n !== disparo.n), disparo].sort((a, b) => a.n - b.n);
    const panel = evaluarPanel(p, amenazas, manda);
    const ev = evaluarLote(datos, amenazas, manda);
    await this.d.guardar(
      { tenantId, otId, variante: "lrb_disparos", clave: "lote", datos: { ...reg.datos, unidades: datos.unidades }, estado: "borrador", veredicto: ev.veredicto, resumen: ev.falla },
      { accion: corrige ? "corregir_disparo" : "disparo", motivo, usuarioId: usuarioDe(req) },
    );
    return { panel, lote: { veredicto: ev.veredicto, falla: ev.falla, penetracion: ev.penetracion }, vista: await this.lrbVer(otId, req) };
  }

  /** «Cerrar panel → siguiente panel»: el panel está completo (todos sus disparos) o detenido. */
  async lrbCerrarPanel(otId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const reg = await this.d.registro(otId, "lrb_disparos", "lote");
    if (!reg || reg.estado === CERRADO) throw new ConflictException("No hay un registro de disparos abierto.");
    const datos = this.datosLrb(reg);
    const p = datos.unidades.find((x) => x.id === body?.unidadId)?.paneles.find((x) => x.id === body?.panelId);
    if (!p) throw new NotFoundException("Panel no encontrado.");
    const { amenazas, manda } = await this.configLrb(tenantId);
    const e = evaluarPanel(p, amenazas, manda);
    if (!e.completo) throw new BadRequestException(`El panel aún no está completo: lleva ${p.disparos.length} de ${e.amenazaFila?.disparos ?? "?"} disparos y ninguno detuvo el panel.`);
    p.cerrado = true;
    await this.d.guardar(
      { tenantId, otId, variante: "lrb_disparos", clave: "lote", datos: { ...reg.datos, unidades: datos.unidades }, estado: "borrador", veredicto: reg.veredicto, resumen: reg.resumen },
      { accion: "cerrar_panel", usuarioId: usuarioDe(req) },
    );
    return this.lrbVer(otId, req);
  }

  /** «Concluir lote → documento»: todos los paneles completos; lleva el veredicto a los ensayos. */
  async lrbConcluir(otId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const reg = await this.d.registro(otId, "lrb_disparos", "lote");
    if (!reg) throw new BadRequestException("No hay registro de disparos.");
    if (reg.estado === CERRADO) throw new ConflictException("El registro ya está concluido.");
    const datos = this.datosLrb(reg);
    const { amenazas, manda } = await this.configLrb(tenantId);
    const ev = evaluarLote(datos, amenazas, manda);
    const incompletos = ev.unidades.flatMap((u) => u.paneles.filter((p) => !p.completo).map((p) => `${u.serie} · ${p.zona}`));
    if (!ev.unidades.length || !ev.unidades.some((u) => u.paneles.length)) throw new BadRequestException("Registre al menos una unidad con su panel y sus disparos.");
    if (incompletos.length) throw new BadRequestException(`Hay paneles sin completar: ${incompletos.join(", ")}.`);
    const motivo = typeof reg.datos?.motivoReapertura === "string" ? reg.datos.motivoReapertura : null;
    await this.d.guardar(
      { tenantId, otId, variante: "lrb_disparos", clave: "lote", datos: { ...reg.datos, motivoReapertura: null }, estado: CERRADO, veredicto: ev.veredicto, resumen: ev.falla },
      { accion: "concluir", motivo: body?.motivo ?? null, usuarioId: usuarioDe(req) },
    );
    const ensayos = await this.ensayosDe(otId, tenantId, "lrb_disparos");
    const llevados = [];
    for (const e of ensayos) {
      const v = veredictoParaMuestra(ev, e.muestraId);
      llevados.push(
        await this.d.llevar(req, tenantId, e, "lrb_disparos", { valorTexto: v.veredicto === "cumple" ? "Cumple" : "No cumple", veredicto: v.veredicto, observacion: v.resumen }, motivo ?? (e.valorTexto ? "Registro de disparos concluido de nuevo" : null)),
      );
    }
    return { ...(await this.lrbVer(otId, req)), llevados };
  }

  async lrbReabrir(otId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const reg = await this.d.registro(otId, "lrb_disparos", "lote");
    if (!reg || reg.estado !== CERRADO) throw new ConflictException("El registro de disparos no está concluido.");
    const motivo = exigirMotivo(body?.motivo, "reabrir el registro de disparos");
    await this.d.guardar(
      { tenantId, otId, variante: "lrb_disparos", clave: "lote", datos: { ...reg.datos, motivoReapertura: motivo }, estado: "borrador", veredicto: reg.veredicto, resumen: reg.resumen },
      { accion: "reabrir", motivo, usuarioId: usuarioDe(req) },
    );
    return this.lrbVer(otId, req);
  }

  /** Contexto de las plantillas LRB-CRB y LRB-RECH (y bloques para cualquier informe de una OT con disparos). */
  private async contextoLrb(otId: string, tenantId: string | undefined, plantilla: { id: string; repid: string }) {
    const propia = plantilla.repid === "LRB-CRB" || plantilla.repid === "LRB-RECH";
    const reg = await this.d.registro(otId, "lrb_disparos", "lote");
    if (!propia && !reg) return null;
    const otRow = await this.d.prisma.ordenTrabajo.findFirst({ where: { id: otId }, select: { tenantId: true } });
    const t = tenantId ?? otRow?.tenantId;
    if (!t) return null;
    const ot = await this.d.ot(otId, t);
    if (propia && ot.laboratorio !== "LRB") throw new BadRequestException(`La plantilla ${plantilla.repid} es del Laboratorio de Resistencia Balística: no se usa en una OT de ${ot.laboratorio ?? "otro laboratorio"}.`);
    const cfg = await this.configLrb(t);
    const datos = this.datosLrb(reg);
    const ev = evaluarLote(datos, cfg.amenazas, cfg.manda);
    const usadas = cfg.amenazas.filter((a) => datos.unidades.some((u) => u.paneles.some((p) => p.amenaza === a.clave)));
    const series = seriesPorTalla(datos.composicion);
    const tamano = datos.lote?.tamano ?? series.total;
    const normas = [...new Set(usadas.map((a) => `${a.norma} nivel ${a.nivel}`))].join(" · ");
    return {
      datos: {
        material: datos.material || "",
        modelo: datos.lote?.modelo ?? "",
        cantidadPalabras: tamano ? cantidadEnPalabras(tamano) : "",
        normas,
        solicitante: ot.atencion ?? "",
        fechaOt: ot.fechaOt ? fechaChile(ot.fechaOt) : "",
        fechaEnsayo: datos.fechaEnsayo ? fechaChile(datos.fechaEnsayo) : "",
        fabricacion: datos.lote?.fabricacion ? fechaChile(datos.lote.fabricacion) : "—",
        garantia: datos.lote?.garantiaAnios != null ? `${datos.lote.garantiaAnios} años` : "—",
        seriesPorTalla: series.texto,
        tipoCertificacion: datos.tipoCertificacion || (datos.certificacionLote ? "Certificación de lote" : "Ensayo"),
        conclusion: `El lote de ${datos.material || "elementos"} ensayado según ${normas || "la norma indicada"} no presentó penetración completa y el trauma se mantuvo dentro del máximo.`,
        regla: "Criterio: sin penetración completa (proyectil, fragmento o componente) y trauma dentro del máximo de la norma. Una penetración completa rechaza el lote.",
        falla: ev.falla ?? "",
        plazoApelacion: `${cfg.plazoApelacion} días hábiles`,
        veredicto: ev.veredicto,
      },
      bloques: { tabla_disparos: tablaDisparos(ev), tabla_exigencia: tablaExigencia(usadas), tabla_reemplazos: tablaReemplazos(datos) },
    };
  }

  /* =================================================================== HCP === */

  private async configSvm(tenantId: string) {
    const [nivel, a, b, c] = await Promise.all([
      this.d.param(tenantId, "inspeccion_aql", "nivel", "II"),
      this.d.param(tenantId, "inspeccion_aql", "aql_clase_a", "0"),
      this.d.param(tenantId, "inspeccion_aql", "aql_clase_b", "2,5"),
      this.d.param(tenantId, "inspeccion_aql", "aql_clase_c", "6,5"),
    ]);
    return { nivel: (esNivel(nivel) ? nivel : "II") as Nivel, aqlA: a, aqlB: b, aqlC: c };
  }

  private async plantillasHcp(tenantId: string) {
    const filas = await this.d.params(tenantId, "hcp_plantilla");
    return filas.filter((f) => f.activo).map((f) => ({ codigo: f.codigo, nombre: f.etiqueta, items: leerPlantilla(f.valor) }));
  }

  async hcpVer(otId: string, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    await this.d.vista(req, ot, "resultado.ver");
    const [lote, regs, plantillas, cfg, muestras, ensayos] = await Promise.all([
      this.d.registro(otId, "svm_lote", "lote"),
      this.d.registros(otId, "svm_hcp"),
      this.plantillasHcp(tenantId),
      this.configSvm(tenantId),
      this.d.muestras(otId),
      this.ensayosDe(otId, tenantId, "svm_hcp"),
    ]);
    const codigo = lote?.datos?.plantilla ?? null;
    const plantilla = plantillas.find((p) => p.codigo === codigo) ?? null;
    const items = plantilla?.items ?? [];
    // D05-21: lo registrado en la recepción de cada vehículo (chasis, motor, año, km) se propone en su cabecera.
    const recep = new Map(
      (
        await this.d.prisma.$queryRawUnsafe<{ id: string; datos: Record<string, unknown> | null }[]>(
          `SELECT id, datos_recepcion AS datos FROM muestra WHERE ot_id = $1::uuid AND deleted_at IS NULL`,
          otId,
        )
      ).map((x: { id: string; datos: Record<string, unknown> | null }) => [x.id, cabeceraDesdeRecepcion(x.datos)]),
    );
    const vehiculos = muestras.map((m) => {
      const r = regs.find((x) => x.muestraId === m.id) ?? null;
      const insp: InspeccionVehiculo | null = r ? { numero: r.datos?.numero ?? 0, cabecera: r.datos?.cabecera ?? { inspectores: [], chasis: "", motor: "" }, items: r.datos?.items ?? {} } : null;
      const ev = insp ? evaluarVehiculo(items, insp) : null;
      return {
        muestra: m,
        recepcion: recep.get(m.id) ?? null,
        registro: r ? { id: r.id, estado: r.estado, version: r.version, actualizadoPorNombre: r.actualizadoPorNombre, updatedAt: r.updatedAt } : null,
        inspeccion: insp,
        evaluacion: ev ? { ...ev, items: undefined } : null,
        estado: ev?.estado ?? "pendiente",
        ensayos: ensayos.filter((e) => e.muestraId === m.id),
      };
    });
    const tamano = Number(lote?.datos?.tamanoLote) || 0;
    const n = Number(lote?.datos?.muestra) || 0;
    const evaluados = vehiculos.filter((v) => v.inspeccion).map((v) => ({ evaluado: evaluarVehiculo(items, v.inspeccion!), chasis: v.inspeccion!.cabecera?.chasis || null }));
    const evLote = tamano && n ? evaluarLoteSvm(tamano, n, evaluados.map((x) => x.evaluado), cfg) : null;
    let nSugerido: number | null = null;
    try {
      nSugerido = tamano >= 2 ? Math.min(tamano, N_POR_LETRA[letraCodigo(tamano, cfg.nivel)]) : null;
    } catch {
      nSugerido = null;
    }
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, laboratorio: ot.laboratorio, cliente: ot.cliente },
      lote: lote ? { id: lote.id, estado: lote.estado, datos: { ...lote.datos, acta: lote.datos?.acta ? { fecha: lote.datos.acta.fecha, hash: lote.datos.acta.hash, por: lote.datos.acta.por } : null } } : null,
      plantillas: plantillas.map((p) => ({ codigo: p.codigo, nombre: p.nombre, items: p.items.length })),
      plantilla: plantilla ? { codigo: plantilla.codigo, nombre: plantilla.nombre, items } : null,
      config: cfg,
      nSugerido,
      vehiculos,
      evaluacionLote: evLote,
      novedades: novedades(evaluados, lote?.datos?.acciones ?? {}),
      eventos: lote ? await this.d.eventos(lote.id) : [],
      puedeEditar: await this.puedeCapturar(req, ot),
      bloqueo: await this.reglas.motivoTrabajo(tenantId, ot.id, ot.laboratorio),
    };
  }

  /** Datos del lote: plantilla de HCP, tamaño del lote y vehículos a inspeccionar (n). */
  async hcpLote(otId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const t = await this.reglas.motivoTrabajo(tenantId, ot.id, ot.laboratorio);
    if (t) throw new ConflictException(t);
    const plantillas = await this.plantillasHcp(tenantId);
    const plantilla = String(body?.plantilla ?? "");
    const tamano = Number(body?.tamanoLote);
    const n = Number(body?.muestra);
    const errores: string[] = [];
    if (!plantillas.some((p) => p.codigo === plantilla)) errores.push("Elija la HCP del tipo de vehículo (Parámetros › HCP).");
    if (!Number.isInteger(tamano) || tamano < 1 || tamano > 100000) errores.push("Indique el tamaño del lote (entero).");
    if (!Number.isInteger(n) || n < 1 || n > tamano) errores.push("Los vehículos a inspeccionar (n) van de 1 al tamaño del lote.");
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const previo = await this.d.registro(otId, "svm_lote", "lote");
    if (previo?.datos?.plantilla && previo.datos.plantilla !== plantilla && (await this.d.registros(otId, "svm_hcp")).length)
      throw new ConflictException("Ya hay vehículos inspeccionados con otra HCP: no se cambia la plantilla del lote.");
    if (previo?.estado === "acta_emitida") throw new ConflictException("El acta de novedades ya se emitió.");
    await this.d.guardar(
      { tenantId, otId, variante: "svm_lote", clave: "lote", datos: { ...(previo?.datos ?? {}), plantilla, tamanoLote: tamano, muestra: n }, estado: "borrador", unidadId: ot.unidadPrincipal },
      { accion: previo ? "lote" : "crear", usuarioId: usuarioDe(req) },
    );
    return this.hcpVer(otId, req);
  }

  /** «Guardar vehículo → siguiente vehículo». Corregir un vehículo ya inspeccionado exige motivo (bitácora). */
  async hcpVehiculo(otId: string, muestraId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const muestra = (await this.d.muestras(otId)).find((m) => m.id === muestraId);
    if (!muestra) throw new NotFoundException("El vehículo (muestra) no es de esta OT.");
    await this.exigirEjecutable(tenantId, ot, [muestra]);
    const lote = await this.d.registro(otId, "svm_lote", "lote");
    const plantilla = (await this.plantillasHcp(tenantId)).find((p) => p.codigo === lote?.datos?.plantilla);
    if (!plantilla) throw new BadRequestException("Elija primero la HCP del lote.");
    if (lote?.estado === "acta_emitida") throw new ConflictException("El acta de novedades ya se emitió: no se cambian las inspecciones.");
    const c = body?.cabecera ?? {};
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(String(v).replace(",", ".")));
    const fecha = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const items: InspeccionVehiculo["items"] = {};
    for (const [k, v] of Object.entries(body?.items ?? {})) {
      const r = v as any;
      if (!plantilla.items.some((i) => i.item === k)) continue;
      const valor = num(r?.valor);
      items[k] = {
        resultado: r?.resultado === "C" || r?.resultado === "NC" ? r.resultado : null,
        valor: valor != null && Number.isFinite(valor) ? valor : null,
        observacion: typeof r?.observacion === "string" ? r.observacion.trim().slice(0, 500) || null : null,
      };
    }
    const insp: InspeccionVehiculo = {
      numero: Number(body?.numero) || 0,
      cabecera: {
        inspectores: (Array.isArray(c.inspectores) ? c.inspectores : []).map((x: unknown) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 6),
        chasis: String(c.chasis ?? "").trim().slice(0, 60),
        motor: String(c.motor ?? "").trim().slice(0, 60),
        anio: num(c.anio),
        lugar: String(c.lugar ?? "").trim().slice(0, 120) || null,
        kmSalida: num(c.kmSalida),
        kmLlegada: num(c.kmLlegada),
        fechaInicio: fecha(c.fechaInicio),
        fechaTermino: fecha(c.fechaTermino),
      },
      items,
    };
    if (!Number.isInteger(insp.numero) || insp.numero < 1) throw new BadRequestException("Indique el Nº del vehículo en la muestra.");
    const n = Number(lote?.datos?.muestra) || 0;
    if (n && insp.numero > n) throw new BadRequestException(`La muestra es de ${n} vehículos.`);
    const otros = (await this.d.registros(otId, "svm_hcp")).filter((r) => r.muestraId !== muestraId);
    if (otros.some((r) => Number(r.datos?.numero) === insp.numero)) throw new BadRequestException(`El vehículo Nº ${insp.numero} ya está registrado en otra muestra.`);
    if (insp.cabecera.chasis && otros.some((r) => r.datos?.cabecera?.chasis === insp.cabecera.chasis)) throw new BadRequestException(`El chasis ${insp.cabecera.chasis} ya está en otro vehículo de la OT.`);
    const ev = evaluarVehiculo(plantilla.items, insp);
    const ncSinObs = ev.errores.filter((x) => /observación/.test(x));
    if (ncSinObs.length) throw new BadRequestException(ncSinObs.join(" "));
    const previo = await this.d.registro(otId, "svm_hcp", muestraId);
    const corrige = previo?.estado === "inspeccionado" && JSON.stringify(previo.datos?.items ?? {}) !== JSON.stringify(insp.items);
    const motivo = corrige ? exigirMotivo(body?.motivo, `corrección de la HCP del vehículo Nº ${insp.numero} ya inspeccionado`) : null;
    await this.d.guardar(
      { tenantId, otId, variante: "svm_hcp", clave: muestraId, muestraId, datos: { ...insp, plantilla: plantilla.codigo }, estado: ev.estado, veredicto: ev.veredicto, resumen: `${ev.respondidos}/${ev.total} ítems · ${ev.noConformes.length} N/C` },
      { accion: corrige ? "corregir" : previo ? "guardar" : "crear", motivo, usuarioId: usuarioDe(req) },
    );
    const llevados = [];
    if (ev.estado === "inspeccionado") {
      for (const e of (await this.ensayosDe(otId, tenantId, "svm_hcp")).filter((x) => x.muestraId === muestraId)) {
        const v = e.metodoCodigo ? veredictoMetodo(ev, e.metodoCodigo) : null;
        if (!v) continue;
        llevados.push(
          await this.d.llevar(req, tenantId, e, "svm_hcp", { valorTexto: v.veredicto === "cumple" ? "Conforme" : "No conforme", veredicto: v.veredicto, observacion: v.observacion }, motivo ?? (e.valorTexto ? "HCP del vehículo actualizada" : null)),
        );
      }
    }
    return { evaluacion: { ...ev, items: undefined }, llevados, vista: await this.hcpVer(otId, req) };
  }

  /** Acción del proveedor de cada novedad (texto libre por vehículo e ítem). */
  async hcpAcciones(otId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const lote = await this.d.registro(otId, "svm_lote", "lote");
    if (!lote) throw new BadRequestException("Registre primero los datos del lote.");
    if (lote.estado === "acta_emitida") throw new ConflictException("El acta ya se emitió.");
    const acciones: Record<string, string> = {};
    for (const [k, v] of Object.entries(body?.acciones ?? {})) if (/^\d+:[\w.]+$/.test(k) && typeof v === "string" && v.trim()) acciones[k] = v.trim().slice(0, 300);
    await this.d.guardar({ tenantId, otId, variante: "svm_lote", clave: "lote", datos: { ...lote.datos, acciones }, estado: lote.estado }, { accion: "acciones", usuarioId: usuarioDe(req) });
    return this.hcpVer(otId, req);
  }

  /** «Emitir acta de novedades → evaluación del lote» (EP-05 4.8): con los n vehículos inspeccionados. */
  async hcpActa(otId: string, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const v = await this.hcpVer(otId, req);
    if (!v.lote || !v.plantilla || !v.evaluacionLote) throw new BadRequestException("Complete los datos del lote y la HCP.");
    if (v.lote.estado === "acta_emitida") throw new ConflictException("El acta ya se emitió.");
    const ev = v.evaluacionLote;
    if (ev.errores.length) throw new BadRequestException(ev.errores.join(" "));
    if (ev.inspeccionados < ev.muestra) throw new BadRequestException(`Faltan vehículos por inspeccionar: ${ev.inspeccionados} de ${ev.muestra}.`);
    const lote = (await this.d.registro(otId, "svm_lote", "lote"))!;
    const usuario = await this.d.prisma.usuario.findFirst({ where: { id: usuarioDe(req) ?? undefined }, select: { nombreCompleto: true } });
    const fecha = fechaHoraChile(new Date());
    const html = actaNovedades({ ot: ot.codigo, cliente: ot.cliente, plantilla: v.plantilla.nombre, fecha, lote: ev, novedades: v.novedades, emitidaPor: usuario?.nombreCompleto ?? null });
    const hash = createHash("sha256").update(html, "utf8").digest("hex");
    await this.d.guardar(
      { tenantId, otId, variante: "svm_lote", clave: "lote", datos: { ...lote.datos, acta: { fecha, html, hash, por: usuario?.nombreCompleto ?? null } }, estado: "acta_emitida", veredicto: ev.veredicto, resumen: ev.regla },
      { accion: "emitir_acta", usuarioId: usuarioDe(req) },
    );
    return this.hcpVer(otId, req);
  }

  /** Acta emitida, como documento imprimible (HTML con los estilos de los documentos). */
  async hcpActaHtml(otId: string, req: any): Promise<string> {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    await this.d.vista(req, ot, "resultado.ver");
    const lote = await this.d.registro(otId, "svm_lote", "lote");
    if (!lote?.datos?.acta?.html) throw new NotFoundException("El acta de novedades aún no se ha emitido.");
    return (
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta de novedades · ${escapeHtml(ot.codigo)}</title><style>${ESTILOS_DOCUMENTO}</style></head>` +
      `<body><div class="hoja">${lote.datos.acta.html}<p class="nota">Emitida el ${escapeHtml(lote.datos.acta.fecha)}${lote.datos.acta.por ? ` por ${escapeHtml(lote.datos.acta.por)}` : ""} · SHA-256 ${escapeHtml(lote.datos.acta.hash)}</p></div></body></html>`
    );
  }

  /* =================================================================== AQL === */

  private async configAql(tenantId: string) {
    const [nivel, aql] = await Promise.all([this.d.param(tenantId, "inspeccion_aql", "nivel", "II"), this.d.param(tenantId, "inspeccion_aql", "aql_inspeccion", "2,5")]);
    return { nivel: (esNivel(nivel) ? nivel : "II") as Nivel, aql: normalizarAql(aql) ?? "2,5" };
  }

  async aqlVer(otId: string, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    await this.d.vista(req, ot, "resultado.ver");
    const [reg, cfg, ensayos] = await Promise.all([this.d.registro(otId, "aql", "lote"), this.configAql(tenantId), this.ensayosDe(otId, tenantId, "aql")]);
    const guardadas: FilaInspeccionAql[] = Array.isArray(reg?.datos?.filas) ? reg!.datos.filas : [];
    // Una fila por ensayo de inspección por atributos que aún no la tenga (con el AQL y nivel por defecto).
    const filas: FilaInspeccionAql[] = [
      ...guardadas,
      ...ensayos
        .filter((e) => !guardadas.some((f) => f.resultadoId === e.id))
        .map((e) => ({ inspeccion: `${e.ensayo}${ensayos.filter((x) => x.ensayo === e.ensayo).length > 1 ? ` · ${e.muestraCodigo}` : ""}`, aql: cfg.aql, nivel: cfg.nivel, defectuosos: null, resultadoId: e.id })),
    ];
    const tamano = Number(reg?.datos?.tamanoLote) || 0;
    const ev = tamano ? evaluarInspeccion(tamano, filas) : null;
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado, laboratorio: ot.laboratorio, cliente: ot.cliente },
      registro: reg ? { id: reg.id, estado: reg.estado, version: reg.version, actualizadoPorNombre: reg.actualizadoPorNombre, updatedAt: reg.updatedAt } : null,
      tamanoLote: tamano || null,
      filas,
      evaluacion: ev,
      config: cfg,
      ensayos,
      eventos: reg ? await this.d.eventos(reg.id) : [],
      puedeEditar: await this.puedeCapturar(req, ot),
    };
  }

  /** «Evaluar AQL → informe»: evalúa cada inspección y lleva el cumplimiento a su ensayo. */
  async aqlGuardar(otId: string, body: any, req: any) {
    const tenantId = tenantDe(req);
    const ot = await this.d.ot(otId, tenantId);
    editableOt(ot);
    await this.d.vista(req, ot, "resultado.crear");
    const ensayos = await this.ensayosDe(otId, tenantId, "aql");
    const tamano = Number(body?.tamanoLote);
    const entrada: any[] = Array.isArray(body?.filas) ? body.filas.slice(0, 40) : [];
    const ent = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const filas: FilaInspeccionAql[] = entrada.map((f) => ({
      inspeccion: String(f?.inspeccion ?? "").trim().slice(0, 160),
      aql: normalizarAql(f?.aql) ?? String(f?.aql ?? ""),
      nivel: f?.nivel,
      defectuosos: ent(f?.defectuosos),
      acManual: ent(f?.acManual),
      reManual: ent(f?.reManual),
      motivoManual: typeof f?.motivoManual === "string" ? f.motivoManual.trim().slice(0, 300) : null,
      resultadoId: f?.resultadoId && ensayos.some((e) => e.id === f.resultadoId) ? String(f.resultadoId) : null,
    }));
    let ev;
    try {
      ev = evaluarInspeccion(tamano, filas);
    } catch (e) {
      if (e instanceof AqlError) throw new BadRequestException(e.message);
      throw e;
    }
    if (ev.errores.length) throw new BadRequestException(ev.errores.join(" "));
    const reg = await this.d.registro(otId, "aql", "lote");
    const cambia = reg && JSON.stringify({ t: reg.datos?.tamanoLote, f: reg.datos?.filas }) !== JSON.stringify({ t: tamano, f: filas });
    const motivo = reg?.estado === "evaluado" && cambia ? exigirMotivo(body?.motivo, "corrección de una inspección por atributos ya evaluada") : null;
    await this.d.guardar(
      { tenantId, otId, variante: "aql", clave: "lote", datos: { tamanoLote: tamano, filas }, estado: ev.cumple === null ? "borrador" : "evaluado", veredicto: ev.cumple === null ? "pendiente" : ev.cumple ? "cumple" : "no_cumple", unidadId: ot.unidadPrincipal },
      { accion: reg ? (motivo ? "corregir" : "evaluar") : "crear", motivo, usuarioId: usuarioDe(req) },
    );
    const llevados = [];
    for (const f of ev.filas) {
      const e = f.resultadoId ? ensayos.find((x) => x.id === f.resultadoId) : null;
      if (!e || f.decision === null) continue;
      const obs = `${f.plan.texto}${f.acManual != null ? ` (Ac/Re fijados: ${f.motivoManual})` : ""} · ${f.defectuosos} defectuoso(s) → ${f.decision === "acepta" ? "acepta" : "rechaza"}`;
      llevados.push(await this.d.llevar(req, tenantId, e, "aql", { valorTexto: f.decision === "acepta" ? "Acepta" : "Rechaza", veredicto: f.cumplimiento, observacion: obs }, motivo ?? (e.valorTexto ? "Inspección por atributos evaluada de nuevo" : null)));
    }
    return { ...(await this.aqlVer(otId, req)), llevados };
  }

  /** Sección V del IVC: datos {{aql.hay}} y bloque {{tabla_aql}}. */
  private async contextoAql(otId: string) {
    const reg = await this.d.registro(otId, "aql", "lote");
    const filas: FilaInspeccionAql[] = Array.isArray(reg?.datos?.filas) ? reg!.datos.filas : [];
    const tamano = Number(reg?.datos?.tamanoLote) || 0;
    if (!reg || !filas.length || !tamano) return { datos: { hay: false }, bloques: { tabla_aql: "" } };
    const ev = evaluarInspeccion(tamano, filas);
    if (ev.errores.length) return { datos: { hay: false }, bloques: { tabla_aql: "" } };
    return { datos: { hay: true, lote: tamano.toLocaleString("es-CL") }, bloques: { tabla_aql: tablaAql(tamano, ev.filas) } };
  }

  /** Para la bandeja del jefe o el acceso desde otras pantallas. */
  exigirPermiso(req: any, permiso: string) {
    if ((req?.user?.roles ?? []).includes("SUPERADMIN")) return;
    if (!(req?.user?.permisos ?? []).includes(permiso)) throw new ForbiddenException(`Permiso insuficiente: ${permiso}`);
  }
}
