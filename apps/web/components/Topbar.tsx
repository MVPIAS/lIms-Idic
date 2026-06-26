"use client";
import { useEffect, useState } from "react";

export default function Topbar() {
  const [user, setUser] = useState<{ nombreCompleto?: string; cargo?: string } | null>(null);

  useEffect(() => {
    const u = localStorage.getItem("user");
    if (u) setUser(JSON.parse(u));
  }, []);

  return (
    <div className="flex items-center px-5 gap-4 h-full">
      <div className="flex-1 text-sm text-slate-500">
        <b className="text-slate-800">LIMS IDIC · Comercial</b>
      </div>
      <input
        type="search"
        placeholder="Buscar cotización, OT, cliente..."
        className="w-72 px-3 py-1.5 border rounded text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {user && (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center font-semibold text-xs">
            {user.nombreCompleto?.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="text-xs leading-tight">
            <div className="font-semibold">{user.nombreCompleto}</div>
            <div className="text-slate-500">{user.cargo}</div>
          </div>
        </div>
      )}
    </div>
  );
}
