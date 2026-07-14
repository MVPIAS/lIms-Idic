"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Topbar() {
  const [user, setUser] = useState<{ nombreCompleto?: string; cargo?: string; grado?: string } | null>(null);

  useEffect(() => {
    setUser(api.getUser());
  }, []);

  const iniciales = user?.nombreCompleto
    ? user.nombreCompleto.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "AD";

  return (
    <div className="flex items-center px-5 gap-4 h-full">
      <div className="flex-1 text-sm text-slate-500">
        <b className="text-slate-800">LIMS IDIC</b> · Sistema unificado Comercial + Laboratorio
      </div>
      <input
        type="search"
        placeholder="Buscar cliente, OT, muestra…"
        className="w-72 px-3 py-1.5 border rounded text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center font-semibold text-xs">
          {iniciales}
        </div>
        <div className="text-xs leading-tight">
          <div className="font-semibold">{user?.nombreCompleto ?? "Administrador"}</div>
          <div className="text-slate-500">{user?.grado ?? user?.cargo ?? "SUPERADMIN"}</div>
        </div>
        <button
          onClick={() => api.logout()}
          className="ml-2 text-xs text-slate-500 hover:text-danger border rounded px-2 py-1"
          title="Cerrar sesión"
        >
          Salir
        </button>
      </div>
    </div>
  );
}
