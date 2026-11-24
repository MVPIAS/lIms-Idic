import { buscarDocumento, DOCUMENTOS_INTEGRACION, GRUPO_ARMAS, listarDocumentos } from "./documentacion-integracion";

describe("documentación adjunta de integraciones", () => {
  it("todos los archivos de la lista existen", () => {
    expect(listarDocumentos()).toHaveLength(DOCUMENTOS_INTEGRACION.length);
  });
  it("solo sirve nombres de la lista cerrada", () => {
    expect(buscarDocumento(GRUPO_ARMAS, "../../../package.json")).toBeNull();
    expect(buscarDocumento(GRUPO_ARMAS, "otro.docx")).toBeNull();
    expect(buscarDocumento("otro", DOCUMENTOS_INTEGRACION[0].archivo)).toBeNull();
    expect(buscarDocumento(GRUPO_ARMAS, DOCUMENTOS_INTEGRACION[0].archivo)).not.toBeNull();
  });
});
