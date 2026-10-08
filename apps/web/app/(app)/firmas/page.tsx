"use client";

/**
 * Firmas registradas (tabla `firma`): la imagen de firma de cada usuario y su
 * huella SHA-256, que se estampan en informes y certificados. Una firma por
 * usuario: registrar de nuevo la de un usuario la REEMPLAZA (upsert en la API).
 *
 * Distinto de la «Matriz de firmas» (/admin/firmas), que define QUIÉN debe
 * firmar cada tipo de documento.
 */

import { useEffect, useState } from "react";
import CrudTable from "@/components/CrudTable";
import RequierePermiso from "@/components/RequierePermiso";
import { api } from "@/lib/api";
import { fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";

const etiquetaUsuario = (u: any) => [u?.username, u?.nombreCompleto].filter(Boolean).join(" · ");

export default function FirmasPage() {
  const { puede, listo } = usePermisos();
  const [usuarios, setUsuarios] = useState<Record<string, any>>({});

  // Nombre legible del usuario (la tabla firma solo guarda su id). Requiere admin.usuarios.
  useEffect(() => {
    if (!listo || !puede("admin.usuarios")) return;
    api.list<any>("usuarios", { limit: 100 })
      .then((r: any) => {
        const filas: any[] = Array.isArray(r) ? r : r?.data ?? [];
        setUsuarios(Object.fromEntries(filas.map((u) => [String(u.id), u])));
      })
      .catch(() => { /* sin nombres: se muestra el id abreviado */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo]);

  return (
    <RequierePermiso perm="firma.registrar" titulo="las firmas registradas">
      <CrudTable
        recurso="firmas"
        titulo="Firmas registradas"
        subtitulo="Imagen de firma de cada usuario y su huella digital (SHA-256), usadas al firmar informes y certificados. Registrar la firma de un usuario que ya tiene una la reemplaza."
        migas={[{ label: "Administración" }, { label: "Firmas registradas" }]}
        columnas={[
          {
            campo: "usuarioId",
            titulo: "Usuario",
            render: (v) => {
              const u = usuarios[String(v)];
              return u ? <b>{etiquetaUsuario(u)}</b> : <span className="tag" title={String(v)}>{String(v).slice(0, 8)}…</span>;
            },
          },
          { campo: "imagenRef", titulo: "Imagen (referencia)", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
          {
            campo: "hashSha256",
            titulo: "Huella SHA-256",
            render: (v) => (v ? <span className="codigo" title={v}>{String(v).slice(0, 16)}…</span> : <span className="pill amber">sin huella</span>),
          },
          { campo: "registradaAt", titulo: "Registrada", render: (v) => fechaHora(v) },
        ]}
        campos={[
          { campo: "usuarioId", label: "Usuario", tipo: "ref", refRecurso: "usuarios", refLabel: etiquetaUsuario, requerido: true },
          { campo: "imagenRef", label: "Imagen de firma (ruta o referencia)", requerido: true, span: 2, ayuda: "p. ej. firmas/usuario.png en el almacén de documentos" },
          { campo: "hashSha256", label: "Huella SHA-256 (opcional)", span: 3 },
        ]}
        camposEditar={[
          { campo: "imagenRef", label: "Imagen de firma (ruta o referencia)", requerido: true, span: 2 },
          { campo: "hashSha256", label: "Huella SHA-256 (opcional)", span: 3 },
        ]}
        prepararCrear={(d) => ({
          usuarioId: d.usuarioId,
          imagenRef: String(d.imagenRef ?? "").trim(),
          ...(d.hashSha256 ? { hashSha256: String(d.hashSha256).trim() } : {}),
        })}
        prepararActualizar={(d) => ({
          imagenRef: String(d.imagenRef ?? "").trim(),
          ...(d.hashSha256 ? { hashSha256: String(d.hashSha256).trim() } : {}),
        })}
        etiquetaFila={(r) => {
          const u = usuarios[String(r.usuarioId)];
          return u ? `Firma de ${etiquetaUsuario(u)}` : "Firma registrada";
        }}
        textoEliminar={{
          titulo: "¿Eliminar esta firma registrada?",
          mensaje: "Se borra de forma definitiva. El usuario no podrá firmar documentos hasta que se registre una nueva firma.",
        }}
      />
    </RequierePermiso>
  );
}
