import CrudTable from "@/components/CrudTable";

export default function MuestrasPage() {
  return (
    <CrudTable
      recurso="muestras"
      titulo="Muestras"
      subtitulo="Maestro de muestras. A cada muestra se le asignan 1..n ensayos."
      columnas={[
        { campo: "codigo", titulo: "Código" },
        { campo: "nombre", titulo: "Muestra" },
        { campo: "codigoBarras", titulo: "Cód. barras" },
        { campo: "ubicacion", titulo: "Ubicación" },
        { campo: "estado", titulo: "Estado", render: (v) => <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100">{v}</span> },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre de la muestra" },
        { campo: "codigoBarras", label: "Código de barras" },
        { campo: "ubicacion", label: "Ubicación" },
        { campo: "estado", label: "Estado", tipo: "select", opciones: ["recibida", "en_analisis", "finalizada"] },
      ]}
    />
  );
}
