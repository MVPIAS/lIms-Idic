"use client";

/**
 * Pagos recibidos contra facturas. Registrar un pago valida que la factura
 * esté emitida y que el monto no supere el saldo, y deja la factura con pago
 * parcial o pagada. Un pago no se edita: si hubo un error se elimina (la
 * factura recalcula su estado) y se registra de nuevo.
 */
import CrudTable from "@/components/CrudTable";
import { fechaDia, monto } from "@/lib/format";
import { ESTADO_FACTURA } from "@/lib/documentos";

const num = (data: any) => ({
  facturaId: data.facturaId,
  monto: data.monto === "" || data.monto == null ? undefined : Number(data.monto),
  ...(data.medio ? { medio: String(data.medio).trim() } : {}),
  ...(data.referencia ? { referencia: String(data.referencia).trim() } : {}),
  ...(data.fecha ? { fecha: data.fecha } : {}),
});

/** Etiqueta de la factura en el selector (solo se ofrecen las que admiten pagos). */
const etiquetaFactura = (f: any) =>
  `${f.numero} · ${ESTADO_FACTURA[f.estado]?.texto ?? f.estado}${f.saldo != null ? ` · saldo ${monto(f.saldo, f.moneda)}` : ""}`;

export default function PagosPage() {
  return (
    <CrudTable
      recurso="pagos"
      titulo="Pagos"
      subtitulo="Abonos recibidos contra facturas emitidas. Cada pago reduce el saldo; cuando se cubre el total la factura queda pagada. Para corregir un pago, elimínelo y regístrelo de nuevo."
      migas={[{ label: "Finanzas" }, { label: "Pagos" }]}
      prepararCrear={num}
      permitirEditar={false}
      columnas={[
        {
          campo: "facturaId",
          titulo: "Factura",
          render: (_v, row) =>
            row.factura ? (
              <span>
                <span className="codigo">{row.factura.numero}</span>{" "}
                <span className={`pill ${ESTADO_FACTURA[row.factura.estado]?.pill ?? "gray"}`}>{ESTADO_FACTURA[row.factura.estado]?.texto ?? row.factura.estado}</span>
              </span>
            ) : "—",
        },
        { campo: "fecha", titulo: "Fecha", render: (v) => fechaDia(v) },
        { campo: "monto", titulo: "Monto", right: true, render: (v, row) => monto(v, row.factura?.moneda) },
        { campo: "medio", titulo: "Medio" },
        { campo: "referencia", titulo: "Referencia", render: (v) => (v ? <span className="codigo">{v}</span> : "—") },
      ]}
      campos={[
        {
          campo: "facturaId", label: "Factura (emitidas o con pago parcial)", tipo: "select", requerido: true, span: 2,
          opcionesEndpoint: "facturas?estado=por_cobrar&limit=100",
          opcionesMap: (f: any) => ({ value: String(f.id), label: etiquetaFactura(f) }),
        },
        { campo: "monto", label: "Monto", tipo: "moneda", requerido: true },
        { campo: "fecha", label: "Fecha del pago", tipo: "date" },
        { campo: "medio", label: "Medio de pago", ayuda: "transferencia, cheque, depósito…" },
        { campo: "referencia", label: "Referencia" },
      ]}
      etiquetaFila={(r) => `Pago de ${monto(r.monto, r.factura?.moneda)}`}
      textoEliminar={{
        titulo: "¿Eliminar este pago?",
        mensaje: "El saldo de la factura vuelve a aumentar y su estado se recalcula (emitida o pago parcial).",
      }}
    />
  );
}
