"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";

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

const bisagra = [
  { href: "/catalogo/paneles", nivel: "Bisagra", nombre: "Paneles de ensayo", desc: "Qué Métodos (y Ensayo) se aplican a cada Elemento. Es lo que ofrece el registro de OT." },
  { href: "/catalogo/formulas", nivel: "Cálculo", nombre: "Fórmulas", desc: "Fórmulas de cálculo de los analitos, con validación." },
  { href: "/catalogo/pasos", nivel: "Captura", nombre: "Pasos por método", desc: "Campos que el analista captura en cada método." },
  { href: "/catalogo/parametros", nivel: "Sistema", nombre: "Parámetros", desc: "Listas y combos editables (tipo de cliente, forma de pago…)." },
];

// Frente f5: tarifas del Sistema Comercial antiguo (HH, HM y servicios primarios).
const tarifas = [
  { href: "/catalogo/tarifas-hh", nivel: "Tarifa", nombre: "Horas hombre (HH)", desc: "Valor de la hora hombre por categoría, en CLP y con vigencia." },
  { href: "/catalogo/perfiles-hh", nivel: "Tarifa", nombre: "Perfiles HH", desc: "Ajuste % de la hora hombre por perfil (civil, militar)." },
  { href: "/catalogo/tarifas-hm", nivel: "Tarifa", nombre: "Horas máquina (HM)", desc: "Valor de la hora de uso de cada equipo (EQ###)." },
  { href: "/catalogo/servicios-primarios", nivel: "Tarifa", nombre: "Servicios primarios", desc: "Precio de los servicios primarios por código y centro de costo." },
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
      <PageHeader
        titulo="Catálogo maestro"
        migas={[{ label: "Tablas maestras" }, { label: "Índice" }]}
        subtitulo="Las tablas maestras del catálogo, organizadas en dos ejes que se unen en la Muestra. Cada maestra permite listar, crear, editar y eliminar registros."
      />

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

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "22px 0 10px" }}>Unión y configuración</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {bisagra.map((t) => <Tarjeta key={t.href} {...t} />)}
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "22px 0 10px" }}>Tarifas</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {tarifas.map((t) => <Tarjeta key={t.href} {...t} />)}
      </div>
    </div>
  );
}
