"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  // Teléfono y tableta (contrato §4.7.3): bajo 900 px el menú lateral es un panel
  // desplegable que abre el botón ☰ de la barra superior y se cierra al navegar.
  // En escritorio el estado no se usa (el CSS lo ignora).
  const [menuAbierto, setMenuAbierto] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenuAbierto(false), [pathname]);
  useEffect(() => {
    if (!menuAbierto) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuAbierto(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [menuAbierto]);

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
    <div className={`app${menuAbierto ? " menu-abierto" : ""}`}>
      <aside
        className="sidebar"
        id="menu-lateral"
        aria-label="Menú principal"
        // Un enlace del menú cierra el panel aunque lleve a la página actual.
        onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setMenuAbierto(false); }}
      >
        <Sidebar onCerrar={() => setMenuAbierto(false)} />
      </aside>
      <div className="menu-fondo" aria-hidden onClick={() => setMenuAbierto(false)} />
      <header className="topbar">
        <Topbar menuAbierto={menuAbierto} onMenu={() => setMenuAbierto((v) => !v)} />
      </header>
      <main className="mainarea">{children}</main>
      <IdleLogout />
      <FeedbackHost />
    </div>
  );
}
