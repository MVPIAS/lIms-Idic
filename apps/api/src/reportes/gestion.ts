/**
 * Reportes de gestión (EP-00 9.4, BL-174, frente r4c) · reglas PURAS de
 * agregación, probadas en gestion.spec.ts. Las filas vienen de SQL ya
 * acotado al alcance (reportes-gestion.controller.ts).
 */
import type { Hoja } from "../common/xlsx-escritura";

const r1 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const pct = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : null);

export interface FilaPlazo {
  laboratorio: string;
  cerrada: boolean;
  /** Días de ciclo (recepción → cierre); null si falta una fecha. */
  dias: number | null;
  /** true dentro de plazo, false fuera, null sin fecha de compromiso. */
  dentro: boolean | null;
  vencidaAbierta: boolean;
  diasAtraso: number | null;
}

export interface PlazoLaboratorio {
  laboratorio: string;
  cerradas: number;
  conCompromiso: number;
  dentro: number;
  fuera: number;
  pctDentro: number | null;
  cicloPromedio: number | null;
  atrasoPromedio: number | null;
  vencidasAbiertas: number;
}

/** Cumplimiento de plazo y tiempo de ciclo por laboratorio (EP-00 9.4, §5.5). */
export function plazosPorLaboratorio(filas: FilaPlazo[]): PlazoLaboratorio[] {
  const por = new Map<string, FilaPlazo[]>();
  for (const f of filas) por.set(f.laboratorio, [...(por.get(f.laboratorio) ?? []), f]);
  return [...por.entries()]
    .map(([laboratorio, fs]) => {
      const cerradas = fs.filter((f) => f.cerrada);
      const con = cerradas.filter((f) => f.dentro !== null);
      const dentro = con.filter((f) => f.dentro).length;
      const ciclos = cerradas.map((f) => f.dias).filter((d): d is number => d !== null);
      const atrasos = cerradas.map((f) => f.diasAtraso).filter((d): d is number => d !== null && d > 0);
      return {
        laboratorio,
        cerradas: cerradas.length,
        conCompromiso: con.length,
        dentro,
        fuera: con.length - dentro,
        pctDentro: pct(dentro, con.length),
        cicloPromedio: ciclos.length ? r1(ciclos.reduce((a, b) => a + b, 0) / ciclos.length) : null,
        atrasoPromedio: atrasos.length ? r1(atrasos.reduce((a, b) => a + b, 0) / atrasos.length) : null,
        vencidasAbiertas: fs.filter((f) => f.vencidaAbierta).length,
      };
    })
    .sort((a, b) => a.laboratorio.localeCompare(b.laboratorio));
}

/** Tabla cruzada laboratorio × estado de las OT. */
export function otPorLaboratorioEstado(filas: { laboratorio: string; estado: string; total: number }[]) {
  const estados = [...new Set(filas.map((f) => f.estado))].sort();
  const labs = [...new Set(filas.map((f) => f.laboratorio))].sort();
  const celda = (l: string, e: string) => filas.find((f) => f.laboratorio === l && f.estado === e)?.total ?? 0;
  return {
    estados,
    filas: labs.map((l) => {
      const por = Object.fromEntries(estados.map((e) => [e, celda(l, e)]));
      return { laboratorio: l, porEstado: por, total: estados.reduce((s, e) => s + por[e], 0) };
    }),
  };
}

export interface ReporteGestion {
  rango: { desde: string | null; hasta: string | null };
  otPorEstado: ReturnType<typeof otPorLaboratorioEstado>;
  plazos: PlazoLaboratorio[];
  facturacionCentroCosto: { centroCosto: string; nombre: string | null; facturas: number; neto: number; total: number; pagado: number; saldo: number }[];
  sinCobro: { laboratorio: string; ot: number; costoEstimado: number }[];
  encuestas: { laboratorio: string; registradas: number; pendientes: number; promedio: number | null }[];
  trazabilidad: { cotizacion: string | null; ot: string; laboratorio: string | null; estadoOt: string; factura: string | null; estadoFactura: string | null; total: number | null }[];
}

/** El reporte como libro Excel: una hoja por sección, con encabezados en español. */
export function hojasGestion(r: ReporteGestion): Hoja[] {
  const periodo = `${r.rango.desde ?? "inicio"} a ${r.rango.hasta ?? "hoy"}`;
  return [
    {
      nombre: "OT por laboratorio y estado",
      filas: [["Laboratorio", ...r.otPorEstado.estados, "Total"], ...r.otPorEstado.filas.map((f) => [f.laboratorio, ...r.otPorEstado.estados.map((e) => f.porEstado[e]), f.total])],
    },
    {
      nombre: "Plazos por laboratorio",
      filas: [
        ["Laboratorio", "OT cerradas", "Con compromiso", "Dentro de plazo", "Fuera de plazo", "% dentro", "Ciclo promedio (días)", "Atraso promedio (días)", "Vencidas abiertas"],
        ...r.plazos.map((p) => [p.laboratorio, p.cerradas, p.conCompromiso, p.dentro, p.fuera, p.pctDentro, p.cicloPromedio, p.atrasoPromedio, p.vencidasAbiertas]),
      ],
    },
    {
      nombre: "Facturación por centro de costo",
      filas: [
        ["Centro de costo", "Nombre", "Facturas", "Neto", "Total", "Pagado", "Saldo"],
        ...r.facturacionCentroCosto.map((f) => [f.centroCosto, f.nombre, f.facturas, f.neto, f.total, f.pagado, f.saldo]),
      ],
    },
    { nombre: "OT sin cobro valorizadas", filas: [["Laboratorio", "OT sin cobro", "Costo estimado"], ...r.sinCobro.map((f) => [f.laboratorio, f.ot, f.costoEstimado])] },
    {
      nombre: "Encuestas por laboratorio",
      filas: [["Laboratorio", "Registradas", "Pendientes", "Promedio (1 a 7)"], ...r.encuestas.map((e) => [e.laboratorio, e.registradas, e.pendientes, e.promedio])],
    },
    {
      nombre: "Cotización-OT-factura",
      filas: [
        ["Cotización", "OT", "Laboratorio", "Estado OT", "Factura", "Estado factura", "Total factura"],
        ...r.trazabilidad.map((t) => [t.cotizacion, t.ot, t.laboratorio, t.estadoOt, t.factura, t.estadoFactura, t.total]),
      ],
    },
    { nombre: "Período", filas: [["Reporte de gestión · LIMS IDIC"], [`Período: ${periodo}`]] },
  ];
}
