"use client";

/**
 * Pestaña 4 de la ficha de calibración (EP-04 P5.2): balance de incertidumbre por
 * punto. Selector «Punto», tabla Componente · Fórmula · Distribución · Divisor · uᵢ ·
 * Aporte (uᵢ²/uc²) y totales uc, k y U. El servidor arma el balance con los términos
 * que el motor validado ya calculó (no hay otro cálculo en la pantalla).
 */
import { useId, useState } from "react";
import { fmtG } from "@/lib/metrologia";
import s from "./ficha.module.css";

export interface ComponenteBalance { simbolo: string; nombre: string; formula: string; distribucion: string; divisor: string; ui: number; aporte: number }
export interface PuntoBalance { indice: number; nominal: number | null; componentes: ComponenteBalance[]; uc: number; ucMotor: number; k: number; U: number }
export interface Balance { motor: string; unidad: string; unidadNominal?: string; puntos: PuntoBalance[] }

/** Los símbolos (u, uc, g, mL) no se pasan a mayúsculas como el resto de las cabeceras. */
const SIN_MAYUS = { textTransform: "none" as const, letterSpacing: 0 };
const pct = (x: number) => `${x.toLocaleString("es-CL", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

/** Calibraciones antiguas sin motor: componentes guardados en cada punto (GUM parametrizado). */
type PuntoAntiguo = { id: string; nominal: number; componentes?: { simbolo: string; nombre: string; distribucion: string; divisor: number; ui: number }[] };

export default function BalanceIncertidumbre({ balance, puntos, unidadNominal }: { balance: Balance | null; puntos: PuntoAntiguo[]; unidadNominal?: string }) {
  const id = useId();
  const [i, setI] = useState(0);
  const antiguo = !balance && puntos.some((p) => (p.componentes ?? []).length);

  if (!balance && !antiguo)
    return <p style={{ margin: 0, fontSize: 12.5 }}>Aún sin resultados calculados: guarde la toma de datos para ver el balance de cada punto.</p>;

  const filas: PuntoBalance[] = balance
    ? balance.puntos
    : puntos.map((p, k) => {
        const comps = (p.componentes ?? []).map((x) => ({ simbolo: x.simbolo, nombre: x.nombre, formula: "valor / divisor", distribucion: x.distribucion, divisor: fmtG(x.divisor), ui: Math.abs(x.ui ?? 0), aporte: 0 }));
        const uc = Math.sqrt(comps.reduce((t, x) => t + x.ui ** 2, 0));
        return { indice: k, nominal: p.nominal, uc, ucMotor: uc, k: 2, U: 2 * uc, componentes: comps.map((x) => ({ ...x, aporte: uc ? (x.ui ** 2 / uc ** 2) * 100 : 0 })) };
      });
  const p = filas[Math.min(i, filas.length - 1)];
  const u = balance?.unidad ?? "";
  const un = balance?.unidadNominal ?? unidadNominal ?? "";
  const mayor = [...p.componentes].sort((a, b) => b.aporte - a.aporte)[0];

  return (
    <div>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 }}>
        <div className="field" style={{ minWidth: 200, margin: 0 }}>
          <label htmlFor={`${id}-p`}>Punto</label>
          <select id={`${id}-p`} value={Math.min(i, filas.length - 1)} onChange={(e) => setI(Number(e.target.value))}>
            {filas.map((f, k) => (
              <option key={k} value={k}>{k + 1}. {f.nominal == null ? "—" : fmtG(f.nominal)}{un ? ` ${un}` : ""}</option>
            ))}
          </select>
        </div>
        {mayor && (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
            Mayor aporte en este punto: <b style={{ color: "var(--ink)" }}>{mayor.nombre}</b> ({pct(mayor.aporte)}).
          </p>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <caption className="sr-only">Balance de incertidumbre del punto {p.nominal == null ? "" : fmtG(p.nominal)}</caption>
          <thead>
            <tr><th scope="col">Componente</th><th scope="col">Fórmula</th><th scope="col">Distribución</th><th scope="col">Divisor</th>
              <th scope="col" className="num" style={SIN_MAYUS}>u<sub>i</sub>{u ? ` (${u})` : ""}</th><th scope="col" style={{ ...SIN_MAYUS, minWidth: 170 }}>Aporte u<sub>i</sub>²/u<sub>c</sub>²</th></tr>
          </thead>
          <tbody>
            {p.componentes.map((x) => (
              <tr key={x.simbolo + x.nombre}>
                <td><span className="codigo" style={{ color: "var(--muted)", marginRight: 6 }}>{x.simbolo}</span>{x.nombre}</td>
                <td style={{ fontSize: 12 }}>{x.formula}</td>
                <td>{x.distribucion}</td>
                <td className="num">{x.divisor}</td>
                <td className={`num ${s.calc}`}>{fmtG(x.ui)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div className={s.aporte} aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, x.aporte))}%` }} /></div>
                  <span className="num" style={{ fontSize: 12 }}>{pct(x.aporte)}</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th colSpan={4} style={{ textAlign: "right", ...SIN_MAYUS }}>Incertidumbre combinada u<sub>c</sub> = √Σu<sub>i</sub>²</th><td className={`num ${s.calc}`}>{fmtG(p.uc)}</td><td /></tr>
            <tr><th colSpan={4} style={{ textAlign: "right", ...SIN_MAYUS }}>Factor de cobertura k</th><td className="num">{fmtG(p.k)}</td><td /></tr>
            <tr><th colSpan={4} style={{ textAlign: "right", ...SIN_MAYUS }}>Incertidumbre expandida U = k·u<sub>c</sub></th><td className={`num ${s.calc}`}>{fmtG(p.U)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
        {balance
          ? <>Términos del motor validado {balance.motor} (los mismos que suma la planilla del laboratorio). La U certificada de la pestaña 3 es máx(U, CMC) con dos cifras significativas.</>
          : <>Calibración anterior a los motores: componentes del cálculo GUM parametrizado.</>}
      </p>
    </div>
  );
}
