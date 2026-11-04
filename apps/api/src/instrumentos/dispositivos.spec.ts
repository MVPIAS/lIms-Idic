import { leerArchivo } from "./lector";
import { IngestaError, PREFIJO_TOKEN, datosDispositivo, generarToken, hashToken, limpiarTrama, textoDeLecturas, tokenDeCabeceras } from "./dispositivos";

describe("instrumentos · dispositivos serie/Ethernet (§4.4.7)", () => {
  it("el token se genera con prefijo y se guarda solo su SHA-256", () => {
    const t = generarToken();
    expect(t.token.startsWith(PREFIJO_TOKEN)).toBe(true);
    expect(t.token.length).toBeGreaterThan(40);
    expect(t.hash).toBe(hashToken(t.token));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.token.startsWith(t.prefijo)).toBe(true);
    expect(generarToken().token).not.toBe(t.token);
  });

  it("lee el token del Authorization o de X-Token-Dispositivo; un JWT no sirve", () => {
    expect(tokenDeCabeceras({ authorization: "Bearer lims_disp_abc" })).toBe("lims_disp_abc");
    expect(tokenDeCabeceras({ "x-token-dispositivo": " lims_disp_xyz " })).toBe("lims_disp_xyz");
    expect(tokenDeCabeceras({ authorization: "Bearer eyJhbGciOi.x.y" })).toBeNull();
    expect(tokenDeCabeceras({})).toBeNull();
    expect(tokenDeCabeceras(undefined)).toBeNull();
  });

  it("limpia los caracteres de control de la trama y conserva el tabulador", () => {
    expect(limpiarTrama("\u0002M-1;pH;7,02\u0003\r\n")).toBe("M-1;pH;7,02");
    expect(limpiarTrama("M-1\tpH\t7.02")).toBe("M-1\tpH\t7.02");
    expect(limpiarTrama("\u0006")).toBe("");
  });

  it("perfil sin cabecera: una trama por línea, interpretable con el lector de archivos", () => {
    const { texto, tramas } = textoDeLecturas({ tramas: ["\u0002M-PRUEBA-1;pH;7,02\u0003", "", "M-PRUEBA-2;pH;6,95"] }, { formato: "TXT", filaCabecera: 0 });
    expect(tramas).toBe(2);
    const filas = leerArchivo(texto, { formato: "TXT", separador: ";", decimal: ",", filaCabecera: 0, colMuestra: "1", colEnsayo: "2", colValor: "3" });
    expect(filas.map((f) => [f.muestra, f.ensayo, f.valor])).toEqual([
      ["M-PRUEBA-1", "pH", "7,02"],
      ["M-PRUEBA-2", "pH", "6,95"],
    ]);
  });

  it("perfil con cabecera: el agente la envía y se pone en su fila", () => {
    const { texto } = textoDeLecturas({ tramas: ["M-1,Humedad,12.5"], cabecera: "Muestra,Ensayo,Valor" }, { formato: "CSV", filaCabecera: 2 });
    expect(texto).toBe("\nMuestra,Ensayo,Valor\nM-1,Humedad,12.5");
    const filas = leerArchivo(texto, { formato: "CSV", separador: ",", decimal: ".", filaCabecera: 2, colMuestra: "Muestra", colEnsayo: "Ensayo", colValor: "Valor" });
    expect(filas[0]).toMatchObject({ muestra: "M-1", ensayo: "Humedad", valor: "12,5" });
    expect(() => textoDeLecturas({ tramas: ["x"] }, { formato: "CSV", filaCabecera: 1 })).toThrow(/espera la cabecera en la fila 1/);
  });

  it("rechaza envíos vacíos o mal formados", () => {
    expect(() => textoDeLecturas({}, { formato: "TXT", filaCabecera: 0 })).toThrow(IngestaError);
    expect(() => textoDeLecturas({ tramas: [1] }, { formato: "TXT", filaCabecera: 0 })).toThrow("Cada trama debe ser texto.");
    expect(() => textoDeLecturas({ tramas: ["\u0002\u0003"] }, { formato: "TXT", filaCabecera: 0 })).toThrow("Las tramas recibidas no traen datos.");
  });

  it("valida el alta del dispositivo", () => {
    const perfilId = "11111111-2222-4333-8444-555555555555";
    expect(datosDispositivo({ nombre: " pHmetro PRUEBA ", perfilId })).toEqual({ perfilId, nombre: "pHmetro PRUEBA", conexion: "SERIE", ubicacion: null });
    expect(datosDispositivo({ nombre: "Balanza", perfilId, conexion: "ETHERNET", ubicacion: "Sala 2" }).conexion).toBe("ETHERNET");
    expect(() => datosDispositivo({ nombre: "ab", perfilId })).toThrow("Indique el nombre del dispositivo (mínimo 3 caracteres).");
    expect(() => datosDispositivo({ nombre: "Balanza", perfilId: "x" })).toThrow("Elija el perfil del instrumento.");
    expect(() => datosDispositivo({ nombre: "Balanza", perfilId, conexion: "USB" })).toThrow(/Conexión/);
  });
});
