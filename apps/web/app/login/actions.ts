"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
});

export interface LoginState {
  readonly error: string | null;
}

// Single generic message so the form does not reveal whether an email exists.
const INVALID_LOGIN = "Email o contraseña incorrectos.";

export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: INVALID_LOGIN };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Log the error code only: never the email or password.
    logger.warn({ authErrorCode: error.code ?? "unknown" }, "sign-in failed");
    return { error: INVALID_LOGIN };
  }

  redirect("/admin");
}
