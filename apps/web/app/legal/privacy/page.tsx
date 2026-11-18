import type { Metadata } from "next";

export const metadata: Metadata = { title: "Política de privacidad · GTA 6 Media Factory" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-6">
      <h1 className="text-2xl font-semibold">Política de privacidad</h1>
      <p>Última actualización: 18 de noviembre de 2026.</p>
      <p>
        GTA 6 Media Factory es una herramienta privada de uso interno. Esta página explica qué datos
        guarda cuando una persona conecta su cuenta de YouTube o TikTok.
      </p>
      <h2 className="text-lg font-medium">Qué datos guardamos</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Los permisos de acceso (tokens) que la plataforma entrega al conectar la cuenta. Se
          guardan cifrados en Supabase Vault y nadie puede leerlos desde el panel.
        </li>
        <li>Los permisos concedidos y la fecha en que se conectó la cuenta.</li>
        <li>
          Los identificadores de los vídeos subidos y su estado, para no subir nunca el mismo vídeo
          dos veces.
        </li>
      </ul>
      <h2 className="text-lg font-medium">Para qué los usamos</h2>
      <p>
        Solo para subir los vídeos que la propia persona aprueba en el panel y para consultar su
        estado. No vendemos ni compartimos estos datos con terceros, ni los usamos para publicidad.
      </p>
      <h2 className="text-lg font-medium">Dónde se guardan</h2>
      <p>
        En la base de datos del proyecto en Supabase (Unión Europea, París). El panel se sirve desde
        Vercel.
      </p>
      <h2 className="text-lg font-medium">Cómo borrarlos</h2>
      <p>
        Al desconectar la cuenta desde el panel se borran sus permisos guardados. También puedes
        retirar el acceso desde los ajustes de seguridad de YouTube o TikTok.
      </p>
    </main>
  );
}
