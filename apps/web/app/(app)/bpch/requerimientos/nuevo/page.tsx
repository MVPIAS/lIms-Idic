"use client";

/** BPCH · Nuevo requerimiento (OT sin cotización). */
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast } from "@/components/ui/feedback";
import { pedir } from "../../_components/bpch";
import { FormularioRequerimiento } from "../_Formulario";

export default function NuevoRequerimientoPage() {
  const router = useRouter();
  return (
    <RequierePermiso perm="bpch.requerimiento.crear" titulo="Nuevo requerimiento BPCH">
      <PageHeader
        icono="✎"
        titulo="Nuevo requerimiento"
        subtitulo="Reemplaza a la cotización en BPCH. Queda por validar: al validarlo otra jefatura, nace la OT derivada a la sucursal."
        migas={[{ label: "BPCH" }, { label: "Requerimientos", href: "/bpch/requerimientos" }, { label: "Nuevo" }]}
      />
      <FormularioRequerimiento
        textoBoton="Guardar requerimiento"
        onGuardar={async (cuerpo) => {
          const r = await pedir<any>("POST", "/bpch/requerimientos", cuerpo);
          toast.ok(`Requerimiento ${r.numero} guardado: queda por validar.`);
          router.push(`/bpch/requerimientos/${r.id}` as any);
        }}
      />
    </RequierePermiso>
  );
}
