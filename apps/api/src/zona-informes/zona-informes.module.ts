/**
 * Zona de informes · una sola entrada para TODOS los informes del IDIC:
 *  - Reportes fijos (catalogo.ts): listados y gestión con filtros, en pantalla y Excel.
 *  - Documentos por OT (legado-documentos.ts): se emiten con el repositorio de plantillas.
 * Cada informe muestra los archivos Crystal Reports del sistema anterior a los que
 * reemplaza. Las cifras se acotan a los laboratorios que ve quien consulta.
 *
 * Rutas (todas exigen iniciar sesión; el permiso se valida por informe):
 *   GET zona-informes                 · catálogo (solo lo que el usuario puede abrir)
 *   GET zona-informes/:clave          · filas + totales con filtros
 *   GET zona-informes/:clave/excel    · el mismo informe en .xlsx
 */
import { BadRequestException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PermisoGuard } from "../auth/permiso.guard";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import { libroXlsx, type Celda } from "../common/xlsx-escritura";
import { fechaHoraChile } from "../common/fecha-chile";
import { textoEstadoOt } from "../reportes/gestion";
import { AREAS, INFORMES, LIMITE_FILAS, armarConsulta, consultaEstados, informePorClave, textoCodigo, totales, validarFiltros, type InformeFijo } from "./catalogo";
import { DOCUMENTOS_LEGADO } from "./legado-documentos";
import { INFORMES_ESPECIALES } from "./especiales";

/** Tipos de documento por OT: nombre legible y quién los emite. */
export const TIPOS_DOCUMENTO: Record<string, { titulo: string; descripcion: string }> = {
  CERTIFICADO: { titulo: "Certificados", descripcion: "Certificados de análisis, de control y de conformidad." },
  "I.ENSAYO": { titulo: "Informes de ensayo", descripcion: "Resultados de análisis por OT (informe de ensayo)." },
  IVC: { titulo: "Inspección visual y control (IVC)", descripcion: "Informes de inspección y puntos de control." },
  BOLETIN: { titulo: "Boletines de análisis", descripcion: "Boletines de análisis por OT." },
  "I.TECNICO": { titulo: "Informes técnicos", descripcion: "Informes técnicos y de rechazo." },
  PLANILLA: { titulo: "Planillas de trabajo", descripcion: "Planillas y hojas de trabajo por OT." },
  OTRO: { titulo: "Otros documentos por OT", descripcion: "Constancias, formularios, recibos y pies de firma." },
};

const tienePermiso = (req: any, perm: string) => {
  const u = req?.user ?? {};
  return (u.roles ?? []).includes("SUPERADMIN") || (u.permisos ?? []).includes(perm);
};

@ApiTags("zona-informes")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("zona-informes")
export class ZonaInformesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  @Get()
  async catalogo(@Req() req: any) {
    const t = req?.user?.tenantId;
    const plantillas = t
      ? await this.prisma.$queryRawUnsafe<{ tipo: string; n: number }[]>(
          `SELECT tipo, COUNT(*)::int AS n FROM plantilla_informe WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND COALESCE(activo, TRUE) GROUP BY tipo`,
          t,
        )
      : [];
    const nPlantillas = new Map(plantillas.map((p) => [p.tipo, p.n]));
    const reportes = INFORMES.filter((i) => tienePermiso(req, i.permiso)).map((i) => ({
      clave: i.clave,
      titulo: i.titulo,
      area: i.area,
      descripcion: i.descripcion,
      legado: i.legado,
      pedido: i.pedido ?? null,
      filtros: i.filtros,
      ruta: null as string | null,
    }));
    // Informes con formato propio (p. ej. el trimestral de encuestas): se abren en su pantalla.
    for (const e of INFORMES_ESPECIALES)
      if (tienePermiso(req, e.permiso))
        reportes.push({ clave: e.clave, titulo: e.titulo, area: e.area as InformeFijo["area"], descripcion: e.descripcion, legado: e.legado, pedido: e.pedido, filtros: [], ruta: e.ruta });
    const documentos = Object.entries(DOCUMENTOS_LEGADO).map(([tipo, informes]) => ({
      tipo,
      titulo: TIPOS_DOCUMENTO[tipo]?.titulo ?? tipo,
      descripcion: TIPOS_DOCUMENTO[tipo]?.descripcion ?? "",
      plantillas: nPlantillas.get(tipo) ?? 0,
      legado: informes,
    }));
    return {
      areas: AREAS,
      reportes,
      documentos,
      puede: {
        emitir: tienePermiso(req, "certificado.emitir"),
        verDocumentos: tienePermiso(req, "ot.ver"),
        verPlantillas: tienePermiso(req, "plantilla.ver"),
      },
    };
  }

  private async ejecutar(req: any, clave: string, q: Record<string, unknown>) {
    const def = informePorClave(clave);
    if (!def) throw new NotFoundException("Informe no encontrado");
    if (!tienePermiso(req, def.permiso)) throw new ForbiddenException(`Permiso insuficiente. Requiere: ${def.permiso}`);
    const t = req?.user?.tenantId;
    if (!t) throw new NotFoundException("Tenant no resuelto en el token");
    const v = validarFiltros(def, q);
    if ("error" in v) throw new BadRequestException(v.error);
    const unidades = await this.alcance.filtroUnidades(req, def.permiso);
    const { sql, args } = armarConsulta(def, v.filtros, t, unidades);
    const crudas = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...args);
    const truncado = crudas.length > LIMITE_FILAS;
    const filas = (truncado ? crudas.slice(0, LIMITE_FILAS) : crudas).map((f) => normalizar(def, f));
    return { def, filtros: v.filtros, filas, totales: totales(def, filas), truncado };
  }

  @Get(":clave")
  async informe(@Req() req: any, @Param("clave") clave: string, @Query() q: Record<string, unknown>) {
    const r = await this.ejecutar(req, clave, q);
    return {
      clave: r.def.clave,
      titulo: r.def.titulo,
      area: r.def.area,
      descripcion: r.def.descripcion,
      legado: r.def.legado,
      pedido: r.def.pedido ?? null,
      filtros: r.def.filtros,
      columnas: r.def.columnas,
      filas: r.filas,
      totales: r.totales,
      truncado: r.truncado,
      limite: LIMITE_FILAS,
    };
  }

  @Get(":clave/estados")
  async estados(@Req() req: any, @Param("clave") clave: string) {
    const def = informePorClave(clave);
    if (!def) throw new NotFoundException("Informe no encontrado");
    if (!tienePermiso(req, def.permiso)) throw new ForbiddenException(`Permiso insuficiente. Requiere: ${def.permiso}`);
    const c = consultaEstados(def, req?.user?.tenantId);
    if (!c) return [];
    const filas = await this.prisma.$queryRawUnsafe<{ estado: string }[]>(c.sql, ...c.args);
    const conOt = def.base === "ot";
    return filas.map((f) => ({ valor: f.estado, texto: conOt ? textoEstadoOt(f.estado) : textoCodigo(f.estado) }));
  }

  @Get(":clave/excel")
  async excel(@Req() req: any, @Res() res: Response, @Param("clave") clave: string, @Query() q: Record<string, unknown>) {
    const r = await this.ejecutar(req, clave, q);
    const b = libroXlsx([hojaInforme(r.def, r.filas, r.totales, r.filtros, r.truncado)]);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${r.def.clave}_${r.filtros.desde ?? "inicio"}_${r.filtros.hasta ?? "hoy"}.xlsx"`);
    res.send(b);
  }
}

/** Fechas a texto DD-MM-AAAA (o con hora, en hora de Chile), números a número, códigos a texto legible. */
export function normalizar(def: InformeFijo, f: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const c of def.columnas) {
    const v = f[c.clave];
    if (v === null || v === undefined) {
      o[c.clave] = null;
      continue;
    }
    switch (c.tipo) {
      case "fecha":
        o[c.clave] = fechaHoraChile(v).slice(0, 10);
        break;
      case "fechahora":
        o[c.clave] = fechaHoraChile(v);
        break;
      case "numero":
      case "monto":
      case "dias":
        o[c.clave] = Number(v);
        break;
      case "estado":
        o[c.clave] = c.clave === "estado" && def.base === "ot" ? textoEstadoOt(String(v)) : textoCodigo(v);
        break;
      case "si_no":
        o[c.clave] = v ? "Sí" : "No";
        break;
      default:
        o[c.clave] = String(v);
    }
  }
  return o;
}

export function hojaInforme(def: InformeFijo, filas: Record<string, unknown>[], tot: Record<string, number>, filtros: object, truncado: boolean) {
  const cab = def.columnas.map((c) => c.titulo);
  const cuerpo: Celda[][] = filas.map((f) => def.columnas.map((c) => f[c.clave] as Celda));
  const pie: Celda[] = def.columnas.map((c, i) => (i === 0 ? `Total (${filas.length} filas)` : c.total ? tot[c.clave] : null));
  const nota = Object.entries(filtros)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  const extra: Celda[][] = [[]];
  if (def.legado.length) extra.push([`Reemplaza a: ${def.legado.join(", ")}`]);
  if (def.pedido) extra.push([`Pedido: ${def.pedido}`]);
  extra.push([`Filtros: ${nota || "sin filtros"}`]);
  if (truncado) extra.push([`Se muestran las primeras ${LIMITE_FILAS} filas: acote el período.`]);
  return {
    nombre: def.titulo.slice(0, 31),
    filas: [cab, ...cuerpo, pie, ...extra],
    autoFiltro: true,
    anchos: def.columnas.map((c) => (c.tipo === "texto" ? 28 : 14)),
  };
}

@Module({ controllers: [ZonaInformesController] })
export class ZonaInformesModule {}
