import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Clinelo | Agenda da recepção",
  description: "Recepção digital de clínicas médicas e odontológicas da Domma Tecnologia.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
