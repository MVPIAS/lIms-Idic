import { ConflictException } from "@nestjs/common";
import { defConfigurable } from "../catalogo/parametro-configurable";
import { bloqueosQcDeOt, exigirQcParaEjecutar, faltantesQcMetodo, mensajeBloqueoQc, modoBloqueoQc, textoFaltantes } from "./qc-ejecucion";

/** BD de mentira: responde según el texto de la consulta. */
function db(o: { modo?: string | null; metodos?: any[]; aprobados?: any[]; resultado?: any }) {
  return {
    $queryRawUnsafe: jest.fn(async (q: string) => {
      if (q.includes("parametro_sistema")) return o.modo === undefined ? [] : [{ valor: o.modo }];
      if (q.includes("FROM resultado r")) return o.resultado ? [o.resultado] : [];
      if (q.includes("FROM cat_metodo")) return o.metodos ?? [];
      if (q.includes("FROM qc_control")) return o.aprobados ?? [];
      if (q.includes("FROM orden_trabajo")) return [{ codigo: "OT-PRUEBA-1" }];
      return [];
    }),
  } as any;
}
const MET = { id: "m1", codigo: "LQC-01", nombre: "Proteína PRUEBA", qc_tipos: ["blanco", "curva"] };

describe("QC en la ejecución · parámetro qc.bloqueo", () => {
  it("por defecto bloquea la ejecución (contrato §4.2.4); «informe» vuelve a la regla anterior", () => {
    expect(modoBloqueoQc(undefined)).toBe("ejecucion");
    expect(modoBloqueoQc("")).toBe("ejecucion");
    expect(modoBloqueoQc("cualquier cosa")).toBe("ejecucion");
    expect(modoBloqueoQc(" Informe ")).toBe("informe");
  });
  it("se edita en «Parámetros del sistema» (y el motivo de los métodos también)", () => {
    expect(defConfigurable("qc", "bloqueo")).toMatchObject({ tipo: "opcion", porDefecto: "ejecucion" });
    expect(defConfigurable("metodo_version", "motivo")).toMatchObject({ tipo: "opcion", porDefecto: "obligatorio" });
  });
});

describe("QC en la ejecución · qué falta", () => {
  it("un método sin QC requerido nunca bloquea", () => {
    expect(faltantesQcMetodo(false, ["blanco"], [])).toEqual([]);
  });
  it("con tipos exigidos, falta cada tipo sin control aprobado", () => {
    expect(faltantesQcMetodo(true, ["blanco", "curva"], ["blanco"])).toEqual(["curva"]);
    expect(faltantesQcMetodo(true, ["blanco", "curva"], ["curva", "blanco"])).toEqual([]);
  });
  it("sin tipos marcados basta uno aprobado de cualquier tipo", () => {
    expect(faltantesQcMetodo(true, [], [])).toEqual(["cualquiera"]);
    expect(faltantesQcMetodo(true, null, ["duplicado"])).toEqual([]);
  });
  it("el mensaje dice el método, la OT, la acción y lo que falta en español", () => {
    expect(textoFaltantes(["curva", "mrc"])).toBe("curva de calibración, material de referencia certificado (MRC)");
    const m = mensajeBloqueoQc({ codigo: "LQC-01", nombre: "Proteína" }, ["blanco"], "aprobacion", "OT-1");
    expect(m).toMatch(/^Control de calidad pendiente: el método LQC-01 · Proteína/);
    expect(m).toMatch(/en la OT OT-1 antes de aprobar sus resultados \(falta: blanco\)/);
    expect(m).toMatch(/«Control de calidad \(QC\)»/);
    expect(mensajeBloqueoQc({ codigo: "X", nombre: "Y" }, ["cualquiera"], "captura")).toMatch(/en esta OT antes de capturar .*un control aprobado de cualquier tipo/);
  });
});

describe("QC en la ejecución · acceso a BD", () => {
  it("lista los métodos de la OT a los que les falta QC aprobado", async () => {
    const b = await bloqueosQcDeOt(db({ metodos: [MET], aprobados: [{ cat_metodo_id: "m1", tipo: "blanco" }] }), "t", "ot", ["m1", "m1"]);
    expect(b.get("m1")?.faltan).toEqual(["curva"]);
    expect(b.get("m1")?.mensaje).toMatch(/OT-PRUEBA-1 antes de capturar/);
  });
  it("con todo aprobado, o con el parámetro en «informe», no bloquea", async () => {
    const todo = [{ cat_metodo_id: "m1", tipo: "blanco" }, { cat_metodo_id: "m1", tipo: "curva" }];
    expect((await bloqueosQcDeOt(db({ metodos: [MET], aprobados: todo }), "t", "ot", ["m1"])).size).toBe(0);
    expect((await bloqueosQcDeOt(db({ modo: "informe", metodos: [MET] }), "t", "ot", ["m1"])).size).toBe(0);
  });
  it("captura/aprobación de un resultado del método: 409 QC_PENDIENTE con el motivo", async () => {
    const d = db({ metodos: [MET], resultado: { cat_metodo_id: "m1", ot_id: "ot", tenant_id: "t" } });
    const e = await exigirQcParaEjecutar(d, null, "r1", "revision").catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getResponse()).toMatchObject({ codigo: "QC_PENDIENTE", otId: "ot", faltan: ["blanco", "curva"] });
    expect(e.message).toMatch(/antes de revisar sus resultados/);
  });
  it("un resultado sin método de catálogo o sin OT no se bloquea", async () => {
    await expect(exigirQcParaEjecutar(db({ metodos: [MET], resultado: { cat_metodo_id: null, ot_id: "ot", tenant_id: "t" } }), "t", "r", "captura")).resolves.toBeUndefined();
    await expect(exigirQcParaEjecutar(db({ metodos: [MET], resultado: { cat_metodo_id: "m1", ot_id: null, tenant_id: "t" } }), "t", "r", "captura")).resolves.toBeUndefined();
  });
});
