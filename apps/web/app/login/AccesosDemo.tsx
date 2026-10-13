"use client";
// =============================================================================
// Accesos de prueba por perfil (pantalla de ingreso).
// -----------------------------------------------------------------------------
// Solo se muestra si el servidor los tiene activados (GET /auth/accesos-demo →
// habilitado: true). Sirve para validar permisos: un clic entra con el perfil
// elegido —jefe, revisor o analista de un laboratorio, comercial, BPCH…— y se
// comprueba que cada uno ve únicamente lo suyo. Ver docs/ACCESOS_DEMO.md.
// =============================================================================
import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export interface AccesoDemo {
  username: string;
  nombre: string;
  cargo: string | null;
  rol: string;
  rolNombre: string;
  unidad: string | null;
  unidadNombre: string | null;
  unidadTipo: string | null;
  grupo: string | null;
  grupoNombre: string | null;
}

interface Pestana { clave: string; titulo: string; grupos: (string | null)[] }

// Las unidades de apoyo (finanzas, abastecimiento) participan del flujo
// comercial; calidad y dirección van con los perfiles generales.
const PESTANAS: Pestana[] = [
  { clave: "general", titulo: "Dirección y sistema", grupos: [null, "DIR", "DGC"] },
  { clave: "comercial", titulo: "Comercial", grupos: ["DCO", "DFZ", "SAB"] },
  { clave: "quimico", titulo: "Químico", grupos: ["DQO"] },
  { clave: "dsa", titulo: "Armamento y Munición", grupos: ["DSA"] },
  { clave: "bpch", titulo: "BPCH", grupos: ["BPCH"] },
];

const ORDEN_TIPO: Record<string, number> = { DIRECCION: 0, DEPARTAMENTO: 1, APOYO: 2, SECCION: 3, LABORATORIO: 4, SUCURSAL: 5, DELEGACION: 6 };

/** «Analista 1 · LQC (prueba)» → «Analista 1»;  «Director técnico (prueba)» → «Director técnico». */
function etiqueta(a: AccesoDemo): string {
  const base = a.nombre.replace(/\s*\(prueba\)\s*$/i, "");
  return a.unidad && base.includes(" · ") ? base.split(" · ")[0] : base;
}

export default function AccesosDemo({
  claveEscrita,
  ocupado,
  onEntrar,
}: {
  /** Lo que haya en el campo Contraseña: se usa como clave si el servidor no la publica. */
  claveEscrita: string;
  ocupado: boolean;
  onEntrar: (username: string, clave: string) => void;
}) {
  const [datos, setDatos] = useState<{ habilitado: boolean; clave?: string; usuarios: AccesoDemo[] } | null>(null);
  const [activa, setActiva] = useState("general");
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`${API}/auth/accesos-demo`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d?.habilitado) setDatos(d); })
      .catch(() => undefined);
    try { const t = sessionStorage.getItem("lims_demo_pestana"); if (t) setActiva(t); } catch { /* sin almacenamiento */ }
    return () => { vivo = false; };
  }, []);

  const pestanas = useMemo(() => {
    const us = datos?.usuarios ?? [];
    return PESTANAS.map((p) => {
      const mios = us.filter((u) => p.grupos.includes(u.grupo));
      // Filas: una por unidad (o una sola «sin unidad» para los perfiles globales).
      const filas = new Map<string, { titulo: string; tipo: string | null; usuarios: AccesoDemo[] }>();
      for (const u of mios) {
        const k = u.unidad ?? "";
        if (!filas.has(k)) filas.set(k, { titulo: u.unidad ? `${u.unidad} · ${u.unidadNombre ?? ""}` : "", tipo: u.unidadTipo, usuarios: [] });
        filas.get(k)!.usuarios.push(u);
      }
      const ordenadas = [...filas.entries()]
        .sort(([ka, a], [kb, b]) => (ORDEN_TIPO[a.tipo ?? ""] ?? 9) - (ORDEN_TIPO[b.tipo ?? ""] ?? 9) || ka.localeCompare(kb))
        .map(([k, f]) => ({ clave: k, ...f }));
      return { ...p, total: mios.length, filas: ordenadas };
    }).filter((p) => p.total > 0);
  }, [datos]);

  if (!datos?.habilitado || pestanas.length === 0) return null;

  const actual = pestanas.find((p) => p.clave === activa) ?? pestanas[0];
  // Los perfiles sin unidad y los de una sola persona por unidad se muestran
  // como botones sueltos; laboratorios y sucursales, en fila con su unidad.
  const sueltos = actual.clave === "general" || actual.clave === "comercial";

  function entrar(u: AccesoDemo) {
    // Orden: la que publica el servidor, la escrita en «Contraseña» y, si no, la
    // última que funcionó en esta pestaña (para cambiar de perfil con un clic).
    let recordada = "";
    try { recordada = sessionStorage.getItem("lims_demo_clave") ?? ""; } catch { /* sin almacenamiento */ }
    const clave = datos?.clave ?? (claveEscrita || recordada);
    if (!clave) { setAviso("Escriba la clave de prueba en «Contraseña» y vuelva a pulsar el perfil."); return; }
    setAviso(null);
    onEntrar(u.username, clave);
  }

  function elegir(clave: string) {
    setActiva(clave);
    try { sessionStorage.setItem("lims_demo_pestana", clave); } catch { /* sin almacenamiento */ }
  }

  return (
    <section className="demo-accesos" aria-label="Accesos de prueba">
      <div className="demo-titulo">
        Accesos de prueba (temporal)
        {datos.clave ? <> · clave <span className="demo-clave">{datos.clave}</span></> : <> · use la clave de prueba</>}
      </div>

      <div className="demo-pestanas" role="tablist">
        {pestanas.map((p) => (
          <button key={p.clave} type="button" role="tab" aria-selected={p.clave === actual.clave}
                  className={`demo-pestana${p.clave === actual.clave ? " activa" : ""}`} onClick={() => elegir(p.clave)}>
            {p.titulo}
          </button>
        ))}
      </div>

      {sueltos ? (
        <div className="demo-rejilla">
          {actual.filas.flatMap((f) => f.usuarios).map((u) => (
            <button key={u.username} type="button" className="demo-perfil" disabled={ocupado} onClick={() => entrar(u)} title={`${u.username} · ${u.rolNombre}`}>
              <b>{etiqueta(u)}</b>
              <span>{u.unidad ? `${u.rolNombre} · ${u.unidad}` : u.rolNombre}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="demo-filas">
          {actual.filas.map((f) => (
            <div key={f.clave} className="demo-fila">
              <div className="demo-unidad" title={f.titulo}>
                <b>{f.clave}</b>
                <span>{f.titulo.split(" · ").slice(1).join(" · ")}</span>
              </div>
              <div className="demo-roles">
                {f.usuarios.map((u) => (
                  <button key={u.username} type="button" className="demo-rol" disabled={ocupado} onClick={() => entrar(u)} title={`${u.username} · ${u.rolNombre}`}>
                    {etiqueta(u).replace(/^Jefe de (laboratorio|sucursal|delegación|departamento|sección)$/i, "Jefe")}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {aviso && <p className="demo-aviso">{aviso}</p>}
      <p className="demo-nota">Usuarios ficticios para validar qué ve cada perfil. No existen en la instalación del IDIC.</p>
    </section>
  );
}
