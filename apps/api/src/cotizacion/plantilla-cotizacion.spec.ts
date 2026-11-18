import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cuerpoCotizacionHtml, type FirmasCotizacion } from "./cotizacion-documento";
import {
  COTIZACION_EJEMPLO,
  CUERPO_COTIZACION_FORM04,
  CUERPO_COTIZACION_FORM04_V2,
  VARIABLES_COTIZACION,
  textosDocumentoDesdeFilas,
  contextoCotizacion,
  elegirCuerpoCotizacion,
  renderCuerpoCotizacion,
  validarCuerpoCotizacion,
} from "./plantilla-cotizacion";
import { aplanarVariables } from "../plantilla-render/plantilla-versiones";

const firmas: FirmasCotizacion = {
  elabora: { nombre: "Ejecutivo PRUEBA", fecha: "2026-11-02T13:00:00Z" },
  firma: { nombre: "Jefe DCO PRUEBA", fecha: "2026-11-03T14:30:00Z" },
  pendientes: [],
};

const CASOS: Record<string, any> = {
  completa_usd: COTIZACION_EJEMPLO,
  minima_clp: { codigo: "COT-1", createdAt: "2026-10-01T15:00:00Z", cliente: null, lineas: [], subtotal: 0, neto: 0, ivaMonto: 0, total: 0 },
  clp_con_lineas: {
    codigo: "COT-2026-0042",
    fechaEmision: new Date("2026-10-15T00:00:00Z"),
    validezDias: 45,
    formaPago: "codigo_historico",
    moneda: "CLP",
    referencia: "OC <cliente> & \"Cía\" 'x'",
    condicionesAdicionales: "Línea 1\n\n  Línea 2 <b>  ",
    cliente: { razonSocial: "Cliente {{cliente.rut}} PRUEBA", rut: "76.543.210-K" },
    lineas: [
      { descripcion: "Ensayo A", cantidad: 3, precioUnitario: 12345.6, subtotal: 37036.8 },
      { categoria: "Categoría B", precioUnitario: "1000", subtotal: "1000" },
      { tipo: "tipo C" },
    ],
    subtotal: 38036.8,
    neto: 38037,
    ivaMonto: 7227,
    total: 45264,
  },
  usd_sin_fecha_dolar: { ...COTIZACION_EJEMPLO, dolarFecha: null, plazoEntregaDias: 0, referencia: null, descripcionTecnica: null },
  exenta_solo_horario: { ...COTIZACION_EJEMPLO, ivaPct: 0, ivaMonto: 0, textosDocumento: { horarioAtencion: "  Horario <PRUEBA> & Cía  ", telefonoReclamos: "" } },
  sin_textos_documento: { ...COTIZACION_EJEMPLO, textosDocumento: undefined },
};

describe("plantilla de cotización (4.6.8)", () => {
  it.each(Object.keys(CASOS))("la versión 2 (FORM04 con textos estándar) rinde EXACTAMENTE el formato fijo · %s", (k) => {
    expect(renderCuerpoCotizacion(CUERPO_COTIZACION_FORM04_V2, CASOS[k], firmas)).toBe(cuerpoCotizacionHtml(CASOS[k]));
  });

  it("la versión 1 (FORM04) sigue siendo válida y la 2 la contiene sin cambios salvo el bloque de textos", () => {
    expect(validarCuerpoCotizacion(CUERPO_COTIZACION_FORM04)).toEqual([]);
    expect(validarCuerpoCotizacion(CUERPO_COTIZACION_FORM04_V2)).toEqual([]);
    const fin = CUERPO_COTIZACION_FORM04.indexOf('<p class="nota">');
    expect(CUERPO_COTIZACION_FORM04_V2.startsWith(CUERPO_COTIZACION_FORM04.slice(0, fin))).toBe(true);
  });

  describe("textos estándar del cuarto envío (18-11-2026)", () => {
    const html = (cot: any) => renderCuerpoCotizacion(CUERPO_COTIZACION_FORM04_V2, cot, firmas);
    it("notas, Nº de la cotización en la OC y confidencialidad", () => {
      const h = html(COTIZACION_EJEMPLO);
      expect(h).toContain("<h2>Notas</h2>");
      expect(h).toContain("Los tiempos de ensayo y disponibilidad para efectuar el trabajo solicitado son estimados.");
      expect(h).toContain("las muestras deben ser retiradas antes de 1 mes");
      expect(h).toContain("La identificación de las muestras debe ser entregada por el cliente por correo electrónico.");
      expect(h).toContain("IMPORTANTE: SEÑALAR EN LA ORDEN DE COMPRA EL Nº DE ESTA COTIZACIÓN (COT-PRUEBA-0001).");
      expect(h).toContain("<h2>Confidencialidad</h2>");
    });
    it("Ley 21.420 solo si la cotización lleva IVA", () => {
      expect(html(COTIZACION_EJEMPLO)).toContain("Ley 21.420");
      expect(html({ ...COTIZACION_EJEMPLO, ivaPct: 0, ivaMonto: 0 })).not.toContain("Ley 21.420");
      expect(html(CASOS.minima_clp)).not.toContain("Ley 21.420");
      expect(html(CASOS.clp_con_lineas)).toContain("Ley 21.420");
    });
    it("horario y reclamos: se imprimen escapados; vacíos, no se imprime la línea", () => {
      const h = html(COTIZACION_EJEMPLO);
      expect(h).toContain("Horario de atención a clientes: Horario PRUEBA");
      expect(h).toContain("Reclamos y sugerencias: Teléfono PRUEBA");
      const e = html(CASOS.exenta_solo_horario);
      expect(e).toContain("Horario de atención a clientes: Horario &lt;PRUEBA&gt; &amp; Cía</p>");
      expect(e).not.toContain("Reclamos y sugerencias");
      expect(html(CASOS.sin_textos_documento)).not.toContain("Horario de atención");
    });
    it("los parámetros se leen recortados; sin filas, vacíos", () => {
      expect(textosDocumentoDesdeFilas([{ codigo: "horario_atencion", valor: " L-V " }, { codigo: "telefono_reclamos", valor: null }])).toEqual({ horarioAtencion: "L-V", telefonoReclamos: "" });
      expect(textosDocumentoDesdeFilas([])).toEqual({ horarioAtencion: "", telefonoReclamos: "" });
    });
  });

  it("align_cuarto_envio_cotizacion.sql aplica la versión 2 solo sobre la versión 1 sin editar (md5)", () => {
    const sql = readFileSync(join(__dirname, "../../../../packages/db/align_cuarto_envio_cotizacion.sql"), "utf8");
    const m = /\$form04v2\$([\s\S]*?)\$form04v2\$/.exec(sql);
    expect(m).not.toBeNull();
    expect(m![1].replace(/\r\n/g, "\n")).toBe(CUERPO_COTIZACION_FORM04_V2);
    const md5v1 = createHash("md5").update(CUERPO_COTIZACION_FORM04, "utf8").digest("hex");
    expect(sql).toContain(`v_v1    CONSTANT TEXT := '${md5v1}'`);
  });

  it("el SQL siembra el mismo cuerpo que el código", () => {
    const sql = readFileSync(join(__dirname, "../../../../packages/db/align_brechas_4.sql"), "utf8");
    const m = /\$form04\$([\s\S]*?)\$form04\$/.exec(sql);
    expect(m).not.toBeNull();
    expect(m![1].replace(/\r\n/g, "\n")).toBe(CUERPO_COTIZACION_FORM04);
  });

  it("la plantilla FORM04 no tiene errores", () => {
    expect(validarCuerpoCotizacion(CUERPO_COTIZACION_FORM04)).toEqual([]);
  });

  it("las variables documentadas son exactamente las del contexto", () => {
    const { datos, bloques } = contextoCotizacion(COTIZACION_EJEMPLO, firmas);
    const documentadas = VARIABLES_COTIZACION.map((v) => v.clave).sort();
    expect([...aplanarVariables(datos), ...Object.keys(bloques)].sort()).toEqual(documentadas);
  });

  it("variables de firma y cliente", () => {
    const html = renderCuerpoCotizacion("{{firmas.firma_nombre}}|{{firmas.estado}}|{{cliente.razon_social}}", COTIZACION_EJEMPLO, firmas);
    expect(html).toBe("Jefe DCO PRUEBA|Firmada|Cliente PRUEBA");
    const sin = renderCuerpoCotizacion("{{firmas.estado}}{{#si firmas.firma_nombre}}X{{/si}}", COTIZACION_EJEMPLO, { ...firmas, firma: null });
    expect(sin).toBe("En proceso de firma");
  });

  it("nunca expone las observaciones internas", () => {
    const { datos } = contextoCotizacion({ ...COTIZACION_EJEMPLO, observacionesInternas: "SECRETO" }, firmas);
    expect(JSON.stringify(datos)).not.toContain("SECRETO");
  });

  describe("validación", () => {
    it.each([
      ["", "vacío"],
      ["{{cliente.nombre}}", "no existe"],
      ["{{#si cliente.rut}}x", "Falta cerrar"],
      ["x{{/si}}", "sin su"],
      ["{{#si cliente.rut}}{{#si cliente.giro}}a{{/si}}{{/si}}", "dentro de otro"],
      ["{{#si filas_detalle}}a{{/si}}", "es un bloque"],
      ["{{ cliente rut }}", "mal escrita"],
      ["{{cliente.rut}", "sin su cierre"],
      ["{{#si cliente.rut}}a{{/no}}", "se cierra con"],
    ])("%s → %s", (cuerpo, frase) => {
      expect(validarCuerpoCotizacion(cuerpo).join(" ")).toContain(frase);
    });

    it("anidar tipos distintos sí vale", () => {
      expect(validarCuerpoCotizacion("{{#si cliente.rut}}{{#no cliente.giro}}a{{/no}}{{/si}}")).toEqual([]);
    });
  });

  describe("versión con respaldo", () => {
    const cot = CASOS.clp_con_lineas;
    const vigenteRota = { id: "v3", numero: 3, estado: "VIGENTE", cuerpoHtml: "<p>{{variable.inexistente}}</p>" };
    const anterior = { id: "v2", numero: 2, estado: "RETIRADA", cuerpoHtml: "<p>{{cotizacion.codigo}}</p>" };

    it("usa la vigente si rinde", () => {
      const r = elegirCuerpoCotizacion(cot, firmas, [anterior]);
      expect(r).toEqual({ cuerpo: "<p>COT-2026-0042</p>", version: { id: "v2", numero: 2 }, avisos: [] });
    });

    it("si la vigente falla usa la anterior vigente y lo avisa", () => {
      const r = elegirCuerpoCotizacion(cot, firmas, [vigenteRota, anterior]);
      expect(r.cuerpo).toBe("<p>COT-2026-0042</p>");
      expect(r.version?.numero).toBe(2);
      expect(r.avisos[0]).toContain("versión 3");
    });

    it("sin versiones utilizables, el formato fijo", () => {
      expect(elegirCuerpoCotizacion(cot, firmas, [vigenteRota]).cuerpo).toBe(cuerpoCotizacionHtml(cot));
      expect(elegirCuerpoCotizacion(cot, firmas, []).version).toBeNull();
    });

    it("una versión sin cuerpo equivale al formato fijo", () => {
      const r = elegirCuerpoCotizacion(cot, firmas, [{ id: "v1", numero: 1, estado: "VIGENTE", cuerpoHtml: null }]);
      expect(r.cuerpo).toBe(cuerpoCotizacionHtml(cot));
      expect(r.version?.numero).toBe(1);
    });
  });
});
