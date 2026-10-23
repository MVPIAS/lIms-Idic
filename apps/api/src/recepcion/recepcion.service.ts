import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { AlcanceService } from "../rbac/alcance.service";
import {
  CLASES_CUSTODIA,
  NOMBRE_CLASE,
  camposDeLaboratorio,
  estadoRetencion,
  hoyIso,
  inicioNumeracion,
  origenBandeja,
  plazosRetencion,
  semaforoPlazo,
  validarCamposLaboratorio,
  type CampoRecepcion,
  type ClaseCustodia,
  type EntradaRecepcionLab,
} from "./reglas-recepcion";

type Db = PrismaService | Prisma.TransactionClient;

/**
 * B-011: el elemento genérico de cada laboratorio del catálogo heredado («Lab.
 * Quimico Central», «Lab.Textil»…, subgrupo «Sub Grupo IDIC») no es un producto
 * (matriz): no se ofrece en la recepción (ot/alta-muestras.ts).
 */
const NO_GENERICO = `NOT EXISTS (SELECT 1 FROM cat_subgrupo sg WHERE sg.id = e.subgrupo_id AND lower(trim(sg.nombre)) = 'sub grupo idic')`;

/** familia del catálogo (CODSUCDEL) contenida en el codsucdel de la unidad («3009/3008»). */
const FAMILIA_DE_UNIDAD = `f.codsucdel = ANY(string_to_array(regexp_replace(COALESCE(u.codsucdel, ''), '[\\s,;]', '/', 'g'), '/'))`;

export interface ConfigRecepcionLab {
  laboratorio: { id: string; codigo: string; nombre: string } | null;
  productoObligatorio: boolean;
  campos: CampoRecepcion[];
  clases: { valor: ClaseCustodia; etiqueta: string }[];
  plazos: Partial<Record<ClaseCustodia, number>>;
}

export interface ProductoLab {
  id: string;
  codigo: string;
  nombre: string;
  /** Nombre del elemento en el catálogo (si difiere del que muestra el laboratorio). */
  nombreCatalogo: string;
  metodos: number;
  delLaboratorio: boolean;
}

/**
 * Recepción y custodia de la muestra (frente r1d): configuración por
 * laboratorio, productos (matriz), Nº de muestra interno, bandeja de entrada del
 * laboratorio y retenciones. Reglas puras: reglas-recepcion.ts.
 */
@Injectable()
export class RecepcionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  /** OT del tenant dentro del alcance del usuario para el permiso indicado (404 / 403). */
  async otEnAlcance(otId: string, tenantId: string, req: any, permiso: string) {
    const ot = await this.prisma.ordenTrabajo.findFirst({ where: { id: otId, tenantId } });
    if (!ot) throw new NotFoundException(`Orden de trabajo ${otId} no encontrada`);
    await this.alcance.exigirUnidad(req, ot.unidadPrincipal, `la OT ${ot.codigo}`, permiso);
    return ot;
  }

  /** Muestra del tenant, con su OT, dentro del alcance (404 / 403). */
  async muestraEnAlcance(muestraId: string, tenantId: string, req: any, permiso: string) {
    const m = await this.prisma.muestra.findFirst({ where: { id: muestraId, tenantId, deletedAt: null } });
    if (!m) throw new NotFoundException(`Muestra ${muestraId} no encontrada`);
    const ot = m.otId ? await this.prisma.ordenTrabajo.findFirst({ where: { id: m.otId, tenantId } }) : null;
    await this.alcance.exigirUnidad(req, ot?.unidadPrincipal ?? null, `la muestra ${m.codigo}`, permiso);
    return { muestra: m, ot };
  }

  private async parametros(tenantId: string, categoria: string, db: Db = this.prisma) {
    return db.$queryRawUnsafe<{ codigo: string; etiqueta: string; orden: number; valor: string | null; activo: boolean }[]>(
      `SELECT codigo, etiqueta, orden, valor, activo FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND categoria = $2 ORDER BY orden, codigo`,
      tenantId,
      categoria,
    );
  }

  /** Configuración de la recepción del laboratorio responsable de la OT. */
  async configDeUnidad(tenantId: string, unidadId: string | null, db: Db = this.prisma): Promise<ConfigRecepcionLab> {
    const unidad = unidadId
      ? (await db.$queryRawUnsafe<{ id: string; codigo: string; nombre: string }[]>(
          `SELECT id, codigo, nombre FROM unidad WHERE id = $1::uuid AND tenant_id = $2::uuid`,
          unidadId,
          tenantId,
        ))[0] ?? null
      : null;
    const [campos, obligatorio, retencion] = await Promise.all([
      this.parametros(tenantId, "recepcion_campo", db),
      this.parametros(tenantId, "recepcion_producto_obligatorio", db),
      this.parametros(tenantId, "retencion_muestra", db),
    ]);
    const codigo = unidad?.codigo ?? null;
    return {
      laboratorio: unidad,
      productoObligatorio: !!codigo && obligatorio.some((p) => p.activo && p.codigo.toUpperCase() === codigo.toUpperCase()),
      campos: camposDeLaboratorio(campos, codigo),
      clases: CLASES_CUSTODIA.map((c) => ({ valor: c, etiqueta: NOMBRE_CLASE[c] })),
      plazos: plazosRetencion(retencion),
    };
  }

  /** Valida los campos propios del laboratorio (lista de errores + valor normalizado). */
  validarCampos(config: ConfigRecepcionLab, entrada: EntradaRecepcionLab, prefijo = "") {
    return validarCamposLaboratorio(config.campos, entrada, config.laboratorio?.codigo ?? "laboratorio", prefijo);
  }

  /** El producto (cat_elemento) existe y está vigente en el tenant. */
  async productoValido(tenantId: string, elementoId: string, db: Db = this.prisma): Promise<boolean> {
    const f = await db.$queryRawUnsafe<{ ok: number }[]>(
      `SELECT 1 AS ok FROM cat_elemento WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL AND activo`,
      elementoId,
      tenantId,
    );
    return f.length > 0;
  }

  /* ------------------------------------------------------------ productos --- */

  /**
   * Productos (matriz) que se ofrecen al recepcionar en el laboratorio de la OT:
   * la lista configurada para el laboratorio (categoría producto_lab) o, si no
   * tiene, los elementos de su familia del catálogo. Con `search`, además, los
   * elementos del catálogo que coinciden (para un producto fuera de la lista).
   */
  async productos(otId: string, tenantId: string, req: any, search?: string) {
    const ot = await this.otEnAlcance(otId, tenantId, req, "muestra.ver");
    const unidad = ot.unidadPrincipal
      ? (await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(`SELECT codigo FROM unidad WHERE id = $1::uuid`, ot.unidadPrincipal))[0]
      : null;
    const conMetodos = `(SELECT count(*) FROM cat_panel p WHERE p.elemento_id = e.id AND p.deleted_at IS NULL AND p.activo)::int`;
    let propios: ProductoLab[] = [];
    if (unidad) {
      propios = await this.prisma.$queryRawUnsafe<ProductoLab[]>(
        `SELECT e.id, e.codigo, ps.etiqueta AS nombre, e.nombre AS "nombreCatalogo", ${conMetodos} AS metodos, TRUE AS "delLaboratorio"
           FROM parametro_sistema ps
           JOIN cat_elemento e ON e.tenant_id = ps.tenant_id AND e.codigo = ps.valor AND e.deleted_at IS NULL AND e.activo
          WHERE ps.tenant_id = $1::uuid AND ps.categoria = 'producto_lab' AND ps.activo
            AND upper(ps.codigo) LIKE upper($2) || '.%'
          ORDER BY ps.orden, ps.etiqueta`,
        tenantId,
        unidad.codigo,
      );
      if (!propios.length)
        propios = await this.prisma.$queryRawUnsafe<ProductoLab[]>(
          `SELECT e.id, e.codigo, e.nombre, e.nombre AS "nombreCatalogo", ${conMetodos} AS metodos, TRUE AS "delLaboratorio"
             FROM cat_elemento e
             JOIN cat_familia f ON f.id = e.familia_id
             JOIN unidad u ON u.id = $2::uuid AND ${FAMILIA_DE_UNIDAD}
            WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL AND e.activo AND ${NO_GENERICO}
            ORDER BY e.nombre LIMIT 100`,
          tenantId,
          ot.unidadPrincipal,
        );
    }
    const q = (search ?? "").trim();
    const encontrados =
      q.length >= 2
        ? await this.prisma.$queryRawUnsafe<ProductoLab[]>(
            `SELECT e.id, e.codigo, e.nombre, e.nombre AS "nombreCatalogo", ${conMetodos} AS metodos, FALSE AS "delLaboratorio"
               FROM cat_elemento e
              WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL AND e.activo AND ${NO_GENERICO}
                AND (e.nombre ILIKE '%' || $2 || '%' OR e.codigo ILIKE $2 || '%')
              ORDER BY (e.nombre ILIKE $2 || '%') DESC, e.nombre LIMIT 20`,
            tenantId,
            q.slice(0, 60),
          )
        : [];
    const ids = new Set(propios.map((p) => p.id));
    return {
      laboratorio: unidad?.codigo ?? null,
      // B-011: el laboratorio aún no tiene su lista de productos (categoría producto_lab): la pantalla lo dice.
      sinLista: !!unidad && !propios.length,
      productos: propios.map((p) => ({ ...p, metodos: Number(p.metodos) })),
      encontrados: encontrados.filter((e) => !ids.has(e.id)).map((p) => ({ ...p, metodos: Number(p.metodos) })),
    };
  }

  /**
   * B-012: productos con panel propio del laboratorio de un elemento genérico
   * («Lab. Materiales Energéticos» → Nitrato de amonio, Nitrocelulosa…, lista
   * producto_lab). «Registrar OT» los ofrece al elegir el elemento del
   * laboratorio, para que el panel venga del producto y no del elemento
   * genérico: un único panel por producto, el mismo que en la recepción.
   */
  async productosDeElemento(tenantId: string, elementoId: string) {
    const filas = await this.prisma.$queryRawUnsafe<{ id: string; codigo: string; nombre: string; metodos: number; laboratorio: string }[]>(
      `SELECT pe.id, pe.codigo, ps.etiqueta AS nombre, u.codigo AS laboratorio,
              (SELECT count(*) FROM cat_panel p WHERE p.elemento_id = pe.id AND p.deleted_at IS NULL AND p.activo)::int AS metodos
         FROM cat_elemento e
         JOIN cat_familia f ON f.id = e.familia_id
         JOIN unidad u ON u.tenant_id = e.tenant_id AND ${FAMILIA_DE_UNIDAD}
         JOIN parametro_sistema ps ON ps.tenant_id = e.tenant_id AND ps.categoria = 'producto_lab' AND ps.activo
                                  AND upper(ps.codigo) LIKE upper(u.codigo) || '.%'
         JOIN cat_elemento pe ON pe.tenant_id = e.tenant_id AND pe.codigo = ps.valor AND pe.deleted_at IS NULL AND pe.activo
        WHERE e.id = $1::uuid AND e.tenant_id = $2::uuid
        ORDER BY ps.orden, ps.etiqueta`,
      elementoId,
      tenantId,
    );
    return { productos: filas.map((f) => ({ ...f, metodos: Number(f.metodos) })) };
  }

  /** Métodos del panel del producto (cat_panel), con su nº de analitos: «carga el panel». */
  async panel(otId: string, elementoId: string, tenantId: string, req: any) {
    await this.otEnAlcance(otId, tenantId, req, "muestra.ver");
    if (!(await this.productoValido(tenantId, elementoId))) throw new NotFoundException("Producto no encontrado en el catálogo");
    const metodos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.nombre, m.norma, m.ensayo_id AS "ensayoId",
              (SELECT count(*) FROM cat_analito a WHERE a.metodo_id = m.id AND a.deleted_at IS NULL AND a.activo)::int AS analitos
         FROM cat_panel p JOIN cat_metodo m ON m.id = p.metodo_id
        WHERE p.elemento_id = $1::uuid AND p.tenant_id = $2::uuid AND p.deleted_at IS NULL AND p.activo
          AND m.deleted_at IS NULL AND m.activo
        ORDER BY p.orden NULLS LAST, m.nombre`,
      elementoId,
      tenantId,
    );
    return { elementoId, metodos: metodos.map((m) => ({ ...m, analitos: Number(m.analitos) })) };
  }

  /** Clientes del maestro para identificar la muestra (solo id y nombre). */
  async clientes(tenantId: string, search?: string) {
    const q = (search ?? "").trim().slice(0, 60);
    return this.prisma.$queryRawUnsafe<{ id: string; razonSocial: string; nombreFantasia: string | null }[]>(
      `SELECT id, razon_social AS "razonSocial", nombre_fantasia AS "nombreFantasia"
         FROM cliente
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL
          AND ($2 = '' OR razon_social ILIKE '%' || $2 || '%' OR nombre_fantasia ILIKE '%' || $2 || '%')
        ORDER BY razon_social LIMIT 30`,
      tenantId,
      q,
    );
  }

  async clienteValido(tenantId: string, clienteId: string, db: Db = this.prisma): Promise<boolean> {
    const f = await db.$queryRawUnsafe<{ ok: number }[]>(
      `SELECT 1 AS ok FROM cliente WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      clienteId,
      tenantId,
    );
    return f.length > 0;
  }

  /* ------------------------------------------------------- número interno --- */

  /** Siguiente Nº interno: atómico (UPDATE … RETURNING sobre la fila del tenant). */
  private async siguienteNumero(db: Db, tenantId: string): Promise<bigint> {
    const inicio = inicioNumeracion((await this.parametros(tenantId, "numeracion_muestra", db)).find((p) => p.codigo === "inicio")?.valor);
    await db.$executeRawUnsafe(
      `INSERT INTO correlativo_muestra (tenant_id, ultimo) VALUES ($1::uuid, 0) ON CONFLICT (tenant_id) DO NOTHING`,
      tenantId,
    );
    const r = await db.$queryRawUnsafe<{ ultimo: bigint }[]>(
      `UPDATE correlativo_muestra
          SET ultimo = GREATEST(ultimo, $2::bigint - 1,
                                (SELECT COALESCE(max(numero_interno), 0) FROM muestra WHERE tenant_id = $1::uuid)) + 1,
              updated_at = now()
        WHERE tenant_id = $1::uuid
      RETURNING ultimo`,
      tenantId,
      inicio,
    );
    return BigInt(r[0].ultimo);
  }

  /** Asigna el Nº de muestra interno (una vez; no cambia). 409 si ya lo tiene. */
  async asignarNumero(muestraId: string, tenantId: string, req: any) {
    const { muestra, ot } = await this.muestraEnAlcance(muestraId, tenantId, req, "muestra.crear");
    if (ot && ["cerrada", "anulada"].includes(ot.estado))
      throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}: no se asignan números a sus muestras.`);
    return this.prisma.$transaction(async (tx) => {
      const fila = await tx.$queryRawUnsafe<{ numero_interno: bigint | null }[]>(
        `SELECT numero_interno FROM muestra WHERE id = $1::uuid FOR UPDATE`,
        muestraId,
      );
      if (fila[0]?.numero_interno != null)
        throw new ConflictException(`La muestra ${muestra.codigo} ya tiene el Nº interno ${fila[0].numero_interno}: no se cambia.`);
      const numero = await this.siguienteNumero(tx, tenantId);
      await tx.$executeRawUnsafe(
        `UPDATE muestra SET numero_interno = $2, numero_interno_por = $3::uuid, numero_interno_at = now() WHERE id = $1::uuid`,
        muestraId,
        numero,
        req?.user?.sub ?? null,
      );
      if (ot)
        await tx.$executeRawUnsafe(
          `INSERT INTO ot_historial (tenant_id, ot_id, tipo, detalle, usuario_id)
           VALUES ($1::uuid, $2::uuid, 'numero_muestra', $3::jsonb, $4::uuid)`,
          tenantId,
          ot.id,
          JSON.stringify({ muestra: muestra.codigo, numeroInterno: numero.toString() }),
          req?.user?.sub ?? null,
        );
      return { muestraId, codigo: muestra.codigo, numeroInterno: numero.toString() };
    });
  }

  /** Asigna el Nº interno a todas las muestras de la OT que aún no lo tienen. */
  async asignarNumerosOt(otId: string, tenantId: string, req: any) {
    const ot = await this.otEnAlcance(otId, tenantId, req, "muestra.crear");
    if (["cerrada", "anulada"].includes(ot.estado))
      throw new ConflictException(`La OT ${ot.codigo} está ${ot.estado}: no se asignan números a sus muestras.`);
    const sin = await this.prisma.muestra.findMany({
      where: { otId, tenantId, deletedAt: null, numeroInterno: null },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { codigo: "asc" }],
    });
    const asignados = [];
    for (const m of sin) asignados.push(await this.asignarNumero(m.id, tenantId, req));
    return { otId, asignados };
  }

  /* --------------------------------------------------------------- bandeja --- */

  /**
   * Bandeja de entrada del laboratorio (EP-01 §1.2; LME 20-10-2026): lo que el
   * laboratorio tiene por recepcionar, con su origen (DCO / OT interna / BPCH),
   * quién lo pide, el producto y el semáforo del plazo.
   *   · OT del laboratorio (en el alcance) abiertas, sin muestras o con alguna
   *     muestra con la recepción incompleta.
   *   · Órdenes internas dirigidas al laboratorio que aún no se reciben.
   */
  async bandeja(tenantId: string, req: any) {
    const unidades = await this.alcance.filtroUnidades(req, "muestra.crear");
    const hoy = hoyIso();
    const ots = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.codigo, o.origen_trabajo AS origen, o.tipo_trabajo AS "tipoTrabajo", o.estado,
              o.fecha_compromiso AS "fechaCompromiso", o.created_at AS "creadaAt",
              u.id AS "unidadId", u.codigo AS laboratorio,
              c.razon_social AS cliente,
              COALESCE(el.nombre, o.elemento_generico,
                       (SELECT string_agg(DISTINCT e2.nombre, ', ') FROM muestra m2 JOIN cat_elemento e2 ON e2.id = m2.cat_elemento_id
                         WHERE m2.ot_id = o.id AND m2.deleted_at IS NULL)) AS producto,
              (SELECT count(*) FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL)::int AS muestras,
              (SELECT count(*) FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL
                  AND (m.toma_muestra IS NULL OR m.condicion_recepcion IS NULL))::int AS incompletas,
              (SELECT count(*) FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL AND m.numero_interno IS NULL)::int AS "sinNumero"
         FROM orden_trabajo o
         LEFT JOIN unidad u ON u.id = o.unidad_principal
         LEFT JOIN cliente c ON c.id = o.cliente_id
         LEFT JOIN cat_elemento el ON el.id = o.cat_elemento_id
        WHERE o.tenant_id = $1::uuid
          AND o.estado NOT IN ('cerrada', 'anulada')
          AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))
          AND (NOT EXISTS (SELECT 1 FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL)
               OR EXISTS (SELECT 1 FROM muestra m WHERE m.ot_id = o.id AND m.deleted_at IS NULL
                            AND (m.toma_muestra IS NULL OR m.condicion_recepcion IS NULL)))
        ORDER BY o.fecha_compromiso NULLS LAST, o.created_at
        LIMIT 300`,
      tenantId,
      unidades,
    );
    const internas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT oi.id, oi.numero, oi.estado, oi.detalle, oi.created_at AS "creadaAt",
              o.id AS "otId", o.codigo AS "otCodigo", o.fecha_compromiso AS "fechaCompromiso",
              ud.id AS "unidadId", ud.codigo AS laboratorio,
              COALESCE(uo.codigo, fo.nombre) AS "pide",
              COALESCE(el.nombre, o.elemento_generico) AS producto
         FROM orden_interna oi
         JOIN orden_trabajo o ON o.id = oi.ot_id
         JOIN cat_familia f ON f.id = oi.destino_lab
         JOIN unidad ud ON ud.tenant_id = oi.tenant_id AND ud.codsucdel = f.codsucdel
         LEFT JOIN cat_familia fo ON fo.id = oi.origen_lab
         LEFT JOIN unidad uo ON uo.id = o.unidad_principal
         LEFT JOIN cat_elemento el ON el.id = o.cat_elemento_id
        WHERE oi.tenant_id = $1::uuid AND oi.deleted_at IS NULL AND oi.estado = 'abierta'
          AND ($2::uuid[] IS NULL OR ud.id = ANY($2::uuid[]))
        ORDER BY o.fecha_compromiso NULLS LAST, oi.created_at
        LIMIT 300`,
      tenantId,
      unidades,
    );
    const fecha = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
    const filas = [
      ...ots.map((o) => ({
        tipo: "ot" as const,
        id: o.id,
        origen: origenBandeja({ origen: o.origen, tipoTrabajo: o.tipoTrabajo }),
        ot: { id: o.id, codigo: o.codigo },
        numero: o.codigo,
        pide: o.cliente ?? "—",
        laboratorio: o.laboratorio,
        producto: o.producto ?? null,
        plazo: fecha(o.fechaCompromiso),
        semaforo: semaforoPlazo(fecha(o.fechaCompromiso), hoy),
        estado: o.muestras === 0 ? "Por recepcionar" : `Recepción incompleta (${o.incompletas} de ${o.muestras})`,
        muestras: o.muestras,
        sinNumero: o.sinNumero,
        ruta: `/ot/${o.id}?tab=muestras`,
      })),
      ...internas.map((i) => ({
        tipo: "orden_interna" as const,
        id: i.id,
        origen: "OT interna" as const,
        ot: { id: i.otId, codigo: i.otCodigo },
        numero: i.numero,
        pide: i.pide ?? "—",
        laboratorio: i.laboratorio,
        producto: i.producto ?? null,
        plazo: fecha(i.fechaCompromiso),
        semaforo: semaforoPlazo(fecha(i.fechaCompromiso), hoy),
        estado: "Orden interna por recibir",
        muestras: null,
        sinNumero: null,
        ruta: `/ordenes-internas?id=${i.id}`,
      })),
    ];
    const orden = { vencido: 0, por_vencer: 1, a_tiempo: 2, sin_plazo: 3 } as const;
    filas.sort((a, b) => orden[a.semaforo] - orden[b.semaforo] || String(a.plazo ?? "9").localeCompare(String(b.plazo ?? "9")));
    const porOrigen = { DCO: 0, "OT interna": 0, BPCH: 0 } as Record<string, number>;
    for (const f of filas) porOrigen[f.origen]++;
    return { data: filas, meta: { total: filas.length, porOrigen } };
  }

  /* ------------------------------------------------------------ retenciones --- */

  /**
   * Muestras con destino testigo, en custodia o contramuestra (EP-01 §6.4,
   * EP-03 §6.3): hasta cuándo se retienen, si ya se dispusieron (devolución o
   * destrucción en la cadena de custodia) y el aviso cuando el plazo se cumple.
   */
  async retenciones(tenantId: string, req: any) {
    const unidades = await this.alcance.filtroUnidades(req, "muestra.ver");
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.codigo, m.nombre, m.numero_interno AS "numeroInterno", m.clase_custodia AS "claseCustodia",
              m.retener_hasta AS "retenerHasta", m.ubicacion, m.recepcionada_at AS "recepcionadaAt",
              o.id AS "otId", o.codigo AS "otCodigo", u.codigo AS laboratorio,
              (SELECT c.evento FROM muestra_custodia c WHERE c.muestra_id = m.id AND c.deleted_at IS NULL
                 AND c.evento IN ('devolucion', 'destruccion') ORDER BY c.fecha DESC LIMIT 1) AS disposicion
         FROM muestra m
         JOIN orden_trabajo o ON o.id = m.ot_id
         LEFT JOIN unidad u ON u.id = o.unidad_principal
        WHERE m.tenant_id = $1::uuid AND m.deleted_at IS NULL
          AND m.clase_custodia IN ('testigo', 'custodia', 'contramuestra')
          AND ($2::uuid[] IS NULL OR o.unidad_principal = ANY($2::uuid[]))
        ORDER BY m.retener_hasta NULLS LAST, m.codigo
        LIMIT 500`,
      tenantId,
      unidades,
    );
    const hoy = hoyIso();
    const data = filas.map((f) => {
      const retener = f.retenerHasta instanceof Date ? f.retenerHasta.toISOString().slice(0, 10) : f.retenerHasta ?? null;
      return {
        ...f,
        numeroInterno: f.numeroInterno == null ? null : String(f.numeroInterno),
        retenerHasta: retener,
        estado: estadoRetencion({ claseCustodia: f.claseCustodia, retenerHasta: retener, dispuesta: !!f.disposicion }, hoy),
      };
    });
    const cumplidas = data.filter((d) => d.estado === "cumplida").length;
    return { data, meta: { total: data.length, cumplidas } };
  }
}
