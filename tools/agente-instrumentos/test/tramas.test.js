"use strict";
// Pruebas del agente: npm test (node --test)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Ensamblador, interpretar, limpiar } = require("../lib/tramas");
const { tramaPrueba } = require("../lib/simulacion");

test("el ensamblador corta por terminador aunque la trama llegue en trozos", () => {
  const e = new Ensamblador({ terminador: "LF" });
  assert.deepEqual(e.agregar("\u0002M-1;pH;7,0"), []);
  assert.deepEqual(e.agregar("2;pH\u0003\r\n\u0002M-2;pH;6,9"), ["M-1;pH;7,02;pH"]);
  assert.deepEqual(e.vaciar(), ["M-2;pH;6,9"]);
  assert.deepEqual(e.vaciar(), []);
});

test("terminador ETX y tramas a ignorar", () => {
  const e = new Ensamblador({ terminador: "ETX", ignorar: ["^OK$"] });
  assert.deepEqual(e.agregar("\u0002OK\u0003\u0002M-1;pH;7,1\u0003"), ["M-1;pH;7,1"]);
});

test("limpia los caracteres de control y conserva el tabulador", () => {
  assert.equal(limpiar("\u0006 M-1\tpH\t7.1 \r"), "M-1\tpH\t7.1");
});

test("lectura local con el perfil: columnas por número o por cabecera", () => {
  const perfilNum = { formato: "TXT", separador: ";", colMuestra: "1", colEnsayo: "2", colValor: "3", colUnidad: "4" };
  assert.deepEqual(interpretar("M-1;pH;7,02;pH", perfilNum), { muestra: "M-1", ensayo: "pH", valor: "7,02", unidad: "pH" });
  const perfilCab = { formato: "CSV", separador: "auto", colMuestra: "Muestra", colEnsayo: null, ensayoFijo: "Masa", colValor: "Peso" };
  assert.deepEqual(interpretar("M-9,12.5", perfilCab, "Muestra,Peso"), { muestra: "M-9", ensayo: "Masa", valor: "12.5", unidad: null });
  assert.equal(interpretar("estado: listo", perfilNum), null);
  assert.equal(interpretar("<r/>", { formato: "XML" }), null);
});

test("la trama PRUEBA del simulador se ensambla y se interpreta", () => {
  const e = new Ensamblador({ terminador: "LF" });
  const [t] = e.agregar(tramaPrueba("M-PRUEBA-0001", "pH", ";", 0));
  const l = interpretar(t, { formato: "TXT", separador: ";", colMuestra: "1", colEnsayo: "2", colValor: "3" });
  assert.equal(l.muestra, "M-PRUEBA-0001");
  assert.equal(l.ensayo, "pH");
  assert.match(l.valor, /^\d+,\d{2}$/);
});
