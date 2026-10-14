"use client";

/**
 * Firmas · la imagen de firma de cada usuario, que se estampa en los informes
 * y certificados cuando los firma (circuito de la matriz de firmas).
 *
 *  · «Mi firma»: cada usuario carga la suya (PNG o JPEG, máx. 70 KB). Se guarda
 *    en la base de datos; al firmar un documento se congela una copia, así que
 *    cambiarla después no altera los documentos ya firmados.
 *  · «Firmas registradas»: listado para quien tiene `firma.registrar`; cargar la
 *    imagen de OTRO usuario exige `admin.usuarios`.
 *
 * Distinto de la «Matriz de firmas» (/admin/firmas), que define QUIÉN debe
 * firmar cada tipo de documento.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import CrudTable from "@/components/CrudTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast, confirmar } from "@/components/ui/feedback";
import { api } from "@/lib/api";
import { fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";

const MAX_KB = 70;
const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const etiquetaUsuario = (u: any) => [u?.username, u?.nombreCompleto].filter(Boolean).join(" · ");

async function put(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lims_token")}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message ?? `Error ${r.status}`);
  return j;
}

/** Lee un fichero de imagen como data URL, validando tipo y tamaño en el cliente. */
function leerImagen(f: File): Promise<string> {
  return new Promise((ok, ko) => {
    if (!/^image\/(png|jpeg)$/.test(f.type)) return ko(new Error("La firma debe ser una imagen PNG o JPEG."));
    if (f.size > MAX_KB * 1024) return ko(new Error(`La imagen supera ${MAX_KB} KB. Recórtela o redúzcala.`));
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ko(new Error("No se pudo leer el fichero."));
    r.readAsDataURL(f);
  });
}

function MiFirma() {
  const [estado, setEstado] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      setEstado(await api.getRaw("mi-firma"));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function subir(f?: File | null) {
    if (!f) return;
    setOcupado(true);
    try {
      setEstado(await put("/mi-firma", { imagen: await leerImagen(f) }));
      toast.ok("Firma registrada. Se usará en los documentos que firme desde ahora.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
      if (input.current) input.current.value = "";
    }
  }

  async function quitar() {
    const ok = await confirmar({
      titulo: "¿Quitar su imagen de firma?",
      mensaje: "Los documentos que firme desde ahora mostrarán su nombre, cargo y fecha sin imagen. Los ya firmados no cambian.",
      confirmarTexto: "Quitar",
      peligro: true,
    });
    if (!ok) return;
    try {
      const r = await fetch(`${API}/mi-firma`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message ?? `Error ${r.status}`);
      setEstado(await r.json());
      toast.ok("Imagen de firma quitada.");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="card">
      <h2>Mi firma</h2>
      <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 220, height: 90, border: "1px dashed var(--line)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
          {estado?.imagen ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={estado.imagen} alt="Su firma registrada" style={{ maxWidth: 210, maxHeight: 80, objectFit: "contain" }} />
          ) : (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>Sin imagen de firma</span>
          )}
        </div>
        <div style={{ fontSize: 12.5, maxWidth: 520 }}>
          <p style={{ marginTop: 0 }}>
            Cargue una imagen de su firma (PNG con fondo blanco o transparente, o JPEG; máximo {MAX_KB} KB). Aparecerá sobre su
            nombre y cargo en los informes que firme.
          </p>
          {estado?.registradaAt && estado?.tieneImagen && (
            <p style={{ color: "var(--muted)" }}>Registrada el {fechaHora(estado.registradaAt)} · huella {String(estado.hashSha256 ?? "").slice(0, 16)}…</p>
          )}
          <input ref={input} type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => subir(e.target.files?.[0])} />
          <div className="toolbar" style={{ margin: 0 }}>
            <button className="btn primary" disabled={ocupado} onClick={() => input.current?.click()}>
              {estado?.tieneImagen ? "Cambiar imagen" : "Cargar imagen"}
            </button>
            {estado?.tieneImagen && <button className="btn ghost-danger" disabled={ocupado} onClick={quitar}>Quitar</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FirmasPage() {
  const { puede, listo } = usePermisos();
  const [usuarios, setUsuarios] = useState<Record<string, any>>({});
  const inputOtro = useRef<HTMLInputElement>(null);
  const [destino, setDestino] = useState<{ id: string; recargar: () => void } | null>(null);

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

  async function subirOtro(f?: File | null) {
    if (!f || !destino) return;
    try {
      await put(`/mi-firma/usuario/${destino.id}`, { imagen: await leerImagen(f) });
      toast.ok("Imagen de firma registrada.");
      destino.recargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      if (inputOtro.current) inputOtro.current.value = "";
      setDestino(null);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Firmas"
        icono="🖋"
        subtitulo="Imagen de firma que se estampa en los informes y certificados al firmarlos. Quién debe firmar cada documento lo define la Matriz de firmas."
        migas={[{ label: "Administración" }, { label: "Firmas" }]}
      />
      <MiFirma />

      {listo && puede("firma.registrar") && (
        <>
          <input ref={inputOtro} type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => subirOtro(e.target.files?.[0])} />
          <CrudTable
            recurso="firmas"
            titulo="Firmas registradas"
            subtitulo={`Firma de cada usuario y su huella digital (SHA-256). ${puede("admin.usuarios") ? "Puede cargar la imagen de otro usuario con «Cargar imagen»." : ""}`}
            permitirCrear={false}
            permitirEditar={false}
            columnas={[
              {
                campo: "usuarioId",
                titulo: "Usuario",
                render: (v) => {
                  const u = usuarios[String(v)];
                  return u ? <b>{etiquetaUsuario(u)}</b> : <span className="tag" title={String(v)}>{String(v).slice(0, 8)}…</span>;
                },
              },
              {
                // La API no entrega la imagen de otros usuarios: solo si existe.
                campo: "tieneImagen",
                titulo: "Imagen",
                render: (v) => (v ? <span className="pill green">cargada</span> : <span className="pill amber">sin imagen</span>),
              },
              {
                campo: "hashSha256",
                titulo: "Huella SHA-256",
                render: (v) => (v ? <span className="codigo" title={v}>{String(v).slice(0, 16)}…</span> : <span className="pill amber">sin huella</span>),
              },
              { campo: "registradaAt", titulo: "Registrada", render: (v) => fechaHora(v) },
            ]}
            etiquetaFila={(r) => {
              const u = usuarios[String(r.usuarioId)];
              return u ? `Firma de ${etiquetaUsuario(u)}` : "Firma registrada";
            }}
            accionesFila={(row, recargar) =>
              puede("admin.usuarios") ? (
                <button type="button" className="btn outline sm" onClick={() => { setDestino({ id: String(row.usuarioId), recargar }); inputOtro.current?.click(); }}>
                  Cargar imagen
                </button>
              ) : null
            }
            textoEliminar={{
              titulo: "¿Eliminar esta firma registrada?",
              mensaje: "Se borra de forma definitiva. Los documentos ya firmados conservan su copia de la firma.",
            }}
          />
        </>
      )}
    </>
  );
}
