"use client";

/**
 * Nueva solicitud de adquisición (IDIC-PG06-IT02-FORM01). Se guarda en borrador
 * o se envía directo a la jefatura del laboratorio para su V°B°; el Nº de
 * registro (centro de costo solicitante) se asigna al enviarla.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { llamar } from "@/lib/laboratorio";
import { toast } from "@/components/ui/feedback";
import FormSolicitud, { type SolicitudPayload } from "@/components/adquisiciones/FormSolicitud";

export default function NuevaSolicitudPage() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function guardar(p: SolicitudPayload, enviar: boolean) {
    setOcupado(true);
    try {
      const s = await llamar<any>("POST", "/solicitudes-adquisicion", p);
      if (enviar) {
        try {
          const e = await llamar<any>("POST", `/solicitudes-adquisicion/${s.id}/enviar`);
          toast.ok(`Solicitud ${e.numero} enviada a la jefatura para su V°B°.`);
        } catch (err: any) {
          toast.error(`Quedó guardada en borrador, pero no se pudo enviar: ${err.message}`);
        }
      } else toast.ok("Solicitud guardada en borrador.");
      router.push(`/solicitudes-adquisicion/${s.id}` as any);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Nueva solicitud de adquisición"
        subtitulo="Formulario IDIC-PG06-IT02-FORM01 · Rev. 02. 1 Laboratorio crea · 2 V°B° de la jefatura · 3 Abastecimiento recibe y anota la O/C · 4 Recepción en bodega."
        migas={[{ label: "Solicitudes de adquisición", href: "/solicitudes-adquisicion" }, { label: "Nueva" }]}
      />
      <FormSolicitud
        ocupado={ocupado}
        textoGuardar="Guardar borrador"
        textoEnviar="Enviar a la jefatura →"
        onGuardar={guardar}
        onCancelar={() => router.push("/solicitudes-adquisicion" as any)}
      />
    </div>
  );
}
