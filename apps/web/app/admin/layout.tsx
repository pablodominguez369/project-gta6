import type { AppRole } from "@gta6/domain";
import Link from "next/link";
import type { ReactNode } from "react";

import { requireRole } from "@/lib/auth/require-role";

import { signOut } from "./actions";

const NAV: readonly { href: string; label: string; roles: readonly AppRole[] | "member" }[] = [
  { href: "/admin", label: "Resumen", roles: "member" },
  { href: "/admin/controls", label: "Controles", roles: ["admin"] },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("member");
  const visibleNav = NAV.filter(
    (item) => item.roles === "member" || item.roles.some((role) => user.roles.includes(role)),
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <nav className="flex items-center gap-4 text-sm">
            <span className="font-semibold">Media Factory</span>
            {visibleNav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:underline">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-600 dark:text-neutral-400">
              {user.email} · {user.roles.join(", ")}
            </span>
            <form action={signOut}>
              <button type="submit" className="underline">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
