/**
 * PostCSS · procesa Tailwind + Autoprefixer en el build de Next.js.
 * Sin este archivo, las directivas @tailwind se envían SIN COMPILAR y el
 * navegador las ignora -> la app se renderiza sin estilos (bug crítico).
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
