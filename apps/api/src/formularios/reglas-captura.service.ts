/**
 * Reglas que detienen la captura de un ensayo (las usa POST /flujo/resultado/
 * :id/valor y los formularios especializados):
 *   1. el ensayo se captura en su formulario especializado (variante);
 *   2. la preparación de su muestra bloquea (QC no conforme, solución vencida,
 *      equipo no apto) o es obligatoria y falta (T29);
 *   3. la documentación del trabajo del DSA no está aprobada (EP-05 2.3, T26).
 * Global: lo inyecta el puente de captura (flujo-real) sin importar el módulo
 * de formularios (que a su vez importa el puente).
 */
import { ConflictException, Global, Injectable, Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AlcanceResultadoService } from "../rbac/alcance-resultado.service";
import { motivoBloqueoPreparacion } from "./preparacion";
import { exigeAprobacion, leerConfigTrabajo, LABS_DSA, motivoBloqueoTrabajo, type EstadoTrabajo } from "./trabajo";
import { mapaActivacion, motivoCapturaEnVariante, varianteDe, type Variante } from "./variantes";

export interface EnsayoCaptura {
  id: string;
  otId: string | null;
  muestraId: string;
  muestraCodigo: string | null;
  metodoCodigo: string | null;
  laboratorio: string | null;
  laboratorioId: string | null;
}

@Injectable()
export class ReglasCapturaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcanceResultado: AlcanceResultadoService,
  ) {}

  /** Activaciones de variantes (por método y por laboratorio). */
  async activaciones(tenantId: string) {
    const filas = await this.prisma.$queryRawUnsafe<{ categoria: string; codigo: string; valor: string | null; activo: boolean }[]>(
      `SELECT categoria, codigo, valor, activo FROM parametro_sistema
        WHERE tenant_id = $1::uuid AND categoria IN ('captura_variante_metodo', 'captura_variante_laboratorio')`,
      tenantId,
    );
    return {
      porMetodo: mapaActivacion(filas.filter((f) => f.categoria === "captura_variante_metodo")),
      porLaboratorio: mapaActivacion(filas.filter((f) => f.categoria === "captura_variante_laboratorio")),
    };
  }

  /** Ensayos con su método, muestra y laboratorio dueño. */
  async ensayos(ids: string[]): Promise<EnsayoCaptura[]> {
    if (!ids.length) return [];
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, COALESCE(r.ot_id, m.ot_id) AS ot_id, r.muestra_id, m.codigo AS muestra_codigo, cm.codigo AS metodo_codigo
         FROM resultado r JOIN muestra m ON m.id = r.muestra_id
         LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
        WHERE r.id = ANY($1::uuid[])`,
      ids,
    );
    const labs = await this.alcanceResultado.labs(ids);
    return filas.map((f) => ({
      id: f.id,
      otId: f.ot_id,
      muestraId: f.muestra_id,
      muestraCodigo: f.muestra_codigo,
      metodoCodigo: f.metodo_codigo,
      laboratorio: labs.get(f.id)?.unidadCodigo ?? null,
      laboratorioId: labs.get(f.id)?.unidadId ?? null,
    }));
  }

  /** Variante de cada ensayo indicado. */
  async variantes(tenantId: string, ensayos: EnsayoCaptura[]): Promise<Map<string, Variante>> {
    const a = await this.activaciones(tenantId);
    return new Map(ensayos.map((e) => [e.id, varianteDe(e, a.porMetodo, a.porLaboratorio)]));
  }

  /** Motivo por el que la preparación de la muestra detiene la captura del laboratorio (null = no). */
  async motivoPreparacion(tenantId: string, e: { otId: string | null; muestraId: string; muestraCodigo: string | null; laboratorio: string | null }): Promise<string | null> {
    if (!e.otId || !e.laboratorio) return null;
    const [reg, obl] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ datos: any }[]>(
        `SELECT datos FROM registro_especializado WHERE ot_id = $1::uuid AND variante = 'preparacion' AND clave = $2`,
        e.otId,
        `${e.muestraId}:${e.laboratorio}`,
      ),
      this.prisma.$queryRawUnsafe<{ activo: boolean }[]>(
        `SELECT activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'preparacion_obligatoria' AND codigo = $2`,
        tenantId,
        e.laboratorio,
      ),
    ]);
    const bloqueos: string[] = Array.isArray(reg[0]?.datos?.bloqueos) ? reg[0].datos.bloqueos : [];
    return motivoBloqueoPreparacion({ registrada: reg.length > 0, bloqueos, obligatoria: obl[0]?.activo === true, muestra: e.muestraCodigo ?? "", lab: e.laboratorio });
  }

  /** Motivo por el que la documentación del trabajo (DSA) detiene la captura del laboratorio (null = no). */
  async motivoTrabajo(tenantId: string, otId: string | null, laboratorio: string | null): Promise<string | null> {
    if (!otId || !laboratorio || !(LABS_DSA as readonly string[]).includes(laboratorio)) return null;
    const [cfgFilas, reg] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
        `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'preparacion_trabajo'`,
        tenantId,
      ),
      this.prisma.$queryRawUnsafe<{ datos: any; estado: string }[]>(
        `SELECT datos, estado FROM registro_especializado WHERE ot_id = $1::uuid AND variante = 'trabajo' AND clave = $2`,
        otId,
        laboratorio,
      ),
    ]);
    const cfg = leerConfigTrabajo(cfgFilas);
    const datos = reg[0]?.datos?.documentacion ?? {};
    return motivoBloqueoTrabajo({
      lab: laboratorio,
      exige: exigeAprobacion(laboratorio, datos, cfg),
      estado: (reg[0]?.estado as EstadoTrabajo) ?? null,
      bloqueaCaptura: cfg.bloqueaCaptura,
    });
  }

  /**
   * 409 si el ensayo no se puede capturar por esta vía. `desde` = variante del
   * formulario especializado que escribe el valor (null = captura estándar).
   */
  async exigirCapturable(resultadoId: string, tenantId: string, desde: Variante | null = null): Promise<void> {
    const [e] = await this.ensayos([resultadoId]);
    if (!e) return;
    const variante = (await this.variantes(tenantId, [e])).get(e.id) ?? "estandar";
    const m = motivoCapturaEnVariante(variante, desde) ?? (await this.motivoTrabajo(tenantId, e.otId, e.laboratorio)) ?? (await this.motivoPreparacion(tenantId, e));
    if (m) throw new ConflictException(m);
  }
}

@Global()
@Module({ providers: [ReglasCapturaService], exports: [ReglasCapturaService] })
export class ReglasCapturaModule {}
