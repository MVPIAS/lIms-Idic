"use client";

/**
 * Menú lateral según el rol.
 *  · Ítems filtrados por permiso (lib/navegacion.ts · `perm`).
 *  · Secciones plegables; el estado se recuerda en localStorage.
 *  · La sección de la página actual se abre sola y el ítem activo se resalta.
 *  · Buscador para filtrar el menú (sin tildes / mayúsculas).
 *  · Insignia con el perfil del usuario (GET /me/alcance o, si no está, el JWT).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { NAV, normalizar, type ItemNav } from "@/lib/navegacion";
import { usePermisos, PERFIL_INFO, type Perfil } from "@/lib/permisos";
import { useAlcance } from "@/lib/alcance";

const CLAVE_PLEGADO = "lims_menu_plegado";

function leerPlegado(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_PLEGADO) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export default function Sidebar() {
  const pathname = usePathname() ?? "";
  const { listo, puede, perfilJwt } = usePermisos();
  const { alcance } = useAlcance();
  // El layout (app) solo monta el menú en el cliente (tras comprobar el token): leer storage aquí es seguro.
  const [plegado, setPlegado] = useState<Record<string, boolean>>(() =>
    typeof window === "undefined" ? {} : leerPlegado(),
  );
  const [q, setQ] = useState("");

  const perfil: Perfil = (alcance?.perfil as Perfil) ?? perfilJwt;
  const infoPerfil = PERFIL_INFO[perfil] ?? { etiqueta: perfil, descripcion: "" };

  // Antes de leer el token se muestra solo lo que no exige permiso (evita parpadeos de ítems prohibidos).
  const visible = (i: ItemNav) => (listo ? puede(i.perm) : !i.perm);

  const nav = useMemo(() => {
    const needle = normalizar(q.trim());
    return NAV.map((s) => ({
      ...s,
      items: s.items.filter(visible).filter((i) =>
        !needle || normalizar(`${i.label} ${s.title} ${i.claves ?? ""}`).includes(needle),
      ),
    })).filter((s) => s.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, listo, puede]);

  const activeHref = useMemo(() => {
    return nav
      .flatMap((s) => s.items.map((i) => i.href))
      .filter((h) => pathname === h || pathname.startsWith(h + "/"))
      .sort((a, b) => b.length - a.length)[0];
  }, [nav, pathname]);

  const seccionActiva = nav.find((s) => s.items.some((i) => i.href === activeHref))?.id;

  // Al navegar, la sección de la página actual se despliega (luego el usuario puede plegarla).
  useEffect(() => {
    if (seccionActiva && plegado[seccionActiva]) alternar(seccionActiva, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seccionActiva, pathname]);

  function alternar(id: string, abiertaAhora: boolean) {
    setPlegado((p) => {
      const next = { ...p, [id]: abiertaAhora };
      try { localStorage.setItem(CLAVE_PLEGADO, JSON.stringify(next)); } catch { /* sin storage: solo en memoria */ }
      return next;
    });
  }

  const buscando = q.trim().length > 0;

  return (
    <div className="sb">
      <div className="brand">
        <div className="crest">I</div>
        <div>
          <b>LIMS IDIC</b>
          <small>Instituto de Investigaciones y Control</small>
        </div>
      </div>

      {listo && (
        <div className="sb-perfil" title={infoPerfil.descripcion}>
          <span className="sb-perfil-dot" aria-hidden />
          <span className="sb-perfil-txt">{infoPerfil.etiqueta}</span>
        </div>
      )}

      <div className="sb-buscar">
        <input
          type="search"
          placeholder="Buscar en el menú…"
          aria-label="Buscar en el menú"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQ("");
          }}
        />
      </div>

      {nav.length === 0 && <div className="sb-vacio">Sin coincidencias para «{q}».</div>}

      {nav.map((sect) => {
        // Abierta si se está buscando o si el usuario no la plegó.
        const abierta = buscando || !plegado[sect.id];
        const panelId = `sb-sec-${sect.id}`;
        return (
          <div key={sect.id} className="sb-sec">
            <button
              type="button"
              className={`sect sb-sec-btn${abierta ? " abierta" : ""}`}
              aria-expanded={abierta}
              aria-controls={panelId}
              onClick={() => alternar(sect.id, abierta)}
              disabled={buscando}
            >
              <span>{sect.title}</span>
              <span className="sb-chev" aria-hidden>{abierta ? "▾" : "▸"}</span>
            </button>
            {abierta && (
              <div id={panelId}>
                {sect.items.map((item) => {
                  const active = item.href === activeHref;
                  return (
                    <Link
                      key={item.href}
                      href={item.href as any}
                      className={`nav${active ? " active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => buscando && setQ("")}
                    >
                      <span className="ico">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
