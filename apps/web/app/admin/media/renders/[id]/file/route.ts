import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Five minutes: enough to start a download of a large video, too short to share the link. */
const SIGNED_URL_SECONDS = 300;

/** Redirects a member to a short-lived signed download URL of a render. Nothing is public. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  await requireRole("member");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse(null, { status: 404 });
  const supabase = await createSupabaseServerClient();
  const { data: render } = await supabase
    .from("renders")
    .select("storage_path")
    .eq("id", id.data)
    .maybeSingle();
  if (!render) return new NextResponse(null, { status: 404 });
  const { data, error } = await supabase.storage
    .from("media")
    .createSignedUrl(render.storage_path, SIGNED_URL_SECONDS, { download: true });
  if (error) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
