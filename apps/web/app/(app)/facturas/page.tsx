"use client";

/**
 * Facturas · lista + alta manual + corrección de datos seguros + anulación.
 *
 *  · Las facturas normales se generan al cerrar la OT; aquí se puede emitir una
 *    factura MANUAL de una línea (factura.emitir).
 *  · Editar: solo datos seguros del documento — estado (factura.cobrar) y
 *    número / fecha / origen (factura.emitir). Los montos NO se editan: el
 *    backend los calcula de las líneas al emitir.
 *  · No se borran: se ANULAN (estado «anulada»), para conservar la trazabilidad.
 */

import CrudTable, { type CampoForm } from "@/components/CrudTable";
import { monto, fecha } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { api } from "@/lib/api";
import { toast, confirmar } from "@/components/ui/feedback";

const ESTADOS = ["emitida", "pagada", "anulada"];

const estadoPill = (v: string) => (
  <span className={`pill ${v === "pagada" ? "green" : v === "emitida" ? "amber" : v === "anulada" ? "red" : "gray"}`}>{v ?? "—"}</span>
);

const CAMPOS_ALTA: CampoForm[] = [
  { campo: "numero", label: "N° factura", requerido: true },
  { campo: "clienteId", label: "Cliente", tipo: "ref", refRecurso: "clientes", requerido: true, refLabel: (c) => [c.rut, c.razonSocial].filter(Boolean).join(" · ") },
  { campo: "otId", label: "OT asociada (opcional)", tipo: "ref", refRecurso: "ot", refLabel: (o) => [o.codigo, o.cliente?.razonSocial].filter(Boolean).join(" · ") },
  { campo: "descripcion", label: "Descripción del servicio", requerido: true, span: 2 },
  { campo: "cantidad", label: "Cantidad", tipo: "number", requerido: true },
  { campo: "precioUnitario", label: "Precio unitario (neto)", tipo: "moneda", requerido: true },
  { campo: "ivaPct", label: "IVA %", tipo: "number", ayuda: "Por defecto 19 %" },
];

export default function FacturasPage() {
  const { puede } = usePermisos();
  const corrigeDocumento = puede("factura.emitir");

  // Campos de edición: el estado (cobranza) y, si emite, los datos del documento.
  const camposEditar: CampoForm[] = [
    { campo: "estado", label: "Estado", tipo: "select", opciones: ESTADOS, requerido: true },
    ...(corrigeDocumento
      ? ([
          { campo: "numero", label: "N° factura", requerido: true },
          { campo: "fechaEmision", label: "Fecha de emisión", tipo: "date" },
          { campo: "origen", label: "Origen", ayuda: "p. ej. sistema, manual, legado" },
        ] as CampoForm[])
      : []),
  ];

  async function anular(row: any, recargar: () => void) {
    const ok = await confirmar({
      titulo: `¿Anular la factura ${row.numero}?`,
      mensaje: "La factura queda en estado «anulada» y se conserva en el historial. Para corregir importes emita una nota de crédito.",
      confirmarTexto: "Anular factura",
      peligro: true,
    });
    if (!ok) return;
    try {
      await api.update("facturas", String(row.id), { estado: "anulada" });
      toast.ok(`Factura ${row.numero} anulada.`);
      recargar();
    } catch (e: any) {
      toast.error(`No se pudo anular: ${e.message}`);
    }
  }

  return (
    <CrudTable
      recurso="facturas"
      titulo="Facturas"
      subtitulo="Se generan al cerrar cada OT. Aquí puedes emitir una factura manual, corregir el estado, número o fecha y anularlas. Los montos no se editan: para ajustarlos usa una nota de crédito."
      migas={[{ label: "Comercial" }, { label: "Facturas" }]}
      columnas={[
        { campo: "numero", titulo: "N° Factura", render: (v) => <span className="codigo">{v}</span> },
        { campo: "fechaEmision", titulo: "Emisión", render: (v) => fecha(v) },
        { campo: "neto", titulo: "Neto", right: true, render: (v, row) => monto(v, row.moneda) },
        { campo: "ivaMonto", titulo: "IVA", right: true, render: (v, row) => monto(v, row.moneda) },
        { campo: "total", titulo: "Total", right: true, render: (v, row) => monto(v, row.moneda) },
        { campo: "estado", titulo: "Estado", render: estadoPill, editable: { tipo: "select", opciones: ESTADOS, requerido: true } },
      ]}
      campos={CAMPOS_ALTA}
      camposEditar={camposEditar}
      prepararCrear={(d) => ({
        numero: String(d.numero ?? "").trim(),
        clienteId: d.clienteId,
        ...(d.otId ? { otId: d.otId } : {}),
        ivaPct: d.ivaPct === "" || d.ivaPct == null ? 19 : Number(d.ivaPct),
        lineas: [{ descripcion: d.descripcion, cantidad: Number(d.cantidad || 1), precioUnitario: Number(d.precioUnitario || 0) }],
      })}
      prepararActualizar={(d) => {
        const out: Record<string, any> = { estado: d.estado };
        if (corrigeDocumento) {
          if (d.numero) out.numero = String(d.numero).trim();
          if (d.fechaEmision) out.fechaEmision = d.fechaEmision;
          if (d.origen !== undefined && d.origen !== null) out.origen = d.origen;
        }
        return out;
      }}
      permitirEliminar={false}
      etiquetaFila={(r) => `Factura ${r.numero}`}
      accionesFila={(row, recargar) =>
        row.estado !== "anulada" && puede("factura.cobrar") ? (
          <button type="button" className="btn ghost-danger sm" onClick={() => anular(row, recargar)}>Anular</button>
        ) : null
      }
    />
  );
}
