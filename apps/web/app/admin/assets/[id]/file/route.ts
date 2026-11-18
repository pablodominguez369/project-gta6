import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Signed URLs live for one minute: enough to open the file, too short to share it. */
const SIGNED_URL_SECONDS = 60;

/** Redirects a member to a short-lived signed URL of the asset's file. Nothing is public. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  await requireRole("member");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse(null, { status: 404 });
  const supabase = await createSupabaseServerClient();
  const { data: asset } = await supabase
    .from("assets")
    .select("storage_path")
    .eq("id", id.data)
    .maybeSingle();
  if (!asset) return new NextResponse(null, { status: 404 });
  const { data, error } = await supabase.storage
    .from("media")
    .createSignedUrl(asset.storage_path, SIGNED_URL_SECONDS);
  if (error) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
