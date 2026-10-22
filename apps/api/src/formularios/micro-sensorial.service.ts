/**
 * Variantes de Alimentos (R3, inactivas por defecto hasta EP-02 P1):
 * microbiología con siembra, incubación y lecturas programadas y plan n, c, m,
 * M (EP-02 3.3–3.5) y panel sensorial con cartillas y estadístico (3.6–3.8).
 * Reglas puras: micro.ts y sensorial.ts. Un registro por ensayo.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { FormulariosDatos, tenantDe, usuarioDe } from "./formularios.datos";
import { ReglasCapturaService } from "./reglas-captura.service";
import { calcularMicro, evaluarPlan, leerHoras, leerPlanes, lecturasProgramadas, planDe, veredictoSimple, type Lectura, type RegistroMicro, type TipoMicro } from "./micro";
import { codigosAleatorios, erroresCartillas, estadisticaEscala, leerRangos, ordenPorJuez, triangular, veredictoRango, type Cartilla, type PruebaSensorial } from "./sensorial";

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(String(v).replace(",", ".")));
const txt = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);
const fechaHora = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) ? v : null);

@Injectable()
export class MicroSensorialService {
  constructor(
    private readonly d: FormulariosDatos,
    private readonly reglas: ReglasCapturaService,
  ) {}

  /** Ensayo, su OT y su variante; 404 si no existe; alcance según el permiso. */
  private async ensayo(resultadoId: string, req: any, permiso: string, variante: "lmb_micro" | "les_panel") {
    const tenantId = tenantDe(req);
    const [e] = await this.reglas.ensayos([resultadoId]);
    if (!e?.otId) throw new NotFoundException(`Resultado ${resultadoId} no encontrado`);
    const ot = await this.d.ot(e.otId, tenantId);
    if (permiso === "resultado.ver") await this.d.vista(req, ot, permiso);
    else await this.d.exigirLab(req, ot, permiso, e.laboratorioId, "el ensayo");
    const v = (await this.reglas.variantes(tenantId, [e])).get(e.id);
    if (v !== variante) throw new ConflictException("Este ensayo no se captura en este formulario (revise la activación en Parámetros de la operación).");
    const r = (await this.d.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.estado, r.valor_texto AS "valorTexto", r.limite_sup AS "limiteSup", r.requisito, COALESCE(ca.nombre, cm.nombre) AS ensayo, cm.nombre AS metodo,
              m.codigo AS "muestraCodigo", m.nombre AS "muestraNombre", ce.nombre AS producto
         FROM resultado r JOIN muestra m ON m.id = r.muestra_id
         LEFT JOIN cat_analito ca ON ca.id = r.cat_analito_id LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
         LEFT JOIN cat_elemento ce ON ce.id = m.cat_elemento_id
        WHERE r.id = $1::uuid`,
      resultadoId,
    ))[0];
    return { tenantId, e, ot, r };
  }

  private puede = async (req: any, ot: any, labId: string | null) => {
    try {
      await this.d.exigirLab(req, ot, "resultado.crear", labId, "el ensayo");
      return !["cerrada", "anulada"].includes(ot.estado);
    } catch {
      return false;
    }
  };

  /* ---------------------------------------------------------- microbiología --- */

  private tipoPorDefecto(metodo: string | null): TipoMicro {
    const m = (metodo ?? "").toUpperCase();
    if (/P\/A|PRESENCIA|SALMONELLA/.test(m)) return "presencia";
    if (/N\.?M\.?P/.test(m)) return "nmp";
    return "recuento";
  }

  async microVer(resultadoId: string, req: any) {
    const { tenantId, e, ot, r } = await this.ensayo(resultadoId, req, "resultado.ver", "lmb_micro");
    const [reg, horasTxt, planesTxt, equipos] = await Promise.all([
      this.d.registro(ot.id, "lmb_micro", resultadoId),
      this.d.param(tenantId, "micro", "lecturas_h", "24,48,72"),
      this.d.param(tenantId, "rsa_criterios", "tabla", "[]"),
      e.laboratorioId ? this.d.equipos(tenantId, [e.laboratorioId]) : Promise.resolve([]),
    ]);
    const datos: RegistroMicro = reg?.datos?.tipo
      ? reg.datos
      : { tipo: this.tipoPorDefecto(r.metodo), siembra: { fecha: null, medio: null, loteMedio: null, diluciones: [1, 2, 3], volumenMl: 1, tecnica: null }, incubacion: { equipoId: null, temperatura: null, inicio: null }, lecturas: [] };
    const horas = leerHoras(horasTxt);
    const plan = planDe(leerPlanes(planesTxt), e.metodoCodigo, r.producto);
    const calc = calcularMicro(datos);
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado },
      ensayo: { id: resultadoId, nombre: r.ensayo, metodo: r.metodo, metodoCodigo: e.metodoCodigo, muestra: r.muestraCodigo, producto: r.producto, maximo: r.limiteSup, requisito: r.requisito, estado: r.estado },
      registro: reg ? { id: reg.id, estado: reg.estado, version: reg.version, actualizadoPorNombre: reg.actualizadoPorNombre, updatedAt: reg.updatedAt } : null,
      datos,
      horas,
      programadas: lecturasProgramadas(datos.incubacion?.inicio ?? null, horas, datos.lecturas ?? [], new Date()),
      calculo: calc,
      plan,
      equipos,
      eventos: reg ? await this.d.eventos(reg.id) : [],
      puedeEditar: await this.puede(req, ot, e.laboratorioId),
    };
  }

  /**
   * Guarda la determinación (siembra → incubación → lecturas). Con
   * `confirmar`, «Confirmar → evaluación»: calcula el resultado, aplica el plan
   * (o el máximo) y lo lleva al ensayo.
   */
  async microGuardar(resultadoId: string, body: any, req: any) {
    const { tenantId, e, ot, r } = await this.ensayo(resultadoId, req, "resultado.crear", "lmb_micro");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const tipo: TipoMicro = ["recuento", "nmp", "presencia"].includes(body?.tipo) ? body.tipo : this.tipoPorDefecto(r.metodo);
    const errores: string[] = [];
    const s = body?.siembra ?? {};
    const diluciones = (Array.isArray(s.diluciones) ? s.diluciones : []).map(Number).filter((x: number) => Number.isInteger(x) && x >= 0 && x <= 10).slice(0, 8);
    const inc = body?.incubacion ?? {};
    const equipos = e.laboratorioId ? await this.d.equipos(tenantId, [e.laboratorioId]) : [];
    const incubadora = inc.equipoId ? equipos.find((x) => x.id === inc.equipoId) : null;
    if (inc.equipoId && !incubadora) errores.push("La incubadora debe ser un equipo del laboratorio.");
    if (incubadora && !incubadora.apto) errores.push(`La incubadora ${incubadora.codigo} no está apta: ${incubadora.motivo}.`);
    const lecturas: Lectura[] = (Array.isArray(body?.lecturas) ? body.lecturas : []).slice(0, 10).map((l: any) => {
      const colonias: Record<string, number[]> = {};
      for (const [k, v] of Object.entries(l?.colonias ?? {})) if (/^\d{1,2}$/.test(k) && Array.isArray(v)) colonias[k] = (v as unknown[]).slice(0, 6).map((x) => Number(x));
      return {
        horas: Number(l?.horas),
        realizada: fechaHora(l?.realizada),
        colonias,
        nmp: num(l?.nmp),
        combinacion: txt(l?.combinacion, 20),
        presencia: l?.presencia === "presencia" || l?.presencia === "ausencia" ? l.presencia : null,
        observacion: txt(l?.observacion, 300),
      };
    });
    if (lecturas.some((l) => !Number.isInteger(l.horas) || l.horas <= 0)) errores.push("Cada lectura indica su hora programada (24, 48…).");
    const datos: RegistroMicro = {
      tipo,
      siembra: { fecha: fechaHora(s.fecha), medio: txt(s.medio), loteMedio: txt(s.loteMedio, 60), diluciones, volumenMl: num(s.volumenMl), tecnica: txt(s.tecnica, 120) },
      incubacion: { equipoId: incubadora?.id ?? null, temperatura: num(inc.temperatura), inicio: fechaHora(inc.inicio) },
      lecturas,
      unidades: (Array.isArray(body?.unidades) ? body.unidades : []).slice(0, 20).map((u: unknown) => (typeof u === "number" ? u : String(u ?? "").trim())).filter((u: unknown) => u !== ""),
      cantidadAnalizada: txt(body?.cantidadAnalizada, 40),
    };
    if (datos.incubacion.inicio && datos.siembra.fecha && datos.incubacion.inicio < datos.siembra.fecha) errores.push("La incubación no puede empezar antes de la siembra.");
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const calc = calcularMicro(datos);
    const confirmar = body?.confirmar === true;
    const reg = await this.d.registro(ot.id, "lmb_micro", resultadoId);
    const corrige = reg?.estado === "confirmada";
    const motivo = corrige ? (typeof body?.motivo === "string" && body.motivo.trim().length >= 5 ? body.motivo.trim() : null) : null;
    if (corrige && !motivo) throw new BadRequestException("La determinación ya se confirmó: indique el motivo de la corrección (mínimo 5 caracteres).");
    let veredicto: "cumple" | "no_cumple" | "pendiente" = "pendiente";
    let textoPlan = "";
    if (confirmar) {
      if (calc.errores.length) throw new BadRequestException(calc.errores.join(" "));
      const plan = planDe(leerPlanes(await this.d.param(tenantId, "rsa_criterios", "tabla", "[]")), e.metodoCodigo, r.producto);
      if (plan && tipo !== "presencia") {
        const unidades = datos.unidades?.length ? datos.unidades : calc.valor != null ? [calc.valor] : [calc.texto];
        const p = evaluarPlan(plan, unidades);
        if (p.errores.length) throw new BadRequestException(p.errores.join(" "));
        veredicto = p.veredicto;
        textoPlan = p.texto;
      } else veredicto = veredictoSimple(calc, tipo, num(r.limiteSup), r.requisito);
    }
    const estado = confirmar ? "confirmada" : lecturas.some((l) => l.realizada) ? "leida" : datos.incubacion.inicio ? "en_incubacion" : datos.siembra.fecha ? "sembrada" : "borrador";
    await this.d.guardar(
      { tenantId, otId: ot.id, variante: "lmb_micro", clave: resultadoId, resultadoId, muestraId: e.muestraId, unidadId: e.laboratorioId, datos, estado, veredicto, resumen: calc.texto || null },
      { accion: confirmar ? (corrige ? "corregir" : "confirmar") : "guardar", motivo, usuarioId: usuarioDe(req) },
    );
    let llevado = null;
    if (confirmar)
      llevado = await this.d.llevar(
        req,
        tenantId,
        { id: resultadoId, estado: r.estado, ensayo: r.ensayo, muestraCodigo: r.muestraCodigo },
        "lmb_micro",
        { valorTexto: calc.texto, valorNumerico: calc.valor, veredicto, observacion: [calc.formula, textoPlan].filter(Boolean).join(" · ") || null },
        motivo ?? (r.valorTexto ? "Determinación microbiológica confirmada de nuevo" : null),
      );
    return { ...(await this.microVer(resultadoId, req)), llevado };
  }

  /* ---------------------------------------------------------- sensorial --- */

  private pruebaPorDefecto(metodo: string | null): PruebaSensorial {
    const m = (metodo ?? "").toLowerCase();
    if (m.includes("triangular")) return "triangular";
    if (m.includes("cocc")) return "coccion";
    return "escala";
  }

  private atributosPorDefecto(metodo: string | null): string[] {
    const m = (metodo ?? "").toLowerCase();
    if (m.includes("calidad")) return ["Apariencia", "Color", "Olor", "Sabor", "Textura", "Consistencia", "Sabor residual"];
    return ["Aceptabilidad"];
  }

  async sensorialVer(resultadoId: string, req: any) {
    const { tenantId, e, ot, r } = await this.ensayo(resultadoId, req, "resultado.ver", "les_panel");
    const [reg, alfaTxt, juecesMin, rangosTxt] = await Promise.all([
      this.d.registro(ot.id, "les_panel", resultadoId),
      this.d.param(tenantId, "sensorial", "alfa", "0,05"),
      this.d.param(tenantId, "sensorial", "jueces_min", "6"),
      this.d.param(tenantId, "sensorial", "rangos", "[]"),
    ]);
    const prueba: PruebaSensorial = reg?.datos?.prueba ?? this.pruebaPorDefecto(r.metodo);
    const atributos: string[] = reg?.datos?.atributos ?? this.atributosPorDefecto(r.metodo);
    const cartillas: Cartilla[] = reg?.datos?.cartillas ?? [];
    const alfa = Number(String(alfaTxt).replace(",", ".")) || 0.05;
    const rangos = leerRangos(rangosTxt);
    return {
      ot: { id: ot.id, codigo: ot.codigo, estado: ot.estado },
      ensayo: { id: resultadoId, nombre: r.ensayo, metodo: r.metodo, muestra: r.muestraCodigo, estado: r.estado },
      registro: reg ? { id: reg.id, estado: reg.estado, version: reg.version, actualizadoPorNombre: reg.actualizadoPorNombre, updatedAt: reg.updatedAt } : null,
      prueba,
      atributos,
      plan: reg?.datos?.plan ?? null,
      cartillas,
      config: { alfa, juecesMin: Number(juecesMin) || 6, rangos },
      consolidacion: prueba === "escala" ? { atributos: estadisticaEscala(cartillas, atributos) } : prueba === "triangular" ? { triangular: triangular(cartillas, alfa) } : { coccion: cartillas.filter((c) => !c.excluido && c.coccion) },
      eventos: reg ? await this.d.eventos(reg.id) : [],
      puedeEditar: await this.puede(req, ot, e.laboratorioId),
    };
  }

  /**
   * Acciones: `plan` («Generar cartillas → sesión»: códigos y orden por juez),
   * `cartillas` (guarda las respuestas) y `consolidar` («Consolidar →
   * evaluación»: estadístico y valor al ensayo).
   */
  async sensorialGuardar(resultadoId: string, body: any, req: any) {
    const { tenantId, e, ot, r } = await this.ensayo(resultadoId, req, "resultado.crear", "les_panel");
    if (["cerrada", "anulada"].includes(ot.estado)) throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}.`);
    const reg = await this.d.registro(ot.id, "les_panel", resultadoId);
    const prueba: PruebaSensorial = ["escala", "triangular", "coccion"].includes(body?.prueba) ? body.prueba : reg?.datos?.prueba ?? this.pruebaPorDefecto(r.metodo);
    const atributos: string[] = (Array.isArray(body?.atributos) ? body.atributos : reg?.datos?.atributos ?? this.atributosPorDefecto(r.metodo)).map((a: unknown) => String(a).trim().slice(0, 40)).filter(Boolean).slice(0, 12);
    const accion = String(body?.accion ?? "cartillas");
    const datos: any = { ...(reg?.datos ?? {}), prueba, atributos };
    const juecesMin = Number(await this.d.param(tenantId, "sensorial", "jueces_min", "6")) || 6;
    if (accion === "plan") {
      const jueces = Number(body?.jueces);
      const muestras = Math.max(1, Math.min(Number(body?.muestras) || (prueba === "triangular" ? 3 : 1), 12));
      if (!Number.isInteger(jueces) || jueces < 1 || jueces > 60) throw new BadRequestException("Indique el Nº de jueces convocados (1 a 60).");
      const semilla = Number.isInteger(body?.semilla) ? body.semilla : Date.now() % 100000;
      const codigos = codigosAleatorios(muestras, semilla);
      datos.plan = { jueces, muestras, codigos, orden: ordenPorJuez(codigos, jueces), semilla, fecha: txt(body?.fecha, 25), condiciones: txt(body?.condiciones, 200), repeticiones: Number(body?.repeticiones) || 1 };
      datos.cartillas = Array.from({ length: jueces }, (_, i) => reg?.datos?.cartillas?.[i] ?? { juez: `J${String(i + 1).padStart(2, "0")}` });
    } else {
      const cartillas: Cartilla[] = (Array.isArray(body?.cartillas) ? body.cartillas : []).slice(0, 60).map((c: any) => ({
        juez: String(c?.juez ?? "").trim().slice(0, 20),
        excluido: c?.excluido === true,
        motivoExclusion: txt(c?.motivoExclusion, 200),
        puntajes: Object.fromEntries(atributos.map((a) => [a, num(c?.puntajes?.[a])])),
        correcta: typeof c?.correcta === "boolean" ? c.correcta : null,
        coccion: c?.coccion === "blandas" || c?.coccion === "duras" ? c.coccion : null,
        comentario: txt(c?.comentario, 300),
      }));
      const errores = erroresCartillas(prueba, cartillas, atributos);
      if (errores.length) throw new BadRequestException(errores.join(" "));
      datos.cartillas = cartillas;
    }
    let veredicto: "cumple" | "no_cumple" | "pendiente" | "informativo" = "pendiente";
    let valor: { texto: string; numero: number | null; obs: string } | null = null;
    const corrige = reg?.estado === "consolidada";
    const motivo = corrige ? (typeof body?.motivo === "string" && body.motivo.trim().length >= 5 ? body.motivo.trim() : null) : null;
    if (corrige && !motivo) throw new BadRequestException("El panel ya se consolidó: indique el motivo de la corrección (mínimo 5 caracteres).");
    if (accion === "consolidar") {
      const cartillas: Cartilla[] = datos.cartillas ?? [];
      const validas = cartillas.filter((c) => !c.excluido);
      if (validas.length < juecesMin) throw new BadRequestException(`Hay ${validas.length} jueces válidos: el mínimo es ${juecesMin} (Parámetros › Sensorial).`);
      const alfa = Number(String(await this.d.param(tenantId, "sensorial", "alfa", "0,05")).replace(",", ".")) || 0.05;
      if (prueba === "escala") {
        const est = estadisticaEscala(cartillas, atributos);
        const principal = est[0];
        if (!principal || principal.media == null) throw new BadRequestException("Registre los puntajes de los jueces.");
        const rangos = leerRangos(await this.d.param(tenantId, "sensorial", "rangos", "[]"));
        const vs = est.map((x) => veredictoRango(x.media, rangos.find((g) => g.atributo.toLowerCase() === x.atributo.toLowerCase())));
        veredicto = vs.includes("no_cumple") ? "no_cumple" : vs.every((v) => v === "cumple") ? "cumple" : vs.includes("pendiente") ? "pendiente" : "informativo";
        valor = { texto: principal.media.toLocaleString("es-CL"), numero: principal.media, obs: est.map((x) => `${x.atributo}: media ${x.media?.toLocaleString("es-CL")} · DE ${x.de?.toLocaleString("es-CL")} (n = ${x.n})`).join("; ") };
      } else if (prueba === "triangular") {
        const t = triangular(cartillas, alfa);
        veredicto = "informativo";
        valor = { texto: t.diferencia ? "Existen diferencias significativas" : "No existen diferencias significativas", numero: null, obs: t.conclusion };
      } else {
        const respuestas = validas.filter((c) => c.coccion);
        const blandas = respuestas.filter((c) => c.coccion === "blandas").length;
        veredicto = blandas > respuestas.length / 2 ? "cumple" : "no_cumple";
        valor = { texto: veredicto === "cumple" ? "Blandas" : "Duras", numero: null, obs: `${blandas} de ${respuestas.length} jueces: blandas` };
      }
    }
    const estado = accion === "consolidar" ? "consolidada" : datos.plan ? "en_sesion" : "borrador";
    await this.d.guardar(
      { tenantId, otId: ot.id, variante: "les_panel", clave: resultadoId, resultadoId, muestraId: e.muestraId, unidadId: e.laboratorioId, datos, estado, veredicto, resumen: valor?.obs ?? null },
      { accion: corrige ? "corregir" : accion, motivo, usuarioId: usuarioDe(req) },
    );
    let llevado = null;
    if (valor)
      llevado = await this.d.llevar(
        req,
        tenantId,
        { id: resultadoId, estado: r.estado, ensayo: r.ensayo, muestraCodigo: r.muestraCodigo },
        "les_panel",
        { valorTexto: valor.texto, valorNumerico: valor.numero, veredicto: veredicto as any, observacion: valor.obs },
        motivo ?? (r.valorTexto ? "Panel sensorial consolidado de nuevo" : null),
      );
    return { ...(await this.sensorialVer(resultadoId, req)), llevado };
  }
}
