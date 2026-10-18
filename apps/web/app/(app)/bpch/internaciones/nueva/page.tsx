"use client";

/** BPCH · Registrar la resolución DGMN de una internación (formulario vacío). */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Skeleton } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { FormInternacion } from "../../_components/FormInternacion";
import { type ConfigBpch, pedir } from "../../_components/bpch";

export default function NuevaInternacionPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ConfigBpch | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    pedir<ConfigBpch>("GET", "/bpch/config").then(setConfig).catch((e) => setError(e.message));
  }, []);
  return (
    <RequierePermiso perm="bpch.internacion.registrar" titulo="Registrar internación">
      <PageHeader
        icono="🛃"
        titulo="Registrar resolución DGMN"
        subtitulo="Abre el expediente de internación (IDIC-PG 24 Anexo 03). La Sección Certificación analiza después la información técnica."
        migas={[{ label: "BPCH" }, { label: "Internaciones", href: "/bpch/internaciones" }, { label: "Registrar" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {!config && !error && <Skeleton h={160} />}
      {config && <FormInternacion config={config} onGuardado={(r) => router.push(`/bpch/internaciones/${r.id}` as any)} onCancelar={() => router.push("/bpch/internaciones" as any)} />}
    </RequierePermiso>
  );
}
