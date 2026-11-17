import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSessionUser()) {
    redirect("/admin");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">GTA 6 Media Factory</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Acceso privado. Las cuentas las crea un administrador.
        </p>
      </div>
      <LoginForm />
    </main>
  );
}
