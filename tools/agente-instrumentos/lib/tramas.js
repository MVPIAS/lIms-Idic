"use strict";
/**
 * Tramas de un instrumento · funciones puras (probadas en test/tramas.test.js).
 *
 * Un equipo serie o Ethernet envía un flujo de bytes; una «trama» es un
 * mensaje completo (normalmente una lectura). El ensamblador corta el flujo
 * en tramas por el terminador configurado (CR/LF, ETX…) o por silencio, y
 * limpia los caracteres de control del protocolo (STX, ETX, ACK…).
 *
 * La interpretación definitiva (muestra, ensayo, valor) la hace el LIMS con el
 * perfil del instrumento; aquí se hace una lectura local con el mismo perfil
 * solo para mostrarla en el registro del agente y descartar el ruido.
 */

const CONTROL = { STX: "\u0002", ETX: "\u0003", EOT: "\u0004", ENQ: "\u0005", ACK: "\u0006", NAK: "\u0015", CR: "\r", LF: "\n", CRLF: "\r\n" };

/** Terminador configurado («CRLF», «LF», «CR», «ETX», «EOT» o el texto literal). */
function terminador(nombre) {
  if (!nombre) return "\n";
  const k = String(nombre).toUpperCase();
  if (CONTROL[k]) return CONTROL[k];
  return String(nombre).replace(/\\r/g, "\r").replace(/\\n/g, "\n");
}

/** Quita los caracteres de control (conserva el tabulador) y los espacios de los extremos. */
function limpiar(t) {
  return String(t).replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, "").trim();
}

/**
 * Ensamblador de tramas: se le dan trozos de texto tal como llegan del puerto
 * (`agregar`) y devuelve las tramas completas. `vaciar` entrega lo que quedó a
 * medias (se llama tras un silencio del equipo).
 */
class Ensamblador {
  constructor(opciones = {}) {
    this.fin = terminador(opciones.terminador);
    this.ignorar = (opciones.ignorar || []).map((r) => new RegExp(r));
    this.resto = "";
  }

  agregar(trozo) {
    this.resto += trozo;
    const salida = [];
    let i;
    while ((i = this.resto.indexOf(this.fin)) >= 0) {
      salida.push(this.resto.slice(0, i));
      this.resto = this.resto.slice(i + this.fin.length);
    }
    // Con CRLF o LF, un CR o LF suelto no parte la trama, pero se limpia después.
    return this.filtrar(salida);
  }

  vaciar() {
    const r = this.resto;
    this.resto = "";
    return this.filtrar([r]);
  }

  filtrar(tramas) {
    return tramas.map(limpiar).filter((t) => t && !this.ignorar.some((re) => re.test(t)));
  }
}

/* ----------------------------------------------- lectura local con el perfil --- */

function detectarSeparador(linea) {
  const opciones = ["\t", ";", ",", "|"].map((c) => [c, linea.split(c).length - 1]).sort((a, b) => b[1] - a[1]);
  return opciones[0][1] > 0 ? opciones[0][0] : "espacios";
}

function dividir(linea, sep) {
  if (sep === "espacios") return linea.trim().split(/\s{2,}|\t/).map((x) => x.trim());
  return linea.split(sep).map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
}

function sinTildes(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Índice de una columna por número (1..) o por nombre en la cabecera. */
function indice(col, cabecera) {
  if (!col) return -1;
  const t = String(col).trim();
  if (/^\d{1,3}$/.test(t)) return Number(t) - 1;
  if (!cabecera) return -1;
  return cabecera.findIndex((h) => sinTildes(h) === sinTildes(t));
}

/**
 * Lectura local de una trama con el perfil (CSV/TXT): { muestra, ensayo, valor }
 * o null si no se reconoce. En XML no se intenta (se envía tal cual).
 */
function interpretar(trama, perfil, cabeceraTexto) {
  if (!perfil || perfil.formato === "XML") return null;
  const sep = !perfil.separador || perfil.separador === "auto" ? detectarSeparador(cabeceraTexto || trama) : perfil.separador;
  const cabecera = cabeceraTexto ? dividir(cabeceraTexto, sep) : null;
  const c = dividir(trama, sep);
  const g = (col) => {
    const i = indice(col, cabecera);
    return i >= 0 ? c[i] || "" : "";
  };
  const muestra = g(perfil.colMuestra);
  const valor = g(perfil.colValor);
  const ensayo = g(perfil.colEnsayo) || perfil.ensayoFijo || "";
  if (!muestra || !valor) return null;
  return { muestra, ensayo, valor, unidad: g(perfil.colUnidad) || null };
}

module.exports = { CONTROL, terminador, limpiar, Ensamblador, interpretar, detectarSeparador };
