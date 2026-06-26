import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LIMS IDIC · Sistema de Gestión de Laboratorios",
  description: "Instituto de Investigaciones y Control · Ejército de Chile",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
