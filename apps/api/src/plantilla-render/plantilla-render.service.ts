import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../common/prisma.service";

/**
 * Motor de autorelleno de plantillas de informe/certificado.
 * Reúne los datos del expediente (OT + cliente + muestras + resultados + firmas),
 * sustituye los placeholders {{campo}} y {{tabla_resultados}}, calcula el HASH
 * SHA-256 del documento y (al emitir) crea el registro Certificado con su código
 * de verificación. La firma va como imagen registrada por usuario (imagen + HASH).
 */
@Injectable()
export class PlantillaRenderService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ensambla el contexto de datos de una OT para rellenar la plantilla. */
  async contexto(otId: string) {
    const ot = await this.prisma.ordenTrabajo.findUnique({
      where: { id: otId },
      include: { cliente: true },
    });
    if (!ot) throw new NotFoundException(`OT ${otId} no encontrada`);

    const muestras = await this.prisma.muestra.findMany({ where: { otId } });
    const resultados = await this.prisma.resultado.findMany({
      where: { otId },
      include: { analito: true, muestra: true },
    });

    return {
      escalares: {
        ot: ot.codigo,
        cliente: ot.cliente?.razonSocial ?? "",
        rut: ot.cliente?.rut ?? "",
        fecha_emision: new Date().toLocaleDateString("es-CL"),
        laboratorio: ot.subdireccionAsignada ?? "",
        n_muestras: String(muestras.length),
      },
      muestras,
      resultados,
    };
  }

  /** Sustituye placeholders escalares + {{tabla_resultados}} en la plantilla. */
  private fill(template: string, ctx: Awaited<ReturnType<PlantillaRenderService["contexto"]>>) {
    let out = template;
    for (const [k, v] of Object.entries(ctx.escalares)) {
      out = out.replaceAll(`{{${k}}}`, String(v ?? ""));
    }
    const filas = ctx.resultados
      .map(
        (r: any) =>
          `<tr><td>${r.analito?.nombre ?? ""}</td><td>${r.muestra?.nombre ?? ""}</td>` +
          `<td>${r.promedio ?? "—"} ${r.unidad ?? ""}</td><td>${r.veredicto ?? "—"}</td></tr>`,
      )
      .join("");
    const tabla =
      `<table class="rep"><thead><tr><th>Ensayo</th><th>Muestra</th><th>Resultado</th><th>Condición</th></tr></thead>` +
      `<tbody>${filas || "<tr><td colspan='4'>Sin resultados</td></tr>"}</tbody></table>`;
    out = out.replaceAll("{{tabla_resultados}}", tabla);
    return out;
  }

  /** Previsualiza el documento relleno (sin emitir). Devuelve HTML + HASH. */
  async previsualizar(otId: string, plantillaId: string) {
    const plantilla = await this.prisma.plantillaInforme.findUnique({ where: { id: plantillaId } });
    if (!plantilla) throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);
    const ctx = await this.contexto(otId);
    const base = `<h2>${plantilla.nombre} (${plantilla.repid})</h2>
      <p>O/T: {{ot}} · Cliente: {{cliente}} ({{rut}}) · Fecha: {{fecha_emision}}</p>
      <h3>Resultados</h3>{{tabla_resultados}}`;
    const html = this.fill(base, ctx);
    const hash = createHash("sha256").update(html).digest("hex");
    return { plantilla: plantilla.repid, html, hash };
  }

  /** Emite el documento: lo rellena, sella con HASH y registra el Certificado. */
  async emitir(otId: string, plantillaId: string, codigo: string, tenantId: string) {
    const { html, hash } = await this.previsualizar(otId, plantillaId);
    const cert = await this.prisma.certificado.create({
      data: {
        tenantId,
        otId,
        codigo,
        plantillaId,
        hashSha256: hash,
        urlVerificacion: `https://verificar.idic.cl/c/${hash.slice(0, 16)}`,
        estado: "emitido",
      },
    });
    return { certificado: cert, html, hash };
  }
}
