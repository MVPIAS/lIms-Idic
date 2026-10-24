import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "./alcance.service";
import { ancestroDeTipo } from "./alcance";
import { registrarFuenteBandeja, type ElementoBandeja, type ItemBandeja } from "./bandeja.service";

/**
 * B-017 (recorrido MP-04, D04-08) · tarjetas de Mi bandeja para los documentos
 * de los instrumentos no calibrables de una OT de Metrología (EP-04 PX.3):
 *
 *   · «Informes técnicos por emitir»: informes en firma de las OT de sus
 *     laboratorios, para quien emite (metrologia.emitir: Jefe del laboratorio).
 *   · «Servicios externos por aprobar»: contrataciones externas solicitadas,
 *     para el Jefe del Departamento del laboratorio de la OT (titular o
 *     subrogante en Administración › Unidades), como en la ficha de la OT.
 *
 * Cada tarjeta lleva sus primeras filas y abre la pestaña «Instrumentos» de la OT.
 */
@Injectable()
export class BandejaMetrologiaDocumentos implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  onModuleInit() {
    registrarFuenteBandeja((req) => this.tarjetas(req));
  }

  private tiene(req: any, p: string) {
    return (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(p);
  }

  async tarjetas(req: any): Promise<ItemBandeja[]> {
    const t = req?.user?.tenantId, yo = req?.user?.sub;
    if (!t || !yo) return [];
    const out: ItemBandeja[] = [];
    const ruta = (otId: string) => `/ot/${otId}?tab=instrumentos`;
    const tarjeta = (clave: string, titulo: string, descripcion: string, el: ElementoBandeja[]): ItemBandeja => ({
      clave, titulo, descripcion, cantidad: el.length, ruta: el[0]?.ruta ?? "/ot?estado=abiertas", severidad: "warn", elementos: el.slice(0, 5),
    });

    if (this.tiene(req, "metrologia.emitir")) {
      const unidades = await this.alcance.filtroUnidades(req, "metrologia.emitir");
      const filas = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT i.id, o.id AS "otId", o.codigo AS ot, it.numero, it.descripcion, to_char(i.enviado_at, 'YYYY-MM-DD') AS fecha
           FROM met_informe_tecnico i
           JOIN orden_trabajo o ON o.id = i.ot_id
           JOIN met_ot_instrumento it ON it.id = i.ot_instrumento_id
          WHERE i.tenant_id = $1::uuid AND i.estado = 'en_firma' AND o.estado NOT IN ('cerrada', 'anulada')
            AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))
          ORDER BY i.enviado_at NULLS LAST LIMIT 200`,
        t,
        unidades,
      );
      if (filas.length)
        out.push(
          tarjeta(
            "met_informes_por_emitir",
            "Informes técnicos por emitir",
            "Informes de instrumentos no calibrables enviados por el metrólogo: revíselos y emítalos",
            filas.map((f) => ({ id: f.id, texto: `${f.ot} · ítem ${f.numero}`, detalle: f.descripcion, ruta: ruta(f.otId), fecha: f.fecha })),
          ),
        );
    }

    // Jefaturas (titular o subrogante) que el usuario tiene en Administración › Unidades.
    const jefaturas = await this.prisma.$queryRawUnsafe<{ unidad_id: string }[]>(
      `SELECT unidad_id FROM unidad_jefe WHERE usuario_id = $1::uuid`,
      yo,
    );
    const esSuper = (req?.user?.roles ?? []).includes("SUPERADMIN");
    if (jefaturas.length || esSuper) {
      const propias = new Set(jefaturas.map((j) => j.unidad_id));
      const arbol = await this.alcance.arbol(t);
      const filas = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT e.id, o.id AS "otId", o.codigo AS ot, o.unidad_principal AS unidad, it.numero, p.razon_social AS proveedor,
                to_char(e.created_at, 'YYYY-MM-DD') AS fecha
           FROM met_servicio_externo e
           JOIN met_ot_instrumento it ON it.id = e.ot_instrumento_id
           JOIN orden_trabajo o ON o.id = it.ot_id
           LEFT JOIN proveedor p ON p.id = e.proveedor_id
          WHERE o.tenant_id = $1::uuid AND e.estado = 'solicitado' AND o.estado NOT IN ('cerrada', 'anulada')
          ORDER BY e.created_at LIMIT 200`,
        t,
      );
      const mias = filas.filter((f) => {
        if (esSuper) return true;
        const d = f.unidad ? ancestroDeTipo(arbol, f.unidad, "DEPARTAMENTO") : null;
        return !!d && propias.has(d.id);
      });
      if (mias.length)
        out.push(
          tarjeta(
            "met_externos_por_aprobar",
            "Servicios externos por aprobar",
            "Contrataciones de calibración externa solicitadas por el laboratorio: apruébelas o rechácelas",
            mias.map((f) => ({ id: f.id, texto: `${f.ot} · ítem ${f.numero}`, detalle: f.proveedor ?? null, ruta: ruta(f.otId), fecha: f.fecha })),
          ),
        );
    }
    return out;
  }
}
