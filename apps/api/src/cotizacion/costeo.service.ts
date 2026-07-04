import { Injectable } from "@nestjs/common";

/**
 * Costeo del módulo comercial IDIC (Ejército de Chile).
 *
 * Reproduce el formulario de costeo real del Ejército: se acumulan los costos
 * directos (viáticos, horas-hombre civil/militar, horas-máquina, pasajes, otros),
 * se les agrega el Costo Fijo Asociado (CFA, gasto administrativo institucional),
 * y sobre el Costo Total se calculan tres precios de salida:
 *   - Precio Ejército (institucional, con CFA) — para unidades del Ejército.
 *   - Precio Institucional FFAA (con CFA, sin margen) — otras ramas / servicios públicos.
 *   - Precio Particular (con CFA + margen comercial) — clientes externos.
 *
 * Además calcula la TASA DE INTERNACIÓN del 1,5% aplicable a servicios ligados a
 * importación (peritaje/ensayo de material internado), con su IVA asociado.
 *
 * Todos los porcentajes son PARÁMETROS (vienen de la configuración vigente de IDIC);
 * aquí solo se fijan valores por defecto razonables. La lógica es pura y sin BD,
 * por lo que es directamente testeable.
 */

export type TipoLinea =
  | "viatico"
  | "hora_hombre_civil"
  | "hora_hombre_militar"
  | "hora_maquina"
  | "pasaje"
  | "insumo"
  | "otros";

export interface LineaCosto {
  tipo: TipoLinea;
  descripcion?: string;
  /** Cantidad de unidades (días de viático, horas, pasajes, etc.). */
  cantidad: number;
  /** Valor por unidad en CLP. */
  valorUnitario: number;
}

export interface ParametrosCosteo {
  /** Costo Fijo Asociado: % sobre el Costo Directo Total. Def. 12%. */
  cfaPct?: number;
  /** Margen comercial para clientes particulares: % sobre Costo Total. Def. 20%. */
  margenParticularPct?: number;
  /** IVA vigente. Def. 19%. */
  ivaPct?: number;
  /** Redondeo del precio final a múltiplo de N CLP (0 = sin redondeo). Def. 0. */
  redondeoClp?: number;
}

export interface DesgloseCosteo {
  /** Subtotales de costo directo por tipo de línea. */
  costoDirecto: Record<string, number>;
  /** Costo Directo Total (suma de todas las líneas). */
  cdt: number;
  /** Costo Fijo Asociado (CFA). */
  cfa: number;
  /** Costo Total (CDT + CFA). */
  ct: number;
  cfaPct: number;
  precios: {
    /** Ejército: Costo Total, sin margen. */
    ejercito: number;
    /** Institucional FFAA: igual al Costo Total (sin margen). */
    institucional: number;
    /** Particular: Costo Total + margen comercial. */
    particular: number;
    /** Neto que se muestra sin CFA (referencia interna). */
    ejercitoSinCfa: number;
  };
  margenParticularPct: number;
}

export interface ResultadoTasaInternacion {
  /** Valor CIF en la divisa original. */
  cifDivisa: number;
  divisa: string;
  paridad: number;
  /** Valor CIF convertido a CLP. */
  cifClp: number;
  tasaPct: number;
  /** Tasa de internación (1,5% del CIF en CLP). */
  tasa: number;
  ivaPct: number;
  /** IVA sobre la tasa. */
  iva: number;
  /** Total a pagar por el servicio de internación (tasa + IVA). */
  total: number;
}

@Injectable()
export class CosteoService {
  private redondear(v: number, multiplo: number): number {
    if (!multiplo || multiplo <= 0) return Math.round(v);
    return Math.round(v / multiplo) * multiplo;
  }

  /**
   * Calcula el costeo completo a partir de las líneas de costo directo.
   */
  calcular(lineas: LineaCosto[], params: ParametrosCosteo = {}): DesgloseCosteo {
    const cfaPct = params.cfaPct ?? 12;
    const margenParticularPct = params.margenParticularPct ?? 20;
    const redondeo = params.redondeoClp ?? 0;

    const costoDirecto: Record<string, number> = {};
    for (const l of lineas) {
      const monto = (l.cantidad || 0) * (l.valorUnitario || 0);
      costoDirecto[l.tipo] = (costoDirecto[l.tipo] ?? 0) + monto;
    }

    const cdt = Object.values(costoDirecto).reduce((a, b) => a + b, 0);
    const cfa = cdt * (cfaPct / 100);
    const ct = cdt + cfa;
    const particular = ct * (1 + margenParticularPct / 100);

    return {
      costoDirecto,
      cdt: this.redondear(cdt, redondeo),
      cfa: this.redondear(cfa, redondeo),
      ct: this.redondear(ct, redondeo),
      cfaPct,
      precios: {
        ejercito: this.redondear(ct, redondeo),
        institucional: this.redondear(ct, redondeo),
        particular: this.redondear(particular, redondeo),
        ejercitoSinCfa: this.redondear(cdt, redondeo),
      },
      margenParticularPct,
    };
  }

  /**
   * Tasa de internación del 1,5% (servicios ligados a importación).
   * @param cifDivisa valor CIF en la divisa de la importación
   * @param paridad valor de la divisa en CLP (p. ej. USD→CLP)
   */
  tasaInternacion(
    cifDivisa: number,
    paridad: number,
    opts: { divisa?: string; tasaPct?: number; ivaPct?: number } = {},
  ): ResultadoTasaInternacion {
    const divisa = opts.divisa ?? "USD";
    const tasaPct = opts.tasaPct ?? 1.5;
    const ivaPct = opts.ivaPct ?? 19;

    const cifClp = cifDivisa * paridad;
    const tasa = cifClp * (tasaPct / 100);
    const iva = tasa * (ivaPct / 100);

    return {
      cifDivisa,
      divisa,
      paridad,
      cifClp: Math.round(cifClp),
      tasaPct,
      tasa: Math.round(tasa),
      ivaPct,
      iva: Math.round(iva),
      total: Math.round(tasa + iva),
    };
  }
}
