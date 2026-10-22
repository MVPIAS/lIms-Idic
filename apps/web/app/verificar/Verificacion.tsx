"use client";

/**
 * Verificación PÚBLICA de un documento del IDIC por su código (el del QR o el
 * impreso al pie): certificado por arma (vigencia, arma con la serie oculta),
 * informes y certificados del flujo general, y certificados de evidencia del
 * SAEC. Sin sesión y sin datos personales: muestra solo lo que ya trae el papel.
 * API pública: GET /informes/verificar/:codigo y GET /saec/certificados/verificar/:codigo.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

type Resultado =
  | { tipo: "documento"; d: any }
  | { tipo: "saec"; d: any }
  | { tipo: "no_existe" }
  | { tipo: "error"; mensaje: string };

async function consultar(codigo: string): Promise<Resultado> {
  const c = encodeURIComponent(codigo.trim().toUpperCase());
  try {
    const r = await fetch(`${API}/informes/verificar/${c}`);
    const j = await r.json().catch(() => null);
    if (r.status === 429) return { tipo: "error", mensaje: "Demasiadas consultas seguidas: espere un momento y vuelva a intentarlo." };
    if (j && (j.valido || j.numero)) return { tipo: "documento", d: j };
    const s = await fetch(`${API}/saec/certificados/verificar/${c}`);
    const js = await s.json().catch(() => null);
    if (js?.data?.certificado) return { tipo: "saec", d: js.data };
    return { tipo: "no_existe" };
  } catch {
    return { tipo: "error", mensaje: "No se pudo consultar el servicio de verificación. Inténtelo más tarde." };
  }
}

export default function Verificacion({ codigoInicial }: { codigoInicial?: string }) {
  const router = useRouter();
  const [codigo, setCodigo] = useState(codigoInicial ?? "");
  const [r, setR] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!codigoInicial) return;
    setCargando(true);
    consultar(codigoInicial).then((x) => { setR(x); setCargando(false); });
  }, [codigoInicial]);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const c = codigo.trim().toUpperCase();
    if (c.length < 5) return;
    router.push(`/verificar/${encodeURIComponent(c)}` as any);
  }

  return (
    <main style={{ maxWidth: 640, margin: "40px auto", padding: "0 16px", fontSize: 14 }}>
      <header style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>Ejército de Chile · Instituto de Investigaciones y Control</div>
        <h1 style={{ fontSize: 22, margin: "4px 0 6px", color: "var(--primary)" }}>Verificar un documento</h1>
        <p className="subtitle" style={{ margin: 0 }}>
          Escriba el código de verificación impreso al pie del documento o abra el enlace de su código QR. No se muestran datos personales.
        </p>
      </header>

      <form onSubmit={enviar} className="card" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 220, margin: 0 }}>
          <label htmlFor="cv">Código de verificación</label>
          <input id="cv" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="off" spellCheck={false}
            style={{ textTransform: "uppercase", letterSpacing: ".08em", fontFamily: "monospace" }} />
        </div>
        <button type="submit" className="btn primary" disabled={codigo.trim().length < 5}>Verificar</button>
      </form>

      {cargando && <p className="subtitle" role="status">Consultando…</p>}
      {r && !cargando && <Ficha r={r} />}
    </main>
  );
}

function Fila({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr>
      <th style={{ textAlign: "left", fontWeight: 600, padding: "5px 10px 5px 0", width: "42%", color: "var(--muted)" }}>{k}</th>
      <td style={{ padding: "5px 0" }}>{v ?? "—"}</td>
    </tr>
  );
}

function Ficha({ r }: { r: Resultado }) {
  if (r.tipo === "error") return <div className="alert warn" role="alert">{r.mensaje}</div>;
  if (r.tipo === "no_existe")
    return <div className="alert warn" role="alert">No existe ningún documento con ese código. Revise que lo haya escrito tal como aparece impreso.</div>;
  if (r.tipo === "saec") {
    const d = r.d;
    return (
      <div className="card" aria-live="polite">
        <div className={`alert ${d.valido ? "success" : "warn"}`} style={{ marginTop: 0 }}>{d.mensaje}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <Fila k="Documento" v="Certificado de evidencia y peritaje (SAEC)" />
            <Fila k="Nº de certificado" v={d.certificado} />
            <Fila k="Evidencia" v={d.evidencia} />
            <Fila k="Emisor" v={d.emisor} />
            <Fila k="Huella SHA-256" v={<code style={{ fontSize: 11, wordBreak: "break-all" }}>{d.hashDocumento}</code>} />
          </tbody>
        </table>
      </div>
    );
  }
  const d = r.d;
  const esArma = d.tipoDocumento === "CERTIFICADO_ARMA";
  const valido = d.valido && (!esArma || d.vigente);
  return (
    <div className="card" aria-live="polite">
      <div className={`alert ${valido ? "success" : "warn"}`} style={{ marginTop: 0 }}>
        {d.valido
          ? esArma && !d.vigente
            ? <><b>Documento auténtico, pero VENCIDO:</b> su vigencia terminó el {d.vigenteHasta}.</>
            : <><b>Documento auténtico y {esArma ? "vigente" : "oficial"}.</b> Compare la huella SHA-256 con la impresa en su copia.</>
          : <><b>No es válido.</b> {d.motivo ?? ""}</>}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <Fila k="Documento" v={d.tipoDocumentoNombre ?? "Informe o certificado"} />
          <Fila k="Nº" v={d.numero} />
          <Fila k="Fecha" v={d.fecha} />
          {d.otCodigo && <Fila k="Orden de trabajo" v={d.otCodigo} />}
          {esArma && d.arma && <Fila k="Arma" v={`${d.arma.tipo} ${d.arma.marca} ${d.arma.modelo ?? ""} · calibre ${d.arma.calibre ?? "—"}`} />}
          {esArma && d.arma && <Fila k="Nº de serie (parcial)" v={<code>{d.arma.serie}</code>} />}
          {esArma && <Fila k="Vigencia" v={`${d.vigenteDesde} → ${d.vigenteHasta}`} />}
          {d.hash && <Fila k="Huella SHA-256" v={<code style={{ fontSize: 11, wordBreak: "break-all" }}>{d.hash}</code>} />}
        </tbody>
      </table>
    </div>
  );
}
