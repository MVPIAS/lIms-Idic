"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import IdleLogout from "@/components/IdleLogout";
import { FeedbackHost } from "@/components/ui/feedback";
import CambioClave, { sesionConCambioPendiente } from "@/components/CambioClave";
import { api } from "@/lib/api";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  // Contraseña temporal pendiente de cambio: el servidor rechaza todo lo demás
  // (403 CAMBIO_CLAVE_REQUERIDO), así que solo se muestra el cambio.
  const [cambioPendiente, setCambioPendiente] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("lims_token")) {
      router.replace("/login");
    } else {
      setCambioPendiente(sesionConCambioPendiente());
      setOk(true);
    }
  }, [router]);

  if (!ok) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Cargando…
      </div>
    );
  }

  if (cambioPendiente) {
    const usuario = api.getUser();
    return (
      <div className="login-bg">
        <div className="login-card">
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--primary)", margin: "0 0 4px" }}>Cambie su contraseña</h2>
          <p className="subtitle" style={{ marginBottom: 14 }}>
            Su cuenta tiene una contraseña temporal. Antes de usar el sistema debe elegir una propia.
          </p>
          <CambioClave username={usuario?.username} textoBoton="Guardar y continuar" onCambiada={() => setCambioPendiente(false)} />
          <button type="button" className="btn outline sm" style={{ marginTop: 12 }} onClick={() => api.logout()}>Salir</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <Sidebar />
      </aside>
      <header className="topbar">
        <Topbar />
      </header>
      <main className="mainarea">{children}</main>
      <IdleLogout />
      <FeedbackHost />
    </div>
  );
}
