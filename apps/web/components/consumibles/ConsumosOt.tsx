"use client";

// Pestaña «Consumos» del expediente de la OT (contrato §4.4.5): reactivos y
// consumibles usados en la OT y sus muestras —los que descontó la captura y los
// registrados a mano en «Consumibles e inventario»—, con lote, muestra, método
// y actividad, y los consumos que quedaron pendientes por falta de stock.

import { useEffect, useState } from "react";
import Link from "next/link";
import { llamar } from "@/lib/laboratorio";
import { fechaHora, fechaDia } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { ACTIVIDADES } from "./actividades";

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString("es-CL", { maximumFractionDigits: 4 });
const TIPO: Record<string, { texto: string; pill: string }> = {
  consumo: { texto: "Consumo", pill: "amber" },
  ajuste: { texto: "Ajuste", pill: "blue" },
  entrada: { texto: "Entrada", pill: "green" },
};

interface Datos {
  resumen: { consumible: string; unidad: string | null; cantidad: number; movimientos: number }[];
  movimientos: any[];
  pendientes: any[];
}

export default function ConsumosOt({ otId }: { otId: string }) {
  const { puede } = usePermisos();
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    llamar<Datos>("GET", `/consumibles/ot/${otId}`)
      .then((r) => { setD(r); setError(""); })
      .catch((e) => setError(e.message));
  }, [otId]);

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d) return <p className="subtitle" style={{ margin: 0 }}>Cargando consumos…</p>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p className="subtitle" style={{ margin: 0 }}>
        Consumibles usados en esta OT y sus muestras: los que descuenta la captura de cada ensayo (por orden de caducidad) y los movimientos registrados a mano con vínculo a la OT o a una muestra.
        {puede("consumible.gestionar") && <> El kardex completo está en <Link href={"/consumibles" as any} style={{ color: "var(--accent)" }}>Consumibles e inventario</Link>.</>}
      </p>
      {!!d.pendientes.length && (
        <div className="alert warn" role="alert">
          {d.pendientes.length} consumo(s) pendiente(s) de descontar por falta de stock: {d.pendientes.map((p) => `${p.consumible_codigo} ${fmt(p.cantidad)} ${p.unidad_medida ?? ""} (muestra ${p.muestra_codigo})`).join("; ")}.
        </div>
      )}
      {!!d.resumen.length && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {d.resumen.map((r) => (
            <span key={r.consumible} className="pill blue" title={`${r.movimientos} movimiento(s)`}>{r.consumible}: {fmt(r.cantidad)} {r.unidad ?? ""}</span>
          ))}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr><th>Fecha</th><th>Consumible</th><th>Lote</th><th>Tipo</th><th style={{ textAlign: "right" }}>Cantidad</th><th>Muestra</th><th>Método</th><th>Actividad</th><th>Registró</th></tr>
          </thead>
          <tbody>
            {d.movimientos.map((m) => (
              <tr key={m.id}>
                <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{fechaHora(m.created_at)}</td>
                <td><span className="codigo">{m.consumible_codigo}</span> {m.consumible_nombre}</td>
                <td>{m.numero_lote}{m.fecha_vencimiento && <div style={{ fontSize: 11, color: "var(--muted)" }}>vence {fechaDia(m.fecha_vencimiento)}</div>}</td>
                <td>
                  <span className={`pill ${TIPO[m.tipo]?.pill ?? "gray"}`}>{TIPO[m.tipo]?.texto ?? m.tipo}</span>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{m.automatico ? "automático (captura)" : "manual"}</div>
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(m.cantidad)} {m.unidad_medida ?? ""}</td>
                <td className="codigo">{m.muestra_codigo ?? "—"}</td>
                <td style={{ fontSize: 12 }}>{m.metodo_codigo ? `${m.metodo_codigo} · ${m.metodo_nombre ?? ""}` : "—"}</td>
                <td style={{ fontSize: 12 }}>{m.actividad ? ACTIVIDADES[m.actividad] ?? m.actividad : "—"}</td>
                <td style={{ fontSize: 12 }}>{m.usuario_nombre ?? "—"}</td>
              </tr>
            ))}
            {!d.movimientos.length && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Aún no hay consumos registrados en esta OT.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
