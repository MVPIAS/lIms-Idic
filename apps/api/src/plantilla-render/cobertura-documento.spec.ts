import {
  documentoEnConflicto,
  erroresCobertura,
  etiquetaCobertura,
  motivoNoEmitido,
  normalizarCobertura,
  pendientesCobertura,
  solapan,
  type CoberturaDoc,
} from "./cobertura-documento";
import { faltantesParaCerrar } from "../ot/plazos";

const ot: CoberturaDoc = { cobertura: "ot", muestraIds: [], unidadId: null };
const m = (...ids: string[]): CoberturaDoc => ({ cobertura: "muestra", muestraIds: ids, unidadId: null });
const p = (...ids: string[]): CoberturaDoc => ({ cobertura: "producto", muestraIds: ids, unidadId: null });
const lab = (id: string): CoberturaDoc => ({ cobertura: "laboratorio", muestraIds: [], unidadId: id });

describe("varios documentos por OT · cobertura", () => {
  const muestras = [
    { id: "m1", codigo: "M-1", elementoId: "pintura-trafico", elementoNombre: "Pintura de tráfico" },
    { id: "m2", codigo: "M-2", elementoId: "pintura-trafico", elementoNombre: "Pintura de tráfico" },
    { id: "m3", codigo: "M-3", elementoId: "microesferas", elementoNombre: "Microesferas" },
  ];

  it("normaliza: sin cobertura es toda la OT; quita repetidos y lo que no corresponde", () => {
    expect(normalizarCobertura(null)).toEqual(ot);
    expect(normalizarCobertura({ cobertura: "muestra", muestraIds: ["m1", "m1"], unidadId: "x" })).toEqual(m("m1"));
    expect(normalizarCobertura({ cobertura: "laboratorio", muestraIds: ["m1"], unidadId: "LQA" })).toEqual(lab("LQA"));
    expect(normalizarCobertura({ cobertura: "otra" as any })).toEqual(ot);
  });

  it("LQC · por muestra: exactamente una muestra de la OT", () => {
    const ctx = { muestras, laboratorios: [] };
    expect(erroresCobertura(m("m1"), ctx)).toEqual([]);
    expect(erroresCobertura(m("m1", "m2"), ctx).join(" ")).toMatch(/exactamente una muestra/);
    expect(erroresCobertura(m("zz"), ctx).join(" ")).toMatch(/no son de esta OT/);
  });

  it("LPN · por producto: muestras del mismo producto", () => {
    const ctx = { muestras, laboratorios: [] };
    expect(erroresCobertura(p("m1", "m2"), ctx)).toEqual([]);
    expect(erroresCobertura(p("m1", "m3"), ctx).join(" ")).toMatch(/mismo producto/);
    expect(erroresCobertura(p(), ctx).join(" ")).toMatch(/Elija el producto/);
  });

  it("Alimentos · por laboratorio: un laboratorio que trabaja en la OT", () => {
    const ctx = { muestras, laboratorios: ["LQA", "LMB"] };
    expect(erroresCobertura(lab("LMB"), ctx)).toEqual([]);
    expect(erroresCobertura(lab("LES"), ctx).join(" ")).toMatch(/no trabaja en esta OT/);
    expect(erroresCobertura({ cobertura: "laboratorio", muestraIds: [], unidadId: null }, ctx).join(" ")).toMatch(/Elija el laboratorio/);
  });

  it("solapes: toda la OT con todo; muestras compartidas; mismo laboratorio; laboratorio con muestras", () => {
    expect(solapan(ot, m("m1"))).toBe(true);
    expect(solapan(m("m1"), m("m2"))).toBe(false);
    expect(solapan(p("m1", "m2"), m("m2"))).toBe(true);
    expect(solapan(lab("LQA"), lab("LMB"))).toBe(false);
    expect(solapan(lab("LQA"), lab("LQA"))).toBe(true);
    expect(solapan(lab("LQA"), m("m1"))).toBe(true);
  });

  it("conflicto: solo con documentos vigentes o «no emitidos»; los anulados y devueltos no ocupan", () => {
    const existentes = [
      { ...m("m1"), estado: "anulado" },
      { ...m("m2"), estado: "devuelto" },
      { ...m("m3"), estado: "anulado", noEmitido: true },
    ];
    expect(documentoEnConflicto(m("m1"), existentes)).toBeNull();
    expect(documentoEnConflicto(m("m2"), existentes)).toBeNull();
    expect(documentoEnConflicto(m("m3"), existentes)?.noEmitido).toBe(true);
    expect(documentoEnConflicto(m("m1"), [{ ...m("m1"), estado: "en_firma" }])).not.toBeNull();
    expect(documentoEnConflicto(m("m1"), [{ ...m("m2"), estado: "oficial" }])).toBeNull();
  });

  it("etiquetas legibles", () => {
    const mapa = new Map(muestras.map((x) => [x.id, x]));
    expect(etiquetaCobertura(m("m1"), { muestras: mapa })).toBe("Muestra M-1");
    expect(etiquetaCobertura(p("m1", "m2"), { muestras: mapa })).toBe("Producto Pintura de tráfico (2 muestras)");
    expect(etiquetaCobertura(lab("x"), { laboratorio: "LMB" })).toBe("Laboratorio LMB");
    expect(etiquetaCobertura(ot)).toBe("Toda la OT");
  });

  it("«no emitido» exige motivo", () => {
    expect(motivoNoEmitido("La muestra no forma película")).toBeNull();
    expect(motivoNoEmitido("no")).toMatch(/mínimo 5/);
  });
});

describe("varios documentos por OT · cuenta para el cierre", () => {
  const muestras = [
    { id: "m1", codigo: "M-1", conResultados: true },
    { id: "m2", codigo: "M-2", conResultados: true },
    { id: "m3", codigo: "M-3", conResultados: false },
  ];
  const labs = [
    { id: "LQA", codigo: "LQA", conResultados: true },
    { id: "LMB", codigo: "LMB", conResultados: true },
  ];

  it("sin documentos o con uno de toda la OT, no añade nada (rige la regla general)", () => {
    expect(pendientesCobertura({ muestras, laboratorios: labs, documentos: [] })).toEqual([]);
    expect(pendientesCobertura({ muestras, laboratorios: labs, documentos: [{ ...ot, estado: "oficial" }, { ...m("m1"), estado: "oficial" }] })).toEqual([]);
  });

  it("por muestra: cada muestra con resultados necesita su documento (o su «no emitido»)", () => {
    const f = pendientesCobertura({ muestras, laboratorios: labs, documentos: [{ ...m("m1"), estado: "en_firma" }] });
    expect(f).toEqual(["La muestra M-2 no tiene documento: emítalo o registre que no se emite, con su motivo."]);
    expect(
      pendientesCobertura({ muestras, laboratorios: labs, documentos: [{ ...m("m1"), estado: "oficial" }, { ...p("m2"), estado: "anulado", noEmitido: true }] }),
    ).toEqual([]);
    // Un documento anulado (sin «no emitido») no cubre.
    expect(pendientesCobertura({ muestras, laboratorios: labs, documentos: [{ ...m("m1"), estado: "oficial" }, { ...m("m2"), estado: "anulado" }] })).toHaveLength(1);
  });

  it("por laboratorio: cada laboratorio con resultados necesita su documento", () => {
    const f = pendientesCobertura({ muestras, laboratorios: labs, documentos: [{ ...lab("LQA"), estado: "oficial" }] });
    expect(f).toEqual(["El laboratorio LMB no tiene su documento en esta OT."]);
  });

  it("el cierre de la OT suma lo que falta cubrir", () => {
    const docs = [{ numero: "IE LPN N° 001/2026", estado: "oficial", entregadoAt: "2026-10-20" }];
    expect(faltantesParaCerrar({ estado: "finalizada", documentos: docs, resultadosNoAprobados: 0 })).toEqual([]);
    expect(
      faltantesParaCerrar({ estado: "finalizada", documentos: docs, resultadosNoAprobados: 0, coberturaPendiente: ["La muestra M-2 no tiene documento."] }),
    ).toEqual(["La muestra M-2 no tiene documento."]);
  });
});
