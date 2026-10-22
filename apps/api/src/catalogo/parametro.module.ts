import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { BaseCrudService } from "../common/base-crud.service";
import { BaseCrudController } from "../common/base-crud.controller";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import { CATEGORIAS_CON_HISTORIAL, defPorcentaje, erroresPorcentaje, leerPorcentaje, valorGuardado } from "./parametro-porcentaje";
import {
  GRUPOS_CONFIG,
  CATEGORIAS_CONFIGURABLES,
  codigoValido,
  conOpciones,
  defConfigurable,
  erroresMotivo,
  grupoDe,
  historialDeFila,
  laboratorioDe,
  normalizarValor,
  textoValor,
  valorFormulario,
  type DefValor,
} from "./parametro-configurable";
import { AlcanceService } from "../rbac/alcance.service";

/** Tipos de unidad que reciben muestras (códigos de laboratorio de los parámetros de recepción). */
const UNIDADES_RECEPCION = ["LABORATORIO", "SUCURSAL", "DELEGACION"];

const MSJ_CONFIGURABLE =
  "Este parámetro se cambia en «Parámetros de la operación» (Administración › Parámetros del sistema), con motivo: queda en el historial.";

/**
 * PARÁMETROS DE NEGOCIO (§5). Maestra genérica y editable de los combos que
 * antes estaban hardcodeados en el frontend (tipo_cliente, forma_pago,
 * prioridad, tipo_linea_costeo, tipo_inspeccion). Tabla `parametro_sistema`.
 */
@Injectable()
export class ParametroSistemaService extends BaseCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: "parametroSistema",
      search: ["categoria", "codigo", "etiqueta"],
      softDelete: false,
      // Orden natural del combo: por categoría y, dentro de ella, por `orden`.
      orderBy: [{ categoria: "asc" }, { orden: "asc" }],
    });
  }

  /** Porcentajes de la tasa de internación (bpch_tasa) con su historial de cambios. */
  async porcentajes(tenantId: string) {
    const categorias = CATEGORIAS_CON_HISTORIAL;
    const valores = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, categoria, codigo, etiqueta, valor, activo, updated_at AS "updatedAt"
         FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = ANY($2::text[]) ORDER BY categoria, orden`,
      tenantId,
      categorias,
    );
    const historial = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT h.id, h.categoria, h.codigo, h.valor_anterior AS "valorAnterior", h.valor_nuevo AS "valorNuevo",
              h.motivo, h.created_at AS "createdAt", u.nombre_completo AS "usuarioNombre"
         FROM parametro_sistema_historial h LEFT JOIN usuario u ON u.id = h.usuario_id
        WHERE h.tenant_id = $1::uuid AND h.categoria = ANY($2::text[])
        ORDER BY h.created_at DESC LIMIT 100`,
      tenantId,
      categorias,
    );
    return {
      valores: valores
        .filter((v) => defPorcentaje(v.categoria, v.codigo))
        .map((v) => ({ ...v, numero: v.valor == null ? null : Number(String(v.valor).replace(",", ".")) })),
      historial,
    };
  }

  /** Cambia un porcentaje con motivo; deja el valor anterior y el nuevo en el historial (una transacción). */
  async cambiarPorcentaje(tenantId: string, categoria: string, codigo: string, cuerpo: unknown, usuarioId: string | null) {
    const def = defPorcentaje(categoria, codigo);
    if (!def) throw new NotFoundException(`El parámetro ${categoria}.${codigo} no es un porcentaje configurable.`);
    const b = (cuerpo ?? {}) as { valor?: unknown; motivo?: unknown };
    const valor = leerPorcentaje(b.valor);
    const motivo = typeof b.motivo === "string" ? b.motivo.trim() : "";
    const errores = erroresPorcentaje(def, valor, motivo);
    if (errores.length) throw new BadRequestException(errores.join(" "));
    const nuevo = valorGuardado(valor);
    return this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRawUnsafe<{ id: string; valor: string | null }[]>(
        `SELECT id, valor FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = $2 AND codigo = $3 FOR UPDATE`,
        tenantId,
        categoria,
        codigo,
      );
      if (!filas[0]) throw new NotFoundException(`El parámetro ${categoria}.${codigo} no existe en esta instalación.`);
      const anterior = filas[0].valor;
      if (anterior != null && Number(String(anterior).replace(",", ".")) === valor)
        throw new ConflictException("El valor nuevo es igual al vigente: no hay nada que cambiar.");
      await tx.$executeRawUnsafe(`UPDATE parametro_sistema SET valor = $2, updated_at = now() WHERE id = $1::uuid`, filas[0].id, nuevo);
      await tx.$executeRawUnsafe(
        `INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid)`,
        tenantId,
        filas[0].id,
        categoria,
        codigo,
        anterior,
        nuevo,
        motivo,
        usuarioId,
      );
      return { id: filas[0].id, categoria, codigo, valorAnterior: anterior, valor: nuevo };
    });
  }

  /* ------------------------------------------- parámetros de la operación (R1) --- */

  /** Unidades que reciben muestras (laboratorios, sucursales y delegaciones), por código. */
  private laboratoriosRecepcion(tenantId: string) {
    return this.prisma.$queryRawUnsafe<{ codigo: string; nombre: string }[]>(
      `SELECT codigo, nombre FROM unidad WHERE tenant_id = $1::uuid AND tipo = ANY($2::text[]) AND activa IS NOT FALSE ORDER BY codigo`,
      tenantId,
      UNIDADES_RECEPCION,
    );
  }

  /**
   * Parámetros R1 con su valor tipado, el texto legible, el historial y las
   * unidades que reciben muestras (para dar de alta los de recepción).
   */
  async configurables(tenantId: string, puedeEditar: boolean) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, categoria, codigo, etiqueta, valor, activo, orden, updated_at AS "updatedAt"
         FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = ANY($2::text[])
        ORDER BY categoria, orden, codigo`,
      tenantId,
      CATEGORIAS_CONFIGURABLES,
    );
    const historial = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT h.id, h.categoria, h.codigo, h.valor_anterior AS "valorAnterior", h.valor_nuevo AS "valorNuevo",
              h.motivo, h.created_at AS "createdAt", u.nombre_completo AS "usuarioNombre"
         FROM parametro_sistema_historial h LEFT JOIN usuario u ON u.id = h.usuario_id
        WHERE h.tenant_id = $1::uuid AND h.categoria = ANY($2::text[])
        ORDER BY h.created_at DESC LIMIT 200`,
      tenantId,
      CATEGORIAS_CONFIGURABLES,
    );
    const laboratorios = await this.laboratoriosRecepcion(tenantId);
    const parametro = (defBase: DefValor, f: any, alta: string | null = null) => {
      // Opciones leídas de la base (p. ej. los laboratorios de la segregación revisión ≠ aprobación).
      const def = conOpciones(defBase, laboratorios);
      return {
      id: f.id as string,
      categoria: f.categoria as string,
      codigo: f.codigo as string,
      // Filas por patrón (campo, método, plantilla…): su etiqueta; producto obligatorio: el laboratorio.
      nombre: def.tipo === "obligatorio" ? (f.codigo as string) : alta ? (f.etiqueta as string) : def.nombre,
      def: {
        tipo: def.tipo,
        ayuda: def.ayuda ?? null,
        min: def.min ?? null,
        max: def.max ?? null,
        unidad: def.unidad ?? null,
        opciones: def.opciones ?? null,
        porDefecto: def.porDefecto ?? null,
        columnas: def.columnas ?? null,
        maxFilas: def.maxFilas ?? null,
      },
      valor: valorFormulario(def, f),
      texto: textoValor(def, def.tipo === "campo" ? f.valor : historialDeFila(def, f)),
      activo: f.activo as boolean,
      laboratorio: alta === "laboratorio" || alta === "campo" ? laboratorioDe(f.codigo) : null,
      updatedAt: f.updatedAt,
      };
    };
    const grupos = GRUPOS_CONFIG.map((g) => {
      const delGrupo = filas.filter((f) => f.categoria === g.categoria);
      const parametros = g.codigos
        ? Object.entries(g.codigos).map(([codigo, def]) => {
            const f = delGrupo.find((x) => x.codigo === codigo);
            return f ? parametro(def, f) : { codigo, nombre: def.nombre, falta: true };
          })
        : delGrupo.filter((f) => codigoValido(g.patron!.alta, f.codigo)).map((f) => parametro(g.patron!, f, g.patron!.alta));
      return { categoria: g.categoria, titulo: g.titulo, donde: g.donde, porConfirmar: g.porConfirmar ?? null, alta: g.patron?.alta ?? null, parametros };
    });
    return {
      puedeEditar,
      grupos,
      laboratorios,
      historial: historial.map((h) => {
        const def = defConfigurable(h.categoria, h.codigo);
        return {
          id: h.id,
          categoria: h.categoria,
          codigo: h.codigo,
          grupo: grupoDe(h.categoria)?.titulo ?? h.categoria,
          parametro: def ? (grupoDe(h.categoria)?.patron ? h.codigo : def.nombre) : h.codigo,
          antes: h.valorAnterior == null ? "(alta)" : def ? textoValor(def, h.valorAnterior) : h.valorAnterior,
          despues: def ? textoValor(def, h.valorNuevo) : h.valorNuevo,
          motivo: h.motivo,
          usuarioNombre: h.usuarioNombre,
          createdAt: h.createdAt,
        };
      }),
    };
  }

  /** Cambia el valor de un parámetro R1 con motivo; deja el antes y el después en el historial (una transacción). */
  async cambiarConfigurable(tenantId: string, categoria: string, codigo: string, cuerpo: unknown, usuarioId: string | null) {
    const defBase = defConfigurable(categoria, codigo);
    if (!defBase) throw new NotFoundException(`El parámetro ${categoria}.${codigo} no se configura desde esta pantalla.`);
    // Las opciones dinámicas se validan contra la base (solo laboratorios que existen).
    const def = defBase.opcionesDe ? conOpciones(defBase, await this.laboratoriosRecepcion(tenantId)) : defBase;
    const b = (cuerpo ?? {}) as { valor?: unknown; motivo?: unknown };
    const errMotivo = erroresMotivo(b.motivo);
    return this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRawUnsafe<{ id: string; etiqueta: string; valor: string | null; activo: boolean }[]>(
        `SELECT id, etiqueta, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = $2 AND codigo = $3 FOR UPDATE`,
        tenantId,
        categoria,
        codigo,
      );
      const fila = filas[0];
      if (!fila) throw new NotFoundException(`El parámetro ${categoria}.${codigo} no existe en esta instalación.`);
      const r = normalizarValor(def, { codigo, etiqueta: fila.etiqueta }, b.valor, categoria);
      const errores = [...r.errores, ...errMotivo];
      if (errores.length || !r.valor) throw new BadRequestException(errores.join(" "));
      const anterior = historialDeFila(def, { codigo, valor: fila.valor, activo: fila.activo });
      if (anterior === r.valor.historial) throw new ConflictException("El valor nuevo es igual al vigente: no hay nada que cambiar.");
      await tx.$executeRawUnsafe(
        `UPDATE parametro_sistema SET valor = CASE WHEN $2::boolean THEN $3 ELSE valor END, activo = $4::boolean, updated_at = now() WHERE id = $1::uuid`,
        fila.id,
        r.valor.valor !== undefined,
        r.valor.valor ?? null,
        r.valor.activo,
      );
      await this.registrarCambio(tx, tenantId, fila.id, categoria, codigo, anterior, r.valor.historial, String(b.motivo).trim(), usuarioId);
      return { id: fila.id, categoria, codigo, antes: textoValor(def, anterior), despues: textoValor(def, r.valor.historial) };
    });
  }

  /**
   * Alta de un «producto obligatorio» por laboratorio o de un campo propio de
   * la recepción: { laboratorio, campo?, etiqueta?, valor, motivo }.
   */
  async altaConfigurable(tenantId: string, categoria: string, cuerpo: unknown, usuarioId: string | null) {
    const g = grupoDe(categoria);
    if (!g?.patron) throw new NotFoundException(`En ${categoria} no se dan de alta parámetros desde esta pantalla.`);
    const patron = g.patron;
    const b = (cuerpo ?? {}) as { laboratorio?: unknown; campo?: unknown; etiqueta?: unknown; valor?: unknown; motivo?: unknown; codigo?: unknown };
    const lab = typeof b.laboratorio === "string" ? b.laboratorio.trim().toUpperCase() : "";
    const errores: string[] = [];
    const porLaboratorio = patron.alta === "laboratorio" || patron.alta === "campo";
    const existe = porLaboratorio && lab
      ? await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
          `SELECT codigo FROM unidad WHERE tenant_id = $1::uuid AND upper(codigo) = $2 AND tipo = ANY($3::text[]) LIMIT 1`,
          tenantId,
          lab,
          UNIDADES_RECEPCION,
        )
      : [];
    if (porLaboratorio && !existe.length) errores.push("Elija un laboratorio (o sucursal) que reciba muestras.");
    let codigo = lab;
    let etiqueta = `${lab} · ${patron.nombre.charAt(0).toLowerCase()}${patron.nombre.slice(1)}`;
    if (patron.alta === "metodo") {
      // Un método del catálogo (por su código): la variante rige para sus ensayos.
      codigo = typeof b.codigo === "string" ? b.codigo.trim().toUpperCase() : "";
      const m = codigo
        ? await this.prisma.$queryRawUnsafe<{ codigo: string; nombre: string }[]>(
            `SELECT codigo, nombre FROM cat_metodo WHERE tenant_id = $1::uuid AND upper(codigo) = $2 AND deleted_at IS NULL LIMIT 1`,
            tenantId,
            codigo,
          )
        : [];
      if (!m.length) errores.push("Indique el código de un método del catálogo.");
      else etiqueta = `${m[0].codigo} · ${m[0].nombre}`.slice(0, 160);
    }
    if (patron.alta === "plantilla") {
      codigo = typeof b.codigo === "string" ? b.codigo.trim().toUpperCase() : "";
      if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(codigo)) errores.push("El código de la plantilla va en mayúsculas, sin espacios (p. ej. REMOLQUE).");
      etiqueta = typeof b.etiqueta === "string" ? b.etiqueta.trim() : "";
      if (!etiqueta || etiqueta.length > 160) errores.push("Escriba el nombre visible de la plantilla (hasta 160 caracteres).");
    }
    if (patron.alta === "campo") {
      const campo = typeof b.campo === "string" ? b.campo.trim() : "";
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(campo)) errores.push("El código del campo va en minúsculas, sin espacios ni tildes (p. ej. lote_proveedor).");
      codigo = `${lab}.${campo}`;
      etiqueta = typeof b.etiqueta === "string" ? b.etiqueta.trim() : "";
      if (!etiqueta || etiqueta.length > 160) errores.push("Escriba el nombre visible del campo (hasta 160 caracteres).");
    }
    if (errores.length === 0 && !codigoValido(patron.alta, codigo)) errores.push("Código no válido.");
    const r = errores.length ? null : normalizarValor(patron, { codigo, etiqueta }, b.valor, categoria);
    errores.push(...(r?.errores ?? []), ...erroresMotivo(b.motivo));
    if (errores.length || !r?.valor) throw new BadRequestException(errores.join(" "));
    const nuevo = r.valor;
    return this.prisma.$transaction(async (tx) => {
      const ins = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, valor, orden, activo)
         SELECT $1::uuid, $2, $3, $4, $5,
                COALESCE((SELECT max(orden) FROM parametro_sistema
                           WHERE tenant_id = $1::uuid AND categoria = $2 AND split_part(codigo, '.', 1) = $6), 0) + 1,
                $7::boolean
         ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING RETURNING id`,
        tenantId,
        categoria,
        codigo,
        etiqueta,
        nuevo.valor ?? null,
        lab,
        nuevo.activo,
      );
      if (!ins[0]) throw new ConflictException(`Ya existe ${codigo}: cámbielo en su fila.`);
      await this.registrarCambio(tx, tenantId, ins[0].id, categoria, codigo, null, nuevo.historial, String(b.motivo).trim(), usuarioId);
      return { id: ins[0].id, categoria, codigo, despues: textoValor(patron, nuevo.historial) };
    });
  }

  private registrarCambio(
    tx: any,
    tenantId: string,
    parametroId: string,
    categoria: string,
    codigo: string,
    anterior: string | null,
    nuevo: string,
    motivo: string,
    usuarioId: string | null,
  ) {
    return tx.$executeRawUnsafe(
      `INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid)`,
      tenantId,
      parametroId,
      categoria,
      codigo,
      anterior,
      nuevo,
      motivo,
      usuarioId,
    );
  }
}

const ParametroCreate = z.object({
  categoria: z.string().min(1).max(60),
  codigo: z.string().min(1).max(60),
  etiqueta: z.string().min(1).max(160),
  // El form envía `orden` como número (input number) o lo omite.
  orden: z.coerce.number().int().default(0),
  activo: z.boolean().default(true),
  // Dato técnico del código (regla de validez del tipo de cliente, número de días…).
  valor: z.string().max(4000).nullable().optional(),
});

/** Tenant del usuario autenticado (lo inyecta JwtStrategy en req.user). */
function tenantDe(req: any): string | undefined {
  return req?.user?.tenantId;
}

/**
 * CRUD de parámetros de negocio.
 *
 * GET (listar/detalle) NO declara permiso `ver`: es de lectura interna para
 * cualquier usuario autenticado, porque los formularios de negocio (p. ej. el
 * alta de clientes, que gestionan roles comerciales sin `catalogo.gestionar`)
 * necesitan leer sus combos. La ESCRITURA sí exige `catalogo.gestionar`.
 *
 * `?categoria=` filtra un combo concreto (lo usan los formularios); `?activo=true`
 * devuelve solo los valores ofrecibles. Sin filtros, lista todo (pantalla de
 * gestión /catalogo/parametros).
 */
@ApiTags("parametros")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("parametros")
@RequierePermisoCrud({
  crear: "catalogo.gestionar",
  editar: "catalogo.gestionar",
  eliminar: "catalogo.gestionar",
})
export class ParametroSistemaController extends BaseCrudController {
  protected createSchema = ParametroCreate;
  protected updateSchema = ParametroCreate.partial();
  constructor(protected svc: ParametroSistemaService) {
    super();
  }

  /**
   * Sobrescribe el listar heredado para admitir los filtros `categoria` y
   * `activo`, que BaseCrudController no contempla.
   */
  @Get()
  @ApiOperation({ summary: "Lista parámetros; filtra por ?categoria= y ?activo=true" })
  override listar(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Query("categoria") categoria?: string,
    @Query("activo") activo?: string,
    @Req() req?: any,
  ) {
    const where: Record<string, unknown> = {};
    if (categoria) where.categoria = categoria;
    if (activo === "true") where.activo = true;
    return this.svc.listar(
      { page: parseInt(page), limit: parseInt(limit), search, where },
      tenantDe(req),
    );
  }

  /** Alta genérica: no en los parámetros de la operación (se dan de alta con motivo en su recuadro). */
  @Post()
  override async crear(@Body() body: unknown, @Req() req: any) {
    const dto = ParametroCreate.parse(body);
    if (protegido(dto.categoria, dto.codigo))
      throw new ConflictException(MSJ_CONFIGURABLE);
    return this.svc.crear(dto, tenantDe(req));
  }

  /**
   * El valor de un porcentaje con historial solo cambia por PUT porcentajes/… y
   * el de un parámetro de la operación por PUT configurables/… (con motivo).
   * Aquí solo se cambian su etiqueta y su orden.
   */
  @Patch(":id")
  override async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ParametroCreate.partial().parse(body);
    const actual: any = await this.svc.detalle(id, tenantDe(req));
    const cambiaClave =
      (dto.categoria !== undefined && dto.categoria !== actual.categoria) || (dto.codigo !== undefined && dto.codigo !== actual.codigo);
    if (CATEGORIAS_CON_HISTORIAL.includes(actual.categoria)) {
      if (cambiaClave || (dto.valor !== undefined && dto.valor !== actual.valor) || dto.activo === false)
        throw new ConflictException("Este porcentaje se cambia en «Porcentajes de la tasa de internación», con motivo: queda en el historial.");
    }
    if (protegido(actual.categoria, actual.codigo)) {
      if (cambiaClave || (dto.valor !== undefined && dto.valor !== actual.valor) || (dto.activo !== undefined && dto.activo !== actual.activo))
        throw new ConflictException(MSJ_CONFIGURABLE);
    } else if (cambiaClave && protegido(dto.categoria ?? actual.categoria, dto.codigo ?? actual.codigo)) {
      throw new ConflictException(MSJ_CONFIGURABLE);
    }
    return this.svc.actualizar(id, dto, tenantDe(req));
  }

  @Delete(":id")
  override async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const actual: any = await this.svc.detalle(id, tenantDe(req));
    if (CATEGORIAS_CON_HISTORIAL.includes(actual.categoria))
      throw new ConflictException("Los porcentajes de la tasa de internación no se borran: el cálculo de la tasa los necesita.");
    if (protegido(actual.categoria, actual.codigo))
      throw new ConflictException("Los parámetros de la operación no se borran: desactívelos (o cambie su valor) con motivo en «Parámetros de la operación».");
    return this.svc.eliminar(id, tenantDe(req));
  }
}

/** ¿El valor de (categoría, código) solo se cambia con motivo desde «Parámetros de la operación»? */
function protegido(categoria: string, codigo: string): boolean {
  return defConfigurable(categoria, codigo) !== null || !!grupoDe(categoria)?.patron;
}

/**
 * Porcentajes de la tasa de internación y del IVA (bpch_tasa). Controlador
 * PROPIO declarado antes del CRUD para que `porcentajes` gane a `@Get(":id")`.
 * Leen quien configura (catalogo.gestionar) y quien trabaja con internaciones
 * (bpch.internacion.ver); cambia solo catalogo.gestionar, con motivo.
 */
@ApiTags("parametros")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("parametros")
export class ParametroPorcentajeController {
  constructor(
    private readonly svc: ParametroSistemaService,
    private readonly alcance: AlcanceService,
  ) {}

  /**
   * Parámetros de la operación (R1): circuito y numeración de la cotización,
   * encuestas, cierre de Metrología, recepción y equipo en la captura. Los lee
   * quien administra parámetros (catalogo.gestionar); los cambia solo quien lo
   * tiene con alcance GLOBAL (Calidad, Administración), igual que el resto de
   * las tablas comunes (AlcanceCatalogoGuard). `puedeEditar` lo dice a la pantalla.
   */
  @Get("configurables")
  @ApiOperation({ summary: "Parámetros de la operación (R1) con su valor tipado y su historial" })
  async configurables(@Req() req: any) {
    exigirAlguno(req, ["catalogo.gestionar"]);
    const alc = await this.alcance.alcancePermisos(req, ["catalogo.gestionar"]);
    return this.svc.configurables(tenantDe(req) ?? "", alc.esGlobal);
  }

  /** { valor, motivo } · el tipo de `valor` depende del parámetro (número, sí/no, opción, lista, campo). */
  @Put("configurables/:categoria/:codigo")
  @RequierePermiso("catalogo.gestionar")
  @ApiOperation({ summary: "Cambia un parámetro de la operación con motivo; queda en el historial" })
  cambiarConfigurable(@Param("categoria") categoria: string, @Param("codigo") codigo: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.cambiarConfigurable(tenantDe(req) ?? "", categoria, codigo, body, req?.user?.sub ?? null);
  }

  /** { laboratorio, campo?, etiqueta?, valor, motivo } · producto obligatorio por laboratorio o campo de recepción. */
  @Post("configurables/:categoria")
  @RequierePermiso("catalogo.gestionar")
  @ApiOperation({ summary: "Da de alta un parámetro de recepción por laboratorio, con motivo" })
  altaConfigurable(@Param("categoria") categoria: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.altaConfigurable(tenantDe(req) ?? "", categoria, body, req?.user?.sub ?? null);
  }

  @Get("porcentajes")
  @ApiOperation({ summary: "Porcentajes de la tasa de internación (bpch_tasa) y su historial" })
  async porcentajes(@Req() req: any) {
    exigirAlguno(req, ["catalogo.gestionar", "bpch.internacion.ver"]);
    // Los cambia quien tiene catalogo.gestionar con alcance global (AlcanceCatalogoGuard).
    const puedeEditar = tiene(req, "catalogo.gestionar") && (await this.alcance.alcancePermisos(req, ["catalogo.gestionar"])).esGlobal;
    return { ...(await this.svc.porcentajes(tenantDe(req) ?? "")), puedeEditar };
  }

  /** { valor: "1,5", motivo } · 0–100, coma o punto decimal, hasta 4 decimales. */
  @Put("porcentajes/:categoria/:codigo")
  @RequierePermiso("catalogo.gestionar")
  @ApiOperation({ summary: "Cambia un porcentaje con motivo; queda en el historial" })
  cambiar(@Param("categoria") categoria: string, @Param("codigo") codigo: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.cambiarPorcentaje(tenantDe(req) ?? "", categoria, codigo, body, req?.user?.sub ?? null);
  }
}

/** ¿Tiene el permiso? (SUPERADMIN siempre). */
function tiene(req: any, permiso: string): boolean {
  return (req?.user?.roles ?? []).includes("SUPERADMIN") || (req?.user?.permisos ?? []).includes(permiso);
}

/** Exige al menos uno de los permisos (SUPERADMIN pasa siempre). */
function exigirAlguno(req: any, permisos: string[]) {
  if ((req?.user?.roles ?? []).includes("SUPERADMIN")) return;
  const tiene: string[] = req?.user?.permisos ?? [];
  if (!permisos.some((p) => tiene.includes(p)))
    throw new ForbiddenException(`Permiso insuficiente. Requiere uno de: ${permisos.join(", ")}`);
}

@Module({
  // El de porcentajes va ANTES que el CRUD para que «porcentajes» gane a `@Get(":id")`.
  controllers: [ParametroPorcentajeController, ParametroSistemaController],
  providers: [ParametroSistemaService],
})
export class ParametroModule {}
