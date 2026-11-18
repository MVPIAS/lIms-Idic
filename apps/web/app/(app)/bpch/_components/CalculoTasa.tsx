"use client";

/**
 * Cálculo de la tasa de internación 1,5 % con la fórmula del IDIC (cuarto
 * envío 17-11-2026, COM-03) y sus documentos: Comunicación Breve y carta al
 * cliente. La API es la que calcula y guarda (POST /bpch/internaciones/:id/tasa);
 * aquí solo se arma la vista previa con la misma fórmula.
 *
 *   A  CIF en pesos           = CIF US$ × tipo de cambio
 *   B  Ad valorem en pesos    = ad valorem US$ × tipo de cambio (si corresponde)
 *   C  Factura de la agencia de aduana − IVA de internación incluido en ella
 *   C  Otros gastos por cuenta del cliente (fuera de esa factura)
 *   D  Flete nacional (IVA incluido)
 *   Base × % afecto × % tasa = TOTAL A CANCELAR (exento de IVA)
 */
import { useState } from "react";
import { toast } from "@/components/ui/feedback";
import { clp, fecha, fechaHora, num as fmtNum, pct } from "@/lib/format";
import { montoAInput, montoCl } from "@/lib/monto-cl";
import { useListaParametro } from "@/lib/lista-parametro";
import { abrirDocumento } from "@/lib/bpchProcesos";
import { type ConfigBpch, dia } from "./bpch";

type Accion = (metodo: "POST" | "PATCH", ruta: string, cuerpo: unknown, okTexto: string) => Promise<boolean>;
type Puede = (p?: string | string[] | null) => boolean;

/** Centros de costo del reparto (mismo orden que la Comunicación Breve). */
const CENTROS = [
  { codigo: "sucursal", etiqueta: "Sucursal" },
  { codigo: "dtcg", etiqueta: "DTCG" },
  { codigo: "sdbpch", etiqueta: "SDBPCH" },
] as const;
const OTRA = "__otra__";

/** Reparto de la vista previa: cada parte truncada al peso; el DTCG absorbe la diferencia (igual que la API). */
function repartir(tasa: number, pcts: Record<string, number>) {
  const partes = CENTROS.map((c) => ({ ...c, pct: pcts[c.codigo] ?? 0, monto: Math.floor((tasa * Math.round((pcts[c.codigo] ?? 0) * 10000)) / 1_000_000) }));
  const dtcg = partes.find((p) => p.codigo === "dtcg")!;
  dtcg.monto += tasa - partes.reduce((s, p) => s + p.monto, 0);
  return partes;
}

const nombreCentro = (codigo: string, etiqueta: string, unidad: { codigo: string; nombre: string }) =>
  codigo === "sucursal" ? `Sucursal · ${unidad.nombre} (${unidad.codigo})` : etiqueta;

export default function CalculoTasa({ d, config, puede, accion }: { d: any; config: ConfigBpch | null; puede: Puede; accion: Accion }) {
  const agencias = useListaParametro("agencia_aduana");
  const t0 = d.tasa;
  const [f, setF] = useState(() => ({
    // El CIF, el tipo de cambio y el IVA de internación registrados con la documentación se proponen (EP-06 6.8; D06-03).
    cifUsd: montoAInput(t0?.cifUsd ?? d.documentacion?.cifUsd),
    paridad: montoAInput(t0?.paridad ?? d.documentacion?.tipoCambio),
    pctAfecto: montoAInput(t0?.pctAfecto ?? 100),
    adValoremUsd: t0?.adValoremUsd ? montoAInput(t0.adValoremUsd) : "",
    fleteNacional: t0?.fleteNacional ? montoAInput(t0.fleteNacional) : "",
    agenciaTotalFactura: t0?.agenciaTotalFactura ? montoAInput(t0.agenciaTotalFactura) : "",
    agenciaIvaInternacion: montoAInput(t0?.agenciaIvaInternacion || d.documentacion?.ivaInternacion || ""),
    otrosGastosCliente: t0?.otrosGastosCliente ? montoAInput(t0.otrosGastosCliente) : "",
    dinNumero: t0?.dinNumero ?? d.documentoAduanero ?? "",
    fechaRecepcionSdbpch: dia(t0?.fechaRecepcionSdbpch ?? d.documentacion?.recibidaAt),
    agenciaAduanaCodigo: t0?.agenciaAduanaCodigo ?? (t0?.agenciaAduana ? OTRA : ""),
    agenciaAduana: t0?.agenciaAduanaCodigo ? "" : t0?.agenciaAduana ?? "",
    facturaAgenciaNumero: t0?.facturaAgenciaNumero ?? "",
    facturaAgenciaEmisor: t0?.facturaAgenciaEmisor && t0?.facturaAgenciaEmisor !== t0?.agenciaAduana ? t0.facturaAgenciaEmisor : "",
    facturaTransporteNumero: t0?.facturaTransporteNumero ?? "",
    facturaTransporteEmisor: t0?.facturaTransporteEmisor ?? "",
  }));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const tasaPct = config?.parametros.tasaPct;
  const reparto = config?.parametros.reparto ?? null;
  const sumaReparto = reparto ? CENTROS.reduce((s, c) => s + Math.round((reparto[c.codigo] ?? 0) * 10000), 0) / 10000 : null;
  const docEstado = d.documentacion.estado;

  // Montos a la chilena: «184.500» es ciento ochenta y cuatro mil quinientos (F001). Vacío = 0 en los opcionales.
  const n = (v: string) => (v.trim() ? montoCl(v) ?? Number.NaN : 0);
  const obligatorio = (v: string) => (v.trim() ? montoCl(v) ?? Number.NaN : Number.NaN);
  const v = {
    cifUsd: obligatorio(f.cifUsd),
    paridad: obligatorio(f.paridad),
    pctAfecto: obligatorio(f.pctAfecto),
    adValoremUsd: n(f.adValoremUsd),
    fleteNacional: n(f.fleteNacional),
    agenciaTotalFactura: n(f.agenciaTotalFactura),
    agenciaIvaInternacion: n(f.agenciaIvaInternacion),
    otrosGastosCliente: n(f.otrosGastosCliente),
  };
  const malos = Object.entries(v).filter(([, x]) => !Number.isFinite(x)).map(([k]) => k);
  const ivaMayor = v.agenciaIvaInternacion > v.agenciaTotalFactura;
  const prev =
    !malos.length && !ivaMayor && tasaPct != null
      ? (() => {
          const cifClp = Math.round(v.cifUsd * v.paridad);
          const adValoremClp = Math.round(v.adValoremUsd * v.paridad);
          const agenciaNeto = Math.round(v.agenciaTotalFactura) - Math.round(v.agenciaIvaInternacion);
          const base = cifClp + adValoremClp + Math.round(v.fleteNacional) + agenciaNeto + Math.round(v.otrosGastosCliente);
          const tasa = Math.round((base * (v.pctAfecto / 100) * tasaPct) / 100);
          return { cifClp, adValoremClp, agenciaNeto, base, baseAfecta: Math.round((base * v.pctAfecto) / 100), tasa };
        })()
      : null;

  function calcular(e: React.FormEvent) {
    e.preventDefault();
    if (malos.length) {
      toast.error("Revise los montos: punto de miles y coma decimal (p. ej. 184.500 o 950,25). El CIF, el tipo de cambio y el % afecto son obligatorios.");
      return;
    }
    if (ivaMayor) {
      toast.error("El IVA de internación no puede ser mayor que el total de la factura de la agencia.");
      return;
    }
    if (f.agenciaAduanaCodigo === OTRA && !f.agenciaAduana.trim()) {
      toast.error("Escriba el nombre de la agencia de aduana o elíjala de la lista.");
      return;
    }
    const texto = (s: string) => s.trim() || null;
    accion(
      "POST",
      "/tasa",
      {
        ...v,
        dinNumero: texto(f.dinNumero),
        fechaRecepcionSdbpch: f.fechaRecepcionSdbpch || null,
        agenciaAduanaCodigo: f.agenciaAduanaCodigo && f.agenciaAduanaCodigo !== OTRA ? f.agenciaAduanaCodigo : null,
        agenciaAduana: f.agenciaAduanaCodigo === OTRA ? texto(f.agenciaAduana) : null,
        facturaAgenciaNumero: texto(f.facturaAgenciaNumero),
        facturaAgenciaEmisor: texto(f.facturaAgenciaEmisor),
        facturaTransporteNumero: texto(f.facturaTransporteNumero),
        facturaTransporteEmisor: texto(f.facturaTransporteEmisor),
      },
      "Tasa calculada.",
    );
  }

  const t = d.tasa;
  const repartoGuardado: { codigo: string; etiqueta: string; pct: number; monto: number }[] | null = t?.reparto ?? (t && reparto ? repartir(t.tasa, reparto) : null);
  const documento = (tipo: "comunicacion-breve" | "carta-cliente") => () =>
    abrirDocumento(`/bpch/internaciones/${d.id}/tasa/${tipo}?formato=pdf`).catch((err) => toast.error(err.message));

  return (
    <div className="card">
      <h2>
        Cálculo de la tasa{" "}
        <span className="right">
          (CIF + ad valorem + agencia sin IVA de internación + flete + otros gastos) × % afecto × {tasaPct != null ? pct(tasaPct, 1) : "? %"} · exenta de IVA
        </span>
      </h2>

      {t && (
        <>
          <table className="data" style={{ marginBottom: 10 }}>
            <thead><tr><th>Letra</th><th>Concepto</th><th>Detalle</th><th className="num">Monto</th></tr></thead>
            <tbody>
              <tr><td>A</td><td>CIF declarado</td><td>US$ {fmtNum(t.cifUsd, 2)} × {fmtNum(t.paridad, 2)}</td><td className="num">{clp(t.cifClp)}</td></tr>
              {t.adValoremClp > 0 && <tr><td>B</td><td>Ad valorem (código 223)</td><td>US$ {fmtNum(t.adValoremUsd, 2)} × {fmtNum(t.paridad, 2)}</td><td className="num">{clp(t.adValoremClp)}</td></tr>}
              {(t.agenciaTotalFactura > 0 || t.agenciaIvaInternacion > 0) && (
                <>
                  <tr><td>C</td><td>Factura de la agencia de aduana</td><td>{[t.facturaAgenciaNumero && `Nº ${t.facturaAgenciaNumero}`, t.facturaAgenciaEmisor].filter(Boolean).join(" · ") || "—"}</td><td className="num">{clp(t.agenciaTotalFactura)}</td></tr>
                  <tr><td /><td>Menos IVA de internación incluido</td><td>No entra en la base</td><td className="num">− {clp(t.agenciaIvaInternacion)}</td></tr>
                </>
              )}
              {t.otrosGastosCliente > 0 && <tr><td>C</td><td>Otros gastos por cuenta del cliente</td><td>Desaduanamiento, bodega</td><td className="num">{clp(t.otrosGastosCliente)}</td></tr>}
              {t.fleteNacional > 0 && <tr><td>D</td><td>Flete nacional (IVA incluido)</td><td>{[t.facturaTransporteNumero && `Nº ${t.facturaTransporteNumero}`, t.facturaTransporteEmisor].filter(Boolean).join(" · ") || "—"}</td><td className="num">{clp(t.fleteNacional)}</td></tr>}
              <tr><td /><td><b>Total base de cálculo</b></td><td /><td className="num"><b>{clp(t.baseCalculo)}</b></td></tr>
              <tr><td /><td>% afecto</td><td>{pct(t.pctAfecto, 0)}</td><td className="num">{clp(t.baseAfecta)}</td></tr>
              <tr><td /><td><b>Total a cancelar</b> (tasa {pct(t.tasaPct, 1)}, exenta de IVA)</td><td /><td className="num"><b>{clp(t.total)}</b></td></tr>
            </tbody>
          </table>
          <p style={{ fontSize: 12.5, margin: "0 0 8px" }}>
            Declaración de Ingreso: <b>{t.dinNumero ?? "—"}</b> · recepción de documentos SDBPCH: <b>{t.fechaRecepcionSdbpch ? fecha(t.fechaRecepcionSdbpch) : "—"}</b> · agencia de aduana: <b>{t.agenciaAduana ?? "—"}</b>
          </p>
          {repartoGuardado && (
            <table className="data" style={{ marginBottom: 8 }} aria-label="Cargar a centro de costo">
              <thead><tr><th>Cargar a centro de costo</th><th className="num">%</th><th className="num">Monto</th></tr></thead>
              <tbody>
                {repartoGuardado.map((p) => (
                  <tr key={p.codigo}><td>{nombreCentro(p.codigo, p.etiqueta, d.unidad)}</td><td className="num">{pct(p.pct, 0)}</td><td className="num">{clp(p.monto)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <small style={{ color: "var(--muted)" }}>Calculada el {fechaHora(t.calculadoAt)} por {t.calculadoPorNombre ?? "—"}.</small>
          {puede("bpch.tasa.gestionar") && (
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button type="button" className="btn outline sm" onClick={documento("comunicacion-breve")}>Comunicación Breve (PDF)</button>
              <button type="button" className="btn outline sm" onClick={documento("carta-cliente")}>Carta al cliente (PDF)</button>
            </div>
          )}
        </>
      )}

      {!d.remitidaAt && puede("bpch.tasa.gestionar") && (
        docEstado !== "conforme" ? (
          <div className="alert info" style={{ marginTop: 8 }}>La tasa se calcula con la documentación administrativa conforme.</div>
        ) : (
          <form onSubmit={calcular} style={{ marginTop: 12 }}>
            {sumaReparto !== null && sumaReparto !== 100 && (
              <div className="alert warn" role="alert">
                El reparto por centro de costo suma {pct(sumaReparto, 0)} y debe sumar 100 %: corríjalo en Administración › Parámetros del sistema › Porcentajes de la tasa de internación antes de calcular.
              </div>
            )}
            <h3 style={{ margin: "0 0 6px" }}>Datos del expediente</h3>
            <div className="form-grid">
              <div className="field"><label htmlFor="din">Nº Declaración de Ingreso (DIN)</label><input id="din" maxLength={40} value={f.dinNumero} onChange={set("dinNumero")} /></div>
              <div className="field"><label htmlFor="frs">Recepción de documentos en la SDBPCH</label><input id="frs" type="date" value={f.fechaRecepcionSdbpch} onChange={set("fechaRecepcionSdbpch")} /></div>
              <div className="field">
                <label htmlFor="age">Agencia de aduana</label>
                <select id="age" value={f.agenciaAduanaCodigo} onChange={set("agenciaAduanaCodigo")} aria-describedby="age-ayuda">
                  <option value="">Elija…</option>
                  {agencias.opciones.map((a) => <option key={a.codigo} value={a.codigo}>{a.etiqueta}</option>)}
                  {/* Una agencia guardada que ya no está vigente se sigue mostrando. */}
                  {f.agenciaAduanaCodigo && f.agenciaAduanaCodigo !== OTRA && !agencias.vigente(f.agenciaAduanaCodigo) && <option value={f.agenciaAduanaCodigo}>{agencias.texto(f.agenciaAduanaCodigo)}</option>}
                  <option value={OTRA}>Otra (escribir el nombre)…</option>
                </select>
                <small id="age-ayuda" style={{ color: "var(--muted)" }}>La lista se mantiene en Administración › Parámetros del sistema › «Agencia de aduana».</small>
              </div>
              {f.agenciaAduanaCodigo === OTRA && (
                <div className="field span-2"><label htmlFor="agn">Nombre de la agencia de aduana</label><input id="agn" maxLength={200} value={f.agenciaAduana} onChange={set("agenciaAduana")} /></div>
              )}
              <div className="field"><label htmlFor="fan">Nº factura de la agencia</label><input id="fan" maxLength={40} value={f.facturaAgenciaNumero} onChange={set("facturaAgenciaNumero")} /></div>
              <div className="field"><label htmlFor="fae">Emisor de la factura de la agencia</label><input id="fae" maxLength={200} placeholder="La agencia elegida" value={f.facturaAgenciaEmisor} onChange={set("facturaAgenciaEmisor")} /></div>
              <div className="field"><label htmlFor="ftn">Nº factura del transporte</label><input id="ftn" maxLength={40} value={f.facturaTransporteNumero} onChange={set("facturaTransporteNumero")} /></div>
              <div className="field"><label htmlFor="fte">Emisor de la factura del transporte</label><input id="fte" maxLength={200} value={f.facturaTransporteEmisor} onChange={set("facturaTransporteEmisor")} /></div>
            </div>

            <h3 style={{ margin: "12px 0 6px" }}>Valores para el cálculo</h3>
            <div className="form-grid">
              <div className="field"><label htmlFor="cif">A · Valor CIF (US$) *</label><input id="cif" inputMode="decimal" value={f.cifUsd} onChange={set("cifUsd")} /></div>
              <div className="field"><label htmlFor="par">Tipo de cambio US$ → $ *</label><input id="par" inputMode="decimal" value={f.paridad} onChange={set("paridad")} /></div>
              <div className="field">
                <label htmlFor="adv">B · Ad valorem (US$)</label>
                <input id="adv" inputMode="decimal" placeholder="0" value={f.adValoremUsd} onChange={set("adValoremUsd")} aria-describedby="adv-ayuda" />
                <small id="adv-ayuda" style={{ color: "var(--muted)" }}>Código 223 de la Declaración de Ingreso, si corresponde. Se convierte con el mismo tipo de cambio.</small>
              </div>
              <div className="field">
                <label htmlFor="agt">C · Total factura de la agencia ($)</label>
                <input id="agt" inputMode="decimal" placeholder="0" value={f.agenciaTotalFactura} onChange={set("agenciaTotalFactura")} aria-describedby="agt-ayuda" />
                <small id="agt-ayuda" style={{ color: "var(--muted)" }}>«Monto de la operación»: honorarios con IVA, aporte portuario y pagos por cuenta del cliente.</small>
              </div>
              <div className="field">
                <label htmlFor="agi">IVA de internación incluido en esa factura ($)</label>
                <input id="agi" inputMode="decimal" placeholder="0" value={f.agenciaIvaInternacion} onChange={set("agenciaIvaInternacion")} aria-describedby="agi-ayuda" />
                <small id="agi-ayuda" style={{ color: "var(--muted)" }}>La agencia paga el IVA de internación por cuenta del cliente y lo cobra en su factura. No entra en la base: se descuenta.</small>
              </div>
              <div className="field">
                <label htmlFor="otr">C · Otros gastos por cuenta del cliente ($)</label>
                <input id="otr" inputMode="decimal" placeholder="0" value={f.otrosGastosCliente} onChange={set("otrosGastosCliente")} aria-describedby="otr-ayuda" />
                <small id="otr-ayuda" style={{ color: "var(--muted)" }}>Desaduanamiento o bodega que NO vengan ya en la factura de la agencia.</small>
              </div>
              <div className="field"><label htmlFor="fle">D · Flete nacional, IVA incluido ($)</label><input id="fle" inputMode="decimal" placeholder="0" value={f.fleteNacional} onChange={set("fleteNacional")} /></div>
              <div className="field"><label htmlFor="afe">% afecto</label><input id="afe" inputMode="decimal" value={f.pctAfecto} onChange={set("pctAfecto")} /></div>
              <div className="field readonly">
                <label htmlFor="prev">Vista previa</label>
                <input id="prev" readOnly value={prev ? `Base ${clp(prev.base)} · tasa ${clp(prev.tasa)} · exenta de IVA` : ivaMayor ? "El IVA de internación supera la factura de la agencia" : "—"} />
              </div>
            </div>
            {prev && reparto && sumaReparto === 100 && (
              <p style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                Reparto: {repartir(prev.tasa, reparto).map((p) => `${nombreCentro(p.codigo, p.etiqueta, d.unidad)} ${clp(p.monto)}`).join(" · ")}.
              </p>
            )}
            <div style={{ marginTop: 10 }}><button type="submit" className="btn primary sm">{t ? "Recalcular" : "Calcular y guardar"}</button></div>
          </form>
        )
      )}
    </div>
  );
}
