"use client";

import Link from "next/link";

const productos = [
  { href: "/catalogo/gran-grupos", nivel: "Nivel 1", nombre: "Gran Grupos", desc: "Máxima agrupación de productos / matrices." },
  { href: "/catalogo/grupos", nivel: "Nivel 2", nombre: "Grupos", desc: "Cuelgan de un Gran Grupo." },
  { href: "/catalogo/subgrupos", nivel: "Nivel 3", nombre: "SubGrupos", desc: "Cuelgan de un Grupo." },
  { href: "/catalogo/elementos", nivel: "Nivel 4", nombre: "Elementos", desc: "Hoja del árbol. Cuelgan de un SubGrupo (+ Familia opcional)." },
  { href: "/catalogo/familias", nivel: "Transversal", nombre: "Familias", desc: "Laboratorio / departamento / subdirección asociable a Elementos." },
];

const analisis = [
  { href: "/catalogo/ensayos", nivel: "Nivel 1", nombre: "Ensayos", desc: "Ensayo con precio; puede asociarse a una Familia." },
  { href: "/catalogo/metodos", nivel: "Nivel 2", nombre: "Métodos", desc: "Método analítico (norma, instrumento). Cuelga de un Ensayo." },
  { href: "/catalogo/analitos", nivel: "Nivel 3", nombre: "Analitos", desc: "Parámetro medible de un Método (unidad, rangos)." },
  { href: "/catalogo/especificaciones", nivel: "Nivel 4", nombre: "Especificaciones", desc: "Límites/requisitos de un Analito por ámbito." },
];

function Tarjeta({ href, nivel, nombre, desc }: { href: string; nivel: string; nombre: string; desc: string }) {
  return (
    <Link href={href as any} className="card" style={{ textDecoration: "none", color: "inherit", display: "block", marginBottom: 0 }}>
      <span className="pill gray" style={{ marginBottom: 6, display: "inline-block" }}>{nivel}</span>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{nombre}</div>
      <div className="subtitle" style={{ margin: 0 }}>{desc}</div>
    </Link>
  );
}

export default function CatalogoPage() {
  return (
    <div>
      <h1 className="page">Catálogo maestro (v2)</h1>
      <p className="subtitle">
        Gestión de las 9 tablas maestras del catálogo, organizadas en dos ejes que se unen en la Muestra.
        Cada maestra permite listar, crear, editar y eliminar registros.
      </p>

      <div className="alert info">
        <strong>Cascada del catálogo.</strong>{" "}
        <b>Producto:</b> Gran Grupo → Grupo → SubGrupo → Elemento (+ Familia / Laboratorio).{" "}
        <b>Análisis:</b> Ensayo → Método → Analito → Especificación.
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "18px 0 10px" }}>Eje Producto</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {productos.map((t) => <Tarjeta key={t.href} {...t} />)}
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "22px 0 10px" }}>Eje Análisis</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {analisis.map((t) => <Tarjeta key={t.href} {...t} />)}
      </div>
    </div>
  );
}
