"use strict";
/**
 * Conexión con el LIMS: saludo (GET /instrumentos/agente/yo) y envío de las
 * tramas por lotes (POST /instrumentos/agente/lecturas) con el token del
 * dispositivo. Las tramas que no se pudieron enviar (red caída, LIMS
 * detenido) quedan en una cola en disco y se reintentan: no se pierde nada.
 */
const fs = require("fs");
const path = require("path");

const VERSION = require("../package.json").version;

class ErrorLims extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.estado = estado;
  }
}

class ClienteLims {
  /**
   * @param {{ url: string, token: string }} lims
   * @param {{ loteSegundos?: number, maxTramas?: number, cabecera?: string|null, archivoCola?: string }} envio
   * @param {(nivel: string, texto: string) => void} log
   */
  constructor(lims, envio, log) {
    if (!lims || !lims.url || !lims.token) throw new Error("Falta lims.url o lims.token en la configuración.");
    this.url = String(lims.url).replace(/\/+$/, "");
    this.token = lims.token;
    this.loteMs = Math.max(2, Number(envio.loteSegundos) || 15) * 1000;
    this.maxTramas = Math.min(2000, Math.max(1, Number(envio.maxTramas) || 200));
    this.cabecera = envio.cabecera || null;
    this.archivoCola = envio.archivoCola || path.join(process.cwd(), "cola-pendiente.json");
    this.log = log;
    this.cola = this.leerCola();
    this.reloj = null;
    this.enviando = false;
  }

  async pedir(metodo, ruta, cuerpo) {
    const r = await fetch(`${this.url}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", "X-Agente-Version": VERSION },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = Array.isArray(datos.message) ? datos.message.join("; ") : datos.message;
      throw new ErrorLims(m || `El LIMS respondió ${r.status}.`, r.status);
    }
    return datos;
  }

  /** Confirma el token y trae el dispositivo y el perfil del instrumento. */
  saludo() {
    return this.pedir("GET", "/instrumentos/agente/yo");
  }

  /** Agrega una trama a la cola; se envía al completar el lote o al vencer el plazo. */
  agregar(trama) {
    this.cola.push({ t: trama, en: new Date().toISOString() });
    this.guardarCola();
    if (this.cola.length >= this.maxTramas) void this.enviar();
    else if (!this.reloj) this.reloj = setTimeout(() => void this.enviar(), this.loteMs);
  }

  async enviar() {
    if (this.reloj) clearTimeout(this.reloj);
    this.reloj = null;
    if (this.enviando || !this.cola.length) return;
    this.enviando = true;
    const lote = this.cola.slice(0, this.maxTramas);
    try {
      const r = await this.pedir("POST", "/instrumentos/agente/lecturas", { tramas: lote.map((x) => x.t), ...(this.cabecera ? { cabecera: this.cabecera } : {}) });
      this.cola = this.cola.slice(lote.length);
      this.guardarCola();
      const resumen = Object.entries(r.resumen || {}).map(([k, n]) => `${k}: ${n}`).join(", ");
      if (r.estado === "ERROR") this.log("aviso", `Lote de ${lote.length} trama(s) recibido, pero no encaja con el perfil: ${r.mensaje}`);
      else this.log("info", `Lote de ${lote.length} trama(s) enviado al LIMS; queda pendiente de revisión (${resumen || "sin filas"}).`);
    } catch (e) {
      if (e instanceof ErrorLims && e.estado === 401) {
        this.log("error", `${e.message} Pida un token nuevo en «Datos de instrumentos › Dispositivos conectados». Las tramas siguen en la cola.`);
      } else if (e instanceof ErrorLims && e.estado >= 400 && e.estado < 500 && e.estado !== 429) {
        // El LIMS rechazó el contenido: reintentar no cambia nada. Se aparta para revisarlo a mano.
        this.log("error", `El LIMS rechazó el lote: ${e.message}. Las tramas se guardan en rechazadas.json.`);
        this.apartar(lote);
        this.cola = this.cola.slice(lote.length);
        this.guardarCola();
      } else {
        this.log("aviso", `No se pudo enviar (${e.message}); se reintenta en ${this.loteMs / 1000} s. Tramas en cola: ${this.cola.length}.`);
      }
    } finally {
      this.enviando = false;
      if (this.cola.length && !this.reloj) this.reloj = setTimeout(() => void this.enviar(), this.loteMs);
    }
  }

  leerCola() {
    try {
      const c = JSON.parse(fs.readFileSync(this.archivoCola, "utf8"));
      return Array.isArray(c) ? c : [];
    } catch {
      return [];
    }
  }

  guardarCola() {
    try {
      fs.writeFileSync(this.archivoCola, JSON.stringify(this.cola));
    } catch (e) {
      this.log("aviso", `No se pudo guardar la cola en disco: ${e.message}`);
    }
  }

  apartar(lote) {
    const archivo = path.join(path.dirname(this.archivoCola), "rechazadas.json");
    let previas = [];
    try {
      previas = JSON.parse(fs.readFileSync(archivo, "utf8"));
    } catch {
      /* sin archivo previo */
    }
    fs.writeFileSync(archivo, JSON.stringify([...previas, ...lote], null, 1));
  }
}

module.exports = { ClienteLims, ErrorLims, VERSION };
