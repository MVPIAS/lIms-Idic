"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("lims_token")) {
      router.replace("/login");
    } else {
      setOk(true);
    }
  }, [router]);

  if (!ok) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Cargando…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[230px_1fr] grid-rows-[52px_1fr] h-screen">
      <aside className="row-span-2 bg-gradient-to-b from-[#0e2a32] to-primary text-slate-200 overflow-y-auto">
        <Sidebar />
      </aside>
      <header className="bg-white border-b">
        <Topbar />
      </header>
      <main className="overflow-y-auto bg-slate-50 p-6">{children}</main>
    </div>
  );
}
