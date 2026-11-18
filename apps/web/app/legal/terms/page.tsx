import type { Metadata } from "next";

export const metadata: Metadata = { title: "Términos de servicio · GTA 6 Media Factory" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-6">
      <h1 className="text-2xl font-semibold">Términos de servicio</h1>
      <p>Última actualización: 18 de noviembre de 2026.</p>
      <p>
        GTA 6 Media Factory es una herramienta privada de uso interno. Solo pueden usarla las
        personas a las que su administrador ha creado una cuenta. No es un servicio abierto al
        público.
      </p>
      <h2 className="text-lg font-medium">Uso de cuentas de plataformas</h2>
      <p>
        Quien conecta una cuenta de YouTube o TikTok autoriza a la herramienta a subir los vídeos
        que esa misma persona prepara y aprueba en el panel. Los vídeos se suben en modo privado
        salvo que la persona decida otra cosa de forma expresa. La herramienta no da me gusta, no
        comenta, no sigue cuentas ni publica nada sin una acción de la persona.
      </p>
      <h2 className="text-lg font-medium">Contenido</h2>
      <p>
        Cada persona es responsable de tener los derechos del contenido que sube y de cumplir las
        normas de cada plataforma. La herramienta bloquea los vídeos cuyos materiales no tienen
        derechos registrados.
      </p>
      <h2 className="text-lg font-medium">Retirar el acceso</h2>
      <p>
        Puedes desconectar una cuenta en cualquier momento desde el panel o desde los ajustes de
        seguridad de YouTube o TikTok. Al desconectarla se borran sus permisos guardados.
      </p>
    </main>
  );
}
