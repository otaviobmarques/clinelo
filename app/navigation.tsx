"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function Navigation({ clinic }: { clinic: string }) {
  const path = usePathname();
  return <nav className="product-nav" aria-label="Navegação principal"><Link className="product-brand" href={"/painel?clinic="+clinic}>Clinelo<span>RECEPÇÃO DIGITAL</span></Link><div>{[["/painel","Visão geral"],["/","Minha agenda"],["/caixa","Conversas"],["/pacientes","Cadastro de pacientes"],["/espera","Vagas e espera"]].map(([href,label])=><Link key={href} href={href+"?clinic="+clinic} aria-current={path===href?"page":undefined}>{label}</Link>)}</div><small>Um produto Domma Tecnologia</small></nav>;
}
