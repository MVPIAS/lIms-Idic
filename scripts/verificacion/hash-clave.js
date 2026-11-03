#!/usr/bin/env node
/**
 * Hash argon2id de una clave (la de CLAVE_DEMO o la embebida), con los mismos
 * parámetros que el LIMS, para sembrar usuarios de prueba con contraseña propia
 * (carga-1000-usuarios.sql). Uso: node scripts/verificacion/hash-clave.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const raiz = path.resolve(__dirname, "..", "..");
const argon2 = require(require.resolve("argon2", { paths: [path.join(raiz, "apps/api")] }));
const src = fs.readFileSync(path.join(raiz, "apps/api/src/auth/auth.service.ts"), "utf8");
const clave = process.env.CLAVE_DEMO || src.match(/CLAVE_DEMO_EMBEBIDA\s*=\s*"([^"]+)"/)[1];
argon2.hash(clave, { type: argon2.argon2id }).then((h) => process.stdout.write(h));
