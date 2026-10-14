import { evaluarFormula } from "../common/formula";
import { camposDe, traducirFormula } from "./formula-legado";

describe("fórmulas del LIMS antiguo · traducirFormula", () => {
  it("sin fórmula → null", () => {
    expect(traducirFormula(null)).toMatchObject({ expr: null, origen: null });
    expect(traducirFormula("  ")).toMatchObject({ expr: null });
  });

  it("una fórmula ya escrita para el motor se respeta", () => {
    expect(traducirFormula("PROMEDIO(RN) * 100")).toMatchObject({ expr: "PROMEDIO(RN) * 100", origen: "motor", nCampos: 0 });
    expect(traducirFormula("(C1 - C2) / C3")).toMatchObject({ origen: "motor", nCampos: 3 });
  });

  it("patrón más frecuente (315 analitos): un campo por lectura", () => {
    const t = traducirFormula(":IF Len(sSql)=1; Acum := Acum + val(sSql[1,2]) ; :ENDIF;");
    expect(t).toMatchObject({ expr: "C1", origen: "legado", nCampos: 1 });
  });

  it("producto de dos campos con mensaje de error del LIMS antiguo", () => {
    const t = traducirFormula(
      ':IF Len(sSql) = 2; Acum := Acum + (Val(sSql[1,2]) * Val(sSql[2,2])); :ELSE; UsrMes("Mensaje","Falta ingresar valores a Los parámetros en Lectura No. "+Str(Lect[k,1])); :ENDIF;',
    );
    expect(t.expr).toBe("(C1 * C2)");
    expect(evaluarFormula(t.expr!, { C1: 3, C2: 4 })).toBe(12);
  });

  it("porcentaje con mayúsculas mezcladas (sSQL) y guarda de división", () => {
    const t = traducirFormula(
      ":IF Len(sSql)= 3; :IF Val(sSQL[3,2]) <> 0 ; Acum := Acum + ( Val(sSQL[1,2]) * Val(sSQL[2,2])) / ( ( Val(sSQL[3,2]) ) * 100 ) ; :ENDIF; :ENDIF;",
    );
    expect(t.nCampos).toBe(3);
    expect(evaluarFormula(t.expr!, { C1: 10, C2: 20, C3: 2 })).toBeCloseTo(1, 10);
  });

  it("variables intermedias (form1 := …) y comentarios /* … ;", () => {
    const t = traducirFormula(
      "/* A Volumen de arena usada en L 1,2; /* B Espesor de la pelicula en mm 2,2; :DECLARE form1; :IF Len(sSql)= 2; form1:= Val(sSql[1,2]) / Val(sSql[2,2]); Acum := Acum + form1; :ENDIF;",
    );
    expect(t.origen).toBe("legado");
    expect(evaluarFormula(t.expr!, { C1: 10, C2: 4 })).toBe(2.5);
  });

  it("la guarda «:ELSE; acum := 0» no impide traducir", () => {
    const t = traducirFormula(
      ':IF Len(sSql) = 2; :IF val(sSql[2,2])>0; Acum := Acum + (Val(sSql[1,2]) / Val(sSql[2,2])); :ELSE; acum :=0; :ENDIF; :ENDIF;',
    );
    expect(t.expr).toBe("(C1 / C2)");
  });

  it("Sqrt → RAIZ", () => {
    const t = traducirFormula(":IF Len(sSql)=1; xx:=val(sSql[1,2]); Acum := Acum + Sqrt( xx * 4 ); :ENDIF;");
    expect(evaluarFormula(t.expr!, { C1: 4 })).toBe(4);
  });

  it("NO traduce guiones que leen tablas o acumulan de otra forma", () => {
    expect(traducirFormula(':DECLARE Resu; Resu := 0; ExecFunction("GCALCULO",{.F.}); :LABELEND; Resu').expr).toBeNull();
    expect(traducirFormula(":IF Len(sSql)=1; Acum := Acum + Val(sSql[1,1]) ; :ENDIF;").expr).toBeNull();
    const t = traducirFormula("Acum := Acum + Val(sSql[1,2]); Acum := Acum - ((Acum * 30) /100 );");
    expect(t.expr).toBeNull();
    expect(t.motivo).toBeTruthy();
  });

  it("camposDe cuenta el mayor Cn", () => {
    expect(camposDe("C1 + C3")).toBe(3);
    expect(camposDe("PROMEDIO(RN)")).toBe(0);
  });
});
