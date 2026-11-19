import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "GTA 6 Media Factory",
  description:
    "Herramienta editorial privada para un canal independiente sobre GTA VI. Private editorial tool for an independent GTA VI channel.",
};

/**
 * Public home page. Google's OAuth app verification needs a homepage on the verified domain
 * that describes the app and links to its privacy policy (same URL as the consent screen).
 * Written in Spanish and English because the platform reviewers read English.
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 text-sm leading-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">GTA 6 Media Factory</h1>
        <p>
          Herramienta editorial privada de un canal independiente en español sobre el videojuego GTA
          VI. Canal editorial independiente, sin afiliación oficial con Rockstar Games ni Take-Two.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Qué hace</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Ayuda a escribir guiones con la fuente de cada dato.</li>
          <li>Narra los guiones con una voz sintética, que siempre se indica en el vídeo.</li>
          <li>Monta vídeos verticales solo con material cuyos derechos están registrados.</li>
          <li>
            Sube cada vídeo al canal propio de YouTube o TikTok, solo después de que una persona lo
            revise y apruebe.
          </li>
        </ul>
      </section>

      <section className="space-y-2" lang="en">
        <h2 className="text-lg font-medium">What it does</h2>
        <p>
          GTA 6 Media Factory is a private editorial tool for an independent Spanish-language
          channel about the video game GTA VI. It helps its owner write sourced scripts, narrate
          them with a disclosed synthetic voice, render vertical videos from assets with recorded
          rights, and upload them to the owner&apos;s own YouTube and TikTok accounts after a human
          review. It only accesses the accounts the owner connects, to upload the owner&apos;s
          videos and check their status. It is not affiliated with Rockstar Games or Take-Two
          Interactive.
        </p>
      </section>

      <nav className="flex flex-wrap gap-4">
        <Link href="/legal/privacy" className="underline">
          Política de privacidad / Privacy policy
        </Link>
        <Link href="/legal/terms" className="underline">
          Condiciones de uso / Terms of service
        </Link>
        <Link href="/admin" className="underline">
          Acceder al panel / Sign in
        </Link>
      </nav>
    </main>
  );
}
