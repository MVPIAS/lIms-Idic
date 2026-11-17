/**
 * Iniciales para el avatar de una persona: la primera letra de las dos primeras
 * palabras que empiezan con letra. Ignora paréntesis, números y signos, así
 * «Abastecimiento (prueba)» da «AP» y no «A(». Sin letras: «··».
 */
export function iniciales(nombre: string | null | undefined): string {
  return (
    (nombre ?? "")
      .split(/\s+/)
      .map((w) => w.replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/, ""))
      .filter((w) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(w))
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "··"
  );
}
