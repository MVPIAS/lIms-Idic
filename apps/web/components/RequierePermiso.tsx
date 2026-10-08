"use client";

/**
 * <RequierePermiso perm="admin.usuarios"> … </RequierePermiso>
 *
 * Envuelve una página (o un bloque) y, si el usuario no tiene el permiso, muestra
 * una tarjeta amable «Sin acceso» en vez del contenido. Con un array basta con
 * tener UNO de los permisos. SUPERADMIN/ADMIN siempre pasan.
 *
 * Es solo UI: la protección real la aplica el backend (403). Evita que un
 * usuario sin permiso vea una pantalla rota llena de errores 403.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { usePermisos } from "@/lib/permisos";
import { Skeleton } from "@/components/ui/PageHeader";

export default function RequierePermiso({
  perm,
  children,
  titulo,
  compacto,
}: {
  perm: string | string[];
  children: ReactNode;
  /** nombre de la sección, para el mensaje. */
  titulo?: string;
  /** versión pequeña (para bloques dentro de una página). */
  compacto?: boolean;
}) {
  const { listo, puede } = usePermisos();

  if (!listo) {
    return (
      <div style={{ display: "grid", gap: 10, maxWidth: 520 }} aria-busy="true">
        <Skeleton w="40%" h={18} />
        <Skeleton w="80%" />
        <Skeleton w="65%" />
      </div>
    );
  }

  if (puede(perm)) return <>{children}</>;

  const lista = Array.isArray(perm) ? perm : [perm];
  return (
    <div className={`card sin-acceso${compacto ? " compacto" : ""}`} role="alert">
      <div className="sin-acceso-ico" aria-hidden>🔒</div>
      <div>
        <h2 style={{ margin: "0 0 4px" }}>Sin acceso{titulo ? ` a ${titulo}` : ""}</h2>
        <p className="subtitle" style={{ margin: 0 }}>
          Tu perfil no tiene permiso para ver esta sección. Si crees que lo necesitas para tu trabajo,
          pide a la administración del sistema que te lo asigne.
        </p>
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0" }}>
          Permiso requerido: {lista.map((p) => <span key={p} className="tag" style={{ marginRight: 4 }}>{p}</span>)}
        </p>
        {!compacto && (
          <div style={{ marginTop: 12 }}>
            <Link href="/inicio" className="btn outline sm">← Volver a Mi bandeja</Link>
          </div>
        )}
      </div>
    </div>
  );
}
