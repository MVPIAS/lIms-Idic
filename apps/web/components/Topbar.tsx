"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { itemDeRuta } from "@/lib/navegacion";
import { usePermisos, infoPerfil } from "@/lib/permisos";

/** Migas de la barra superior a partir del mapa del menú (lib/navegacion.ts). */
function crumbFor(pathname: string): { seccion: string; pagina: string } {
  const m = itemDeRuta(pathname);
  if (m) {
    // Sub-rutas sin ítem propio (p. ej. /ot/<id>): se indica que es un detalle.
    const detalle = pathname !== m.item.href && !pathname.endsWith("/nueva");
    return { seccion: m.seccion.title, pagina: detalle ? `${m.item.label} · detalle` : m.item.label };
  }
  return { seccion: "", pagina: "" };
}

export default function Topbar() {
  const pathname = usePathname() ?? "";
  const [user, setUser] = useState<{ nombreCompleto?: string; cargo?: string; grado?: string } | null>(null);

  useEffect(() => {
    setUser(api.getUser());
  }, []);

  const crumb = crumbFor(pathname);
  const { usuario, perfilJwt, listo, roles } = usePermisos();
  const iniciales = user?.nombreCompleto
    ? user.nombreCompleto.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : (usuario.username ?? "U").slice(0, 2).toUpperCase();

  return (
    <>
      <div className="breadcrumb">
        LIMS IDIC{crumb.seccion && <> · {crumb.seccion}</>}{crumb.pagina && <> · <b>{crumb.pagina}</b></>}
      </div>
      <div className="user">
        <div className="avatar">{iniciales}</div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 600 }}>{user?.nombreCompleto ?? usuario.nombre ?? usuario.username ?? "Usuario"}</div>
          <div style={{ color: "var(--muted)", fontSize: "10.5px" }}>
            {user?.grado ?? user?.cargo ?? (listo ? infoPerfil(perfilJwt, roles).etiqueta : "")}
          </div>
        </div>
        <button onClick={() => api.logout()} className="btn outline sm" style={{ marginLeft: 8 }} title="Cerrar sesión">
          Salir
        </button>
      </div>
    </>
  );
}
