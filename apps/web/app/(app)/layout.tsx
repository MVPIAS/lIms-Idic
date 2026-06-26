import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[230px_1fr] grid-rows-[50px_1fr] h-screen">
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
