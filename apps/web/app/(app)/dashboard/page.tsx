export default function DashboardPage() {
  const kpis = [
    { label: "Cotizaciones del mes", val: "142", delta: "▲ 18%", color: "blue" },
    { label: "Por vencer (<7 días)", val: "5", delta: "", color: "amber" },
    { label: "OT activas", val: "87", delta: "▲ 12", color: "green" },
    { label: "Clientes bloqueados", val: "7", delta: "$7.5 M", color: "red" },
    { label: "Facturado mes", val: "$48 M", delta: "▲ 14%", color: "violet" },
    { label: "Tiempo medio cotizar", val: "2.1d", delta: "▼ 0.3 d", color: "" },
  ];

  const colorBorder: Record<string, string> = {
    blue: "border-l-[#2b65d9]",
    amber: "border-l-warn",
    green: "border-l-success",
    red: "border-l-danger",
    violet: "border-l-[#7057c8]",
    "": "border-l-accent",
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Dashboard · DCO</h1>
      <p className="text-sm text-slate-500 mb-5">
        El módulo Comercial es por donde entra todo el flujo del sistema.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {kpis.map((k) => (
          <div
            key={k.label}
            className={`bg-white border border-l-4 ${
              colorBorder[k.color] ?? "border-l-accent"
            } rounded-lg p-3.5 shadow-sm`}
          >
            <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">
              {k.label}
            </div>
            <div className="text-2xl font-bold mt-1">{k.val}</div>
            {k.delta && <div className="text-xs text-slate-500 mt-0.5">{k.delta}</div>}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border p-5 shadow-sm">
        <h2 className="font-bold mb-3">Acciones rápidas</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <a
            href="/cotizaciones/nueva"
            className="block bg-slate-50 hover:bg-slate-100 border rounded-lg p-4 transition"
          >
            <div className="text-2xl mb-1">＋</div>
            <h3 className="font-semibold text-sm">Nueva Cotización</h3>
            <p className="text-xs text-slate-500">Wizard 4 pasos</p>
          </a>
          <a
            href="/ot/nueva"
            className="block bg-slate-50 hover:bg-slate-100 border rounded-lg p-4 transition"
          >
            <div className="text-2xl mb-1">＋</div>
            <h3 className="font-semibold text-sm">Nueva OT</h3>
            <p className="text-xs text-slate-500">Desde cotización aceptada</p>
          </a>
          <a
            href="/clientes-bloqueados"
            className="block bg-slate-50 hover:bg-slate-100 border rounded-lg p-4 transition"
          >
            <div className="text-2xl mb-1">🚫</div>
            <h3 className="font-semibold text-sm">Verificar bloqueos</h3>
            <p className="text-xs text-slate-500">Antes de cotizar</p>
          </a>
        </div>
      </div>
    </div>
  );
}
