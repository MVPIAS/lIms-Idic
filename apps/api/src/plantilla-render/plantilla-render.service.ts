import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { createHash, randomInt } from "crypto";
import { PrismaService } from "../common/prisma.service";
import {
  renderizar,
  tablaResultados,
  tablaMuestras,
  type FilaResultado,
  type FilaMuestra,
} from "./template.engine";
import { fmtFecha, fmtFechaHora, fmtNum } from "./html.util";
import { cuerpoPorDefecto, documentoCompleto, type Sello } from "./plantilla-defecto";
import { generarPdf } from "./pdf.renderer";

/**
 * Emisión real de informes/certificados del LIMS IDIC.
 *
 * Reúne el expediente (OT + cliente + muestras + resultados + límites), rellena
 * el CUERPO de la plantilla (`plantilla_informe.cuerpo_html`, ver
 * `packages/db/align_certificado.sql`), sella el documento con SHA-256, le
 * asigna un correlativo por tenant y año y registra el `Certificado`.
 *
 * ---------------------------------------------------------------------------
 * QUÉ SE SELLA (anti-repudio)
 * ---------------------------------------------------------------------------
 * `hash_sha256 = sha256(documento_html)`, donde `documento_html` es el CUERPO
 * renderizado, guardado tal cual en la fila del certificado. La verificación es
 * reproducible en cualquier momento aunque los resultados de la OT cambien
 * después: no se re-renderiza nada, se rehashea lo guardado.
 *
 * El pie con el hash y el código de verificación NO entra en lo sellado (sería
 * circular: un texto no puede contener su propio hash). El pie lo añade la capa
 * de presentación (`documentoCompleto` / `generarPdf`).
 */
@Injectable()
export class PlantillaRenderService {
  constructor(private readonly prisma: PrismaService) {}

  /** URL pública de verificación; configurable por despliegue. */
  private get baseVerificacion(): string {
    return (process.env.URL_VERIFICACION ?? "https://verificar.idic.cl/c").replace(/\/+$/, "");
  }

  /* ====================================================================== */
  /* Contexto                                                               */
  /* ====================================================================== */

  /**
   * Ensambla el contexto de datos de una OT para rellenar la plantilla.
   * Aislamiento por tenant: 404 (no 403) para no revelar OTs de otro tenant.
   */
  async contexto(otId: string, tenantId?: string) {
    const ot = await this.prisma.ordenTrabajo.findUnique({
      where: { id: otId },
      include: { cliente: true },
    });
    if (!ot) throw new NotFoundException(`OT ${otId} no encontrada`);
    if (tenantId && ot.tenantId !== tenantId) throw new NotFoundException(`OT ${otId} no encontrada`);

    const muestras = await this.prisma.muestra.findMany({
      where: { otId, deletedAt: null },
      include: { tipoMuestra: true },
      orderBy: { codigo: "asc" },
    });
    const resultados = await this.prisma.resultado.findMany({
      where: { otId, deletedAt: null },
      include: { analito: true, muestra: true },
      orderBy: { fecha: "asc" },
    });

    // Límites de norma de los analitos implicados, en UNA consulta (no N+1).
    const analitoIds = [...new Set(resultados.map((r) => r.analitoId))];
    const limites = analitoIds.length
      ? await this.prisma.normaLimite.findMany({ where: { analitoId: { in: analitoIds } } })
      : [];
    const limitePorAnalito = new Map<string, (typeof limites)[number]>();
    for (const l of limites) if (!limitePorAnalito.has(l.analitoId)) limitePorAnalito.set(l.analitoId, l);

    return { ot, cliente: ot.cliente, muestras, resultados, limitePorAnalito };
  }

  /** Texto imprimible del límite de norma. Sin glifos fuera de WinAnsi (ver pdf.renderer). */
  private textoLimite(
    l: { limiteInf: unknown; limiteSup: unknown; nominal: unknown; unidad: string | null } | undefined,
  ): string {
    if (!l) return "";
    const inf = l.limiteInf === null || l.limiteInf === undefined ? null : fmtNum(String(l.limiteInf));
    const sup = l.limiteSup === null || l.limiteSup === undefined ? null : fmtNum(String(l.limiteSup));
    const nom = l.nominal === null || l.nominal === undefined ? null : fmtNum(String(l.nominal));
    const u = l.unidad ? ` ${l.unidad}` : "";
    if (inf !== null && sup !== null) return `${inf} – ${sup}${u}`;
    if (inf !== null) return `mín. ${inf}${u}`;
    if (sup !== null) return `máx. ${sup}${u}`;
    if (nom !== null) return `nominal ${nom}${u}`;
    return "";
  }

  /** Aplana el contexto a las rutas que ven las plantillas: {{cliente.razonSocial}}, {{ot.codigo}}… */
  private datosPlantilla(
    ctx: Awaited<ReturnType<PlantillaRenderService["contexto"]>>,
    plantilla: { repid: string; nombre: string; tipo: string; version: string },
    cert: { numero: string; codigoVerificacion: string; fecha: Date },
  ) {
    const { ot, cliente, muestras, resultados } = ctx;
    return {
      // --- rutas punteadas (las que usan los cuerpos sembrados) ---
      ot: {
        ...ot,
        fechaRecepcion: fmtFecha(ot.fechaRecepcion),
        fechaCompromiso: fmtFecha(ot.fechaCompromiso),
        fechaCierre: fmtFecha(ot.fechaCierre),
      },
      cliente: cliente ?? {},
      plantilla,
      certificado: {
        numero: cert.numero,
        codigo_verificacion: cert.codigoVerificacion,
        codigoVerificacion: cert.codigoVerificacion,
        fecha: fmtFecha(cert.fecha),
        tipo: plantilla.tipo,
      },
      fecha: fmtFecha(cert.fecha),
      fecha_hora: fmtFechaHora(cert.fecha),
      anio: String(cert.fecha.getFullYear()),
      n_muestras: String(muestras.length),
      n_resultados: String(resultados.length),
      laboratorio: ot.subdireccionAsignada ?? "",

      // --- alias planos heredados: los escalares del motor anterior, para que
      // un cuerpo escrito contra la API vieja siga rellenándose ---
      cliente_nombre: cliente?.razonSocial ?? "",
      rut: cliente?.rut ?? "",
      fecha_emision: fmtFecha(cert.fecha),
      ot_codigo: ot.codigo,
    };
  }

  /** Filas de {{tabla_resultados}}: analito, unidad, promedio, DE, CV, límite, veredicto. */
  private filasResultados(ctx: Awaited<ReturnType<PlantillaRenderService["contexto"]>>): FilaResultado[] {
    return ctx.resultados.map((r) => {
      const lim = ctx.limitePorAnalito.get(r.analitoId);
      return {
        analito: r.analito?.nombre ?? "",
        muestra: r.muestra?.codigo ?? r.muestra?.nombre ?? "",
        unidad: r.unidad ?? r.analito?.unidad ?? "",
        promedio: fmtNum(r.promedio === null ? "" : String(r.promedio)),
        desviacion: fmtNum(r.desviacion === null ? "" : String(r.desviacion)),
        cv: fmtNum(r.cv === null ? "" : String(r.cv), 2),
        limite: this.textoLimite(lim),
        veredicto: r.veredicto ?? "",
      };
    });
  }

  private filasMuestras(ctx: Awaited<ReturnType<PlantillaRenderService["contexto"]>>): FilaMuestra[] {
    return ctx.muestras.map((m) => ({
      codigo: m.codigo,
      nombre: m.nombre ?? "",
      tipo: m.tipoMuestra?.nombre ?? "",
      estado: m.estado,
    }));
  }

  /* ====================================================================== */
  /* Render                                                                 */
  /* ====================================================================== */

  /**
   * Núcleo del renderizado. Devuelve el CUERPO (lo que se sella) y su hash.
   * `avisos[]` reporta plantilla sin cuerpo y placeholders sin dato.
   */
  private async render(
    otId: string,
    plantillaId: string,
    tenantId: string | undefined,
    cert: { numero: string; codigoVerificacion: string; fecha: Date },
  ) {
    const plantilla = await this.prisma.plantillaInforme.findUnique({ where: { id: plantillaId } });
    if (!plantilla) throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);
    if (tenantId && plantilla.tenantId !== tenantId)
      throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);

    const ctx = await this.contexto(otId, tenantId);
    const avisos: string[] = [];

    // 1. Cuerpo: el de la plantilla; si es una cáscara, el de su tipo + aviso.
    let cuerpo = plantilla.cuerpoHtml?.trim() ?? "";
    const usaDefecto = cuerpo === "";
    if (usaDefecto) {
      cuerpo = cuerpoPorDefecto(plantilla.tipo);
      avisos.push(
        `La plantilla ${plantilla.repid} · "${plantilla.nombre}" (${plantilla.tipo}) no tiene cuerpo cargado: ` +
          `se ha usado la plantilla POR DEFECTO del tipo ${plantilla.tipo}. Cargue el formato real en ` +
          `plantilla_informe.cuerpo_html para emitir con la maqueta oficial.`,
      );
    }

    // 2. Datos + bloques generados.
    const datos = this.datosPlantilla(ctx, plantilla, cert);
    const bloques = {
      tabla_resultados: tablaResultados(this.filasResultados(ctx)),
      tabla_muestras: tablaMuestras(this.filasMuestras(ctx)),
    };
    const { html: cuerpoRenderizado, faltantes } = renderizar(cuerpo, datos, bloques);

    if (faltantes.length)
      avisos.push(`Placeholders sin dato en el expediente (se emiten vacíos): ${faltantes.join(", ")}.`);
    if (ctx.resultados.length === 0)
      avisos.push("La OT no tiene resultados registrados: la tabla de resultados sale vacía.");

    // 3. Sello: hash del CUERPO (no del documento con pie -> sería circular).
    const hash = createHash("sha256").update(cuerpoRenderizado, "utf8").digest("hex");

    return { plantilla, ctx, cuerpoRenderizado, hash, avisos, usaDefecto };
  }

  /** Título legible del documento (metadatos del PDF y <title>). */
  private titulo(numero: string, plantillaNombre: string, otCodigo: string): string {
    return `${numero} · ${plantillaNombre} · OT ${otCodigo}`;
  }

  /**
   * Previsualiza el documento relleno SIN emitir: no consume correlativo ni
   * escribe nada. El número va marcado como borrador para que un PDF/impresión
   * de la previsualización no pueda confundirse con un certificado válido
   * (además de la marca de agua en el PDF).
   */
  async previsualizar(otId: string, plantillaId: string, tenantId?: string) {
    const fecha = new Date();
    const cert = {
      numero: `CERT-${fecha.getFullYear()}-XXXX`,
      codigoVerificacion: "SIN EMITIR",
      fecha,
    };
    const { plantilla, ctx, cuerpoRenderizado, hash, avisos, usaDefecto } = await this.render(
      otId,
      plantillaId,
      tenantId,
      cert,
    );

    const sello: Sello = {
      numero: cert.numero,
      codigoVerificacion: cert.codigoVerificacion,
      hash,
      fecha: fmtFecha(fecha),
      urlVerificacion: this.baseVerificacion,
      borrador: true,
    };

    return {
      plantilla: plantilla.repid,
      plantillaNombre: plantilla.nombre,
      tipo: plantilla.tipo,
      usaPlantillaPorDefecto: usaDefecto,
      avisos,
      hash,
      html: documentoCompleto(
        cuerpoRenderizado,
        sello,
        this.titulo(cert.numero, plantilla.nombre, ctx.ot.codigo),
      ),
    };
  }

  /* ====================================================================== */
  /* Correlativo                                                            */
  /* ====================================================================== */

  /**
   * Reserva el siguiente correlativo del tenant/año DENTRO de la transacción `tx`.
   *
   * GARANTÍA DE UNICIDAD
   * --------------------
   * `INSERT ... ON CONFLICT (tenant_id, anio) DO UPDATE SET ultimo = ultimo + 1
   * RETURNING ultimo` es atómico en PostgreSQL: la rama DO UPDATE toma un lock
   * de fila EXCLUSIVO sobre el contador. Dos emisiones simultáneas del mismo
   * tenant/año se serializan en ese lock — la segunda se bloquea hasta el commit
   * de la primera y lee el valor ya incrementado. Nunca devuelven el mismo NNNN.
   *
   * Frente a `SELECT max(...)` + `INSERT` (el patrón de `common/codigo.ts`, que
   * la auditoría §5.15 marca como condición de carrera) aquí no hay ventana
   * read-then-write, y además cubre el caso "la fila del contador aún no existe",
   * que un `SELECT ... FOR UPDATE` no puede bloquear (no hay fila que bloquear).
   *
   * Al ir en la misma transacción que el INSERT del certificado, un fallo
   * posterior revierte también el contador. Defensa en profundidad:
   * UNIQUE(tenant_id, codigo) + ux_certificado_numero rechazan el duplicado
   * aunque alguien inserte por fuera de aquí.
   */
  private async siguienteNumero(tx: any, tenantId: string, anio: number): Promise<string> {
    const filas = await tx.$queryRaw<Array<{ ultimo: number }>>`
      INSERT INTO certificado_correlativo (tenant_id, anio, ultimo, updated_at)
      VALUES (${tenantId}::uuid, ${anio}, 1, now())
      ON CONFLICT (tenant_id, anio)
      DO UPDATE SET ultimo = certificado_correlativo.ultimo + 1, updated_at = now()
      RETURNING ultimo
    `;
    const n = Number(filas[0]?.ultimo ?? 0);
    if (!n) throw new ConflictException("No se pudo reservar el correlativo del certificado");
    // padStart(4) da CERT-2026-0001; a partir de 10000 crece a 5 dígitos sin
    // romper nada (el contador es INTEGER, no hay orden lexicográfico).
    return `CERT-${anio}-${String(n).padStart(4, "0")}`;
  }

  /**
   * Código de verificación corto e imprimible.
   * Alfabeto Crockford base32 sin I/L/O/U: no se confunde 0/O ni 1/I al teclearlo
   * desde el papel, y evita formar palabras. 10 símbolos ~= 51 bits de entropía:
   * no es adivinable por fuerza bruta contra el endpoint público.
   * `randomInt` usa el CSPRNG del sistema (no Math.random).
   */
  private nuevoCodigoVerificacion(): string {
    const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let s = "";
    for (let i = 0; i < 10; i++) s += A[randomInt(A.length)];
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  }

  /* ====================================================================== */
  /* Emisión                                                                */
  /* ====================================================================== */

  /**
   * Emite el documento: rellena la plantilla, sella con SHA-256, reserva el
   * correlativo y registra el Certificado.
   *
   * El correlativo lo genera el SISTEMA (RF F02.1): ya no lo aporta el llamador.
   */
  async emitir(otId: string, plantillaId: string, tenantId: string, usuarioId?: string) {
    const fecha = new Date();
    const anio = fecha.getFullYear();
    const codigoVerificacion = this.nuevoCodigoVerificacion();

    // La transacción cubre: reservar correlativo -> renderizar con ese número
    // -> insertar. El render va dentro porque el CUERPO IMPRIME el número, así
    // que el hash depende de él: no se puede sellar antes de conocerlo.
    const emitido = await this.prisma.$transaction(async (tx) => {
      const numero = await this.siguienteNumero(tx, tenantId, anio);

      const { plantilla, ctx, cuerpoRenderizado, hash, avisos, usaDefecto } = await this.render(
        otId,
        plantillaId,
        tenantId,
        { numero, codigoVerificacion, fecha },
      );

      const cert = await tx.certificado.create({
        data: {
          tenantId,
          otId,
          codigo: numero, // UNIQUE(tenant_id, codigo): cierre duro de la unicidad
          numero,
          tipo: plantilla.tipo,
          plantillaId,
          hashSha256: hash,
          codigoVerificacion,
          documentoHtml: cuerpoRenderizado, // sha256(documentoHtml) == hashSha256
          urlVerificacion: `${this.baseVerificacion}/${codigoVerificacion}`,
          emitidoPor: usuarioId ?? null,
          fecha,
          estado: "emitido",
        },
      });

      return { cert, plantilla, otCodigo: ctx.ot.codigo, cuerpoRenderizado, hash, avisos, usaDefecto };
    });

    const sello: Sello = {
      numero: emitido.cert.numero!,
      codigoVerificacion,
      hash: emitido.hash,
      fecha: fmtFecha(fecha),
      urlVerificacion: emitido.cert.urlVerificacion!,
    };

    return {
      certificado: emitido.cert,
      numero: emitido.cert.numero,
      codigoVerificacion,
      hash: emitido.hash,
      urlVerificacion: emitido.cert.urlVerificacion,
      usaPlantillaPorDefecto: emitido.usaDefecto,
      avisos: emitido.avisos,
      html: documentoCompleto(
        emitido.cuerpoRenderizado,
        sello,
        this.titulo(sello.numero, emitido.plantilla.nombre, emitido.otCodigo),
      ),
    };
  }

  /* ====================================================================== */
  /* Descarga                                                               */
  /* ====================================================================== */

  /** Carga un certificado validando tenant (404 en cross-tenant, no 403). */
  private async certificadoDelTenant(certificadoId: string, tenantId?: string) {
    const cert = await this.prisma.certificado.findUnique({
      where: { id: certificadoId },
      include: { plantilla: true, ot: true },
    });
    if (!cert || cert.deletedAt) throw new NotFoundException(`Certificado ${certificadoId} no encontrado`);
    if (tenantId && cert.tenantId !== tenantId)
      throw new NotFoundException(`Certificado ${certificadoId} no encontrado`);
    return cert;
  }

  /**
   * PDF del certificado emitido, generado a partir del HTML SELLADO que se
   * guardó al emitir. No se re-renderiza: el PDF de hoy y el de dentro de un año
   * son el mismo documento aunque la OT haya cambiado.
   */
  async pdf(certificadoId: string, tenantId?: string) {
    const cert = await this.certificadoDelTenant(certificadoId, tenantId);
    if (!cert.documentoHtml)
      throw new NotFoundException(
        `El certificado ${cert.numero ?? cert.codigo} se emitió antes de que se guardara el documento sellado y no puede regenerarse. Emita uno nuevo.`,
      );

    const sello: Sello = {
      numero: cert.numero ?? cert.codigo,
      codigoVerificacion: cert.codigoVerificacion ?? "—",
      hash: cert.hashSha256 ?? "",
      fecha: fmtFecha(cert.fecha),
      urlVerificacion: cert.urlVerificacion ?? this.baseVerificacion,
    };
    const titulo = this.titulo(sello.numero, cert.plantilla?.nombre ?? "Informe", cert.ot?.codigo ?? "");
    const buffer = await generarPdf(cert.documentoHtml, sello, titulo);
    // Nombre de fichero seguro: el correlativo es [A-Z0-9-], sin ruta ni comillas.
    const nombre = `${sello.numero.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    return { buffer, nombre };
  }

  /** Mismo documento en HTML imprimible (`@media print` A4), por si se prefiere al PDF. */
  async html(certificadoId: string, tenantId?: string) {
    const cert = await this.certificadoDelTenant(certificadoId, tenantId);
    if (!cert.documentoHtml)
      throw new NotFoundException(`El certificado ${cert.numero ?? cert.codigo} no tiene documento sellado.`);
    const sello: Sello = {
      numero: cert.numero ?? cert.codigo,
      codigoVerificacion: cert.codigoVerificacion ?? "—",
      hash: cert.hashSha256 ?? "",
      fecha: fmtFecha(cert.fecha),
      urlVerificacion: cert.urlVerificacion ?? this.baseVerificacion,
    };
    return documentoCompleto(
      cert.documentoHtml,
      sello,
      this.titulo(sello.numero, cert.plantilla?.nombre ?? "Informe", cert.ot?.codigo ?? ""),
    );
  }

  /* ====================================================================== */
  /* Verificación pública                                                   */
  /* ====================================================================== */

  /**
   * Valida un certificado impreso por su código de verificación (endpoint
   * PÚBLICO, sin token).
   *
   * Devuelve SOLO lo que ya está impreso en el papel que tiene delante quien
   * verifica: número, fecha, código de OT y hash. Nunca cliente, RUT, resultados
   * ni ids internos — el endpoint es anónimo y no debe convertirse en un oráculo
   * de datos del expediente.
   *
   * `valido:false` sin más detalle para un código inexistente: no se distingue
   * "no existe" de "mal tecleado" (no se confirma la existencia de correlativos).
   *
   * El hash se RECALCULA sobre el documento sellado en lugar de leer la columna:
   * así el endpoint detecta también una manipulación de `hash_sha256` en la BD.
   */
  async verificar(codigo: string) {
    const limpio = codigo.trim().toUpperCase();
    if (!/^[0-9A-Z-]{5,24}$/.test(limpio)) return { valido: false as const };

    const cert = await this.prisma.certificado.findFirst({
      where: { codigoVerificacion: limpio, deletedAt: null },
      include: { ot: { select: { codigo: true } } },
    });
    if (!cert) return { valido: false as const };

    if (cert.estado !== "emitido")
      return {
        valido: false as const,
        estado: cert.estado, // 'anulado': el papel existió pero ya no vale
        numero: cert.numero ?? cert.codigo,
        fecha: fmtFecha(cert.fecha),
      };

    const hashReal = cert.documentoHtml
      ? createHash("sha256").update(cert.documentoHtml, "utf8").digest("hex")
      : null;
    const integro = hashReal !== null && hashReal === cert.hashSha256;

    return {
      valido: integro,
      estado: cert.estado,
      numero: cert.numero ?? cert.codigo,
      fecha: fmtFecha(cert.fecha),
      otCodigo: cert.ot?.codigo ?? null,
      hash: cert.hashSha256 ?? null,
      ...(integro ? {} : { motivo: "El sello de integridad del documento no coincide" }),
    };
  }
}
