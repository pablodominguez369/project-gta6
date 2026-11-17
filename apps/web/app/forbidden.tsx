import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <p className="text-sm font-medium text-red-600">403</p>
      <h1 className="text-2xl font-semibold">No tienes permiso para ver esta página</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Tu rol no incluye acceso a esta sección. Pide a un administrador que revise tus permisos.
      </p>
      <Link href="/admin" className="text-sm underline">
        Volver al panel
      </Link>
    </main>
  );
}
