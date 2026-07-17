/**
 * Configuración de Jest para @lims-idic/api.
 *
 * Usa ts-jest para compilar los specs TypeScript (el repo ya trae ts-jest y
 * @types/jest en devDependencies). Sin esta configuración, `jest` caía a Babel
 * y no parseaba TS, por lo que `formula.spec.ts` no se ejecutaba.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src"],
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
        // Los specs están excluidos del build (tsconfig.exclude); ts-jest los
        // compila igual porque recibe los archivos directamente de Jest.
        isolatedModules: true,
      },
    ],
  },
};
