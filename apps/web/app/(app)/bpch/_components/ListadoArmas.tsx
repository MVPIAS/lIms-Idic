"use client";

/**
 * Bloque «Listado de armas de la resolución» del registro de la internación
 * cuando inspecciona la Delegación Nº 11 (EP-11 11.1): carga masiva desde la
 * planilla (.xlsx o .csv) o ingreso por fila. Queda «según resolución» para el
 * conteo del acta (11.6) y la verificación (11.9).
 */
import { toast } from "@/components/ui/feedback";
import { TIPOS_ARMA, subirPlanilla } from "@/lib/d11";

export type ArmaListado = { clave: number; tipo: string; marca: string; modelo: string; calibre: string; serie: string; accesorios: string; cantidad: string };

let seq = 0;
const vacia = (): ArmaListado => ({ clave: ++seq, tipo: "", marca: "", modelo: "", calibre: "", serie: "", accesorios: "", cantidad: "1" });

export function armasDesde(lista?: any[] | null): ArmaListado[] {
  return (lista ?? []).map((a) => ({
    clave: ++seq,
    tipo: a.tipo ?? "",
    marca: a.marca ?? "",
    modelo: a.modelo ?? "",
    calibre: a.calibre ?? "",
    serie: a.serie ?? "",
    accesorios: a.accesorios ?? "",
    cantidad: String(a.cantidad ?? 1),
  }));
}

export default function ListadoArmas({ armas, onCambio }: { armas: ArmaListado[]; onCambio: (a: ArmaListado[]) => void }) {
  const set = (clave: number, c: Partial<ArmaListado>) => onCambio(armas.map((x) => (x.clave === clave ? { ...x, ...c } : x)));
  const total = armas.reduce((s, a) => s + (Number(a.cantidad) || 0), 0);

  async function cargar(archivo: File) {
    try {
      const r = await subirPlanilla<any>("/bpch/resolucion-armas/leer", archivo);
      onCambio([...armas, ...armasDesde(r.filas)]);
      if (r.errores.length) toast.error(`${r.errores.length} fila(s) no se pudieron leer: ${r.errores.slice(0, 3).join(" ")}`);
      toast.ok(`${r.filas.length} arma(s) leídas de ${archivo.name}. Revíselas antes de registrar.`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="card">
      <h2>Listado de armas de la resolución <span className="right">{total} arma(s) según resolución · EP-11 11.1</span></h2>
      <p className="subtitle">
        Lo que autoriza la resolución DGMN, arma por arma (con nº de serie) o por cantidad. La Delegación Nº 11 cuenta lo recibido contra este listado.
        La planilla debe traer en la primera fila los títulos de las columnas: tipo, marca y, si los tiene, modelo, calibre, serie, accesorios y cantidad.
      </p>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <label className="btn outline sm" style={{ cursor: "pointer" }}>
          Cargar planilla (.xlsx o .csv)
          <input type="file" accept=".xlsx,.csv,.txt" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) cargar(f); e.target.value = ""; }} />
        </label>
        <button type="button" className="btn outline sm" onClick={() => onCambio([...armas, vacia()])}>＋ Añadir arma</button>
        {armas.length > 0 && <button type="button" className="btn ghost-danger sm" onClick={() => onCambio([])}>Vaciar listado</button>}
      </div>
      {armas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead><tr><th>#</th><th>Tipo *</th><th>Marca *</th><th>Modelo</th><th>Calibre</th><th>Nº de serie</th><th>Accesorios</th><th>Cantidad</th><th></th></tr></thead>
            <tbody>
              {armas.map((a, i) => (
                <tr key={a.clave}>
                  <td>{i + 1}</td>
                  <td>
                    <select aria-label={`Tipo del arma ${i + 1}`} value={a.tipo} onChange={(e) => set(a.clave, { tipo: e.target.value })}>
                      <option value="">Elija…</option>
                      {TIPOS_ARMA.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
                    </select>
                  </td>
                  <td><input aria-label={`Marca del arma ${i + 1}`} value={a.marca} onChange={(e) => set(a.clave, { marca: e.target.value })} maxLength={160} /></td>
                  <td><input aria-label={`Modelo del arma ${i + 1}`} value={a.modelo} onChange={(e) => set(a.clave, { modelo: e.target.value })} maxLength={160} /></td>
                  <td><input aria-label={`Calibre del arma ${i + 1}`} value={a.calibre} onChange={(e) => set(a.clave, { calibre: e.target.value })} maxLength={80} style={{ width: 110 }} /></td>
                  <td><input aria-label={`Número de serie del arma ${i + 1}`} value={a.serie} onChange={(e) => set(a.clave, { serie: e.target.value, cantidad: e.target.value.trim() ? "1" : a.cantidad })} maxLength={80} style={{ width: 130 }} /></td>
                  <td><input aria-label={`Accesorios del arma ${i + 1}`} value={a.accesorios} onChange={(e) => set(a.clave, { accesorios: e.target.value })} maxLength={300} /></td>
                  <td><input aria-label={`Cantidad del arma ${i + 1}`} inputMode="numeric" value={a.cantidad} disabled={Boolean(a.serie.trim())} onChange={(e) => set(a.clave, { cantidad: e.target.value.replace(/\D/g, "") })} style={{ width: 60 }} /></td>
                  <td><button type="button" className="btn ghost-danger sm" aria-label={`Quitar el arma ${i + 1}`} onClick={() => onCambio(armas.filter((x) => x.clave !== a.clave))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
