import { z } from "zod";

export const APP_ENVS = ["local", "staging", "production"] as const;
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

/** Variables every process needs. */
export const baseEnvSchema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

/**
 * Public variables, safe to expose to the browser. Only `NEXT_PUBLIC_*` names belong here.
 * Uses Supabase "publishable" keys (`sb_publishable_...`), which replace the legacy anon key.
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

/**
 * Supabase secret key (`sb_secret_...`, replaces the legacy service_role key). It bypasses RLS,
 * so it is only read by server code and the worker, never by the browser.
 */
const supabaseSecretKey = z.string().min(20);

const secretRef = z
  .string()
  .regex(/^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._/-]+$/, "must be a secret reference like env://NAME");

/**
 * OAuth apps used to connect YouTube and TikTok accounts (T31). All optional: a platform whose
 * client id or secret reference is missing simply cannot be connected. The secret is a reference
 * (env:// locally, vault:// in staging/production), never the value itself.
 */
export const platformOAuthEnvSchema = z.object({
  /** Public base URL of the panel; the OAuth redirect URI is APP_BASE_URL + the callback path. */
  APP_BASE_URL: z.url().optional(),
  YOUTUBE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  YOUTUBE_OAUTH_CLIENT_SECRET_REF: secretRef.optional(),
  /** TikTok calls the client id "client key". */
  TIKTOK_OAUTH_CLIENT_KEY: z.string().min(1).optional(),
  TIKTOK_OAUTH_CLIENT_SECRET_REF: secretRef.optional(),
});

/** Server-only variables for the Next.js app. Never import this from client code. */
export const webServerEnvSchema = baseEnvSchema
  .extend(publicEnvSchema.shape)
  .extend({
    SUPABASE_SECRET_KEY: supabaseSecretKey,
  })
  .extend(platformOAuthEnvSchema.shape);

/**
 * Worker variables. `PUBLISHING_MODE=live` lets channels that an admin switched on upload
 * privately to real platforms (ADR 0005); it is refused in local development (rule 1).
 */
export const PUBLISHING_MODES = ["simulated", "live"] as const;
export const LLM_PROVIDERS = ["disabled", "fake", "anthropic"] as const;
/** No real TTS adapter yet: the owner has not chosen a provider (see docs/connectors.md). */
export const TTS_PROVIDERS = ["disabled", "fake"] as const;

export const workerEnvSchema = baseEnvSchema
  .extend(platformOAuthEnvSchema.shape)
  .extend({
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: supabaseSecretKey,
    DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value)),
    PUBLISHING_MODE: z.enum(PUBLISHING_MODES).default("simulated"),
    /**
     * LLM used to draft scripts. "disabled" (default): no call leaves the worker. "fake": canned
     * answers, local only. "anthropic": real calls, still blocked while the spend limits are 0.
     */
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("disabled"),
    LLM_MODEL: z
      .string()
      .regex(/^claude-[a-z0-9-]+$/)
      .optional(),
    /** Secret reference (e.g. env://ANTHROPIC_API_KEY), never the key itself. */
    LLM_API_KEY_REF: z
      .string()
      .regex(
        /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._/-]+$/,
        "must be a secret reference like env://NAME",
      )
      .optional(),
    /**
     * Text to speech for renders. "disabled" (default): nothing is narrated. "fake": a tone per
     * word, local only, so renders can be tested end to end without any provider.
     */
    TTS_PROVIDER: z.enum(TTS_PROVIDERS).default("disabled"),
    /** FFmpeg binaries for renders (installed in the worker image). */
    FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
    FFPROBE_PATH: z.string().min(1).default("ffprobe"),
    /** Folder with the subtitle font (DejaVu Sans from the fonts-dejavu-core package). */
    RENDER_FONTS_DIR: z.string().min(1).default("/usr/share/fonts/truetype/dejavu"),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === "anthropic" && !env.LLM_API_KEY_REF) {
      ctx.addIssue({
        code: "custom",
        path: ["LLM_API_KEY_REF"],
        message: "required when LLM_PROVIDER=anthropic",
      });
    }
    if (env.LLM_PROVIDER === "fake" && env.APP_ENV !== "local") {
      ctx.addIssue({
        code: "custom",
        path: ["LLM_PROVIDER"],
        message: "the fake LLM is only allowed when APP_ENV=local",
      });
    }
    if (env.PUBLISHING_MODE === "live" && env.APP_ENV === "local") {
      ctx.addIssue({
        code: "custom",
        path: ["PUBLISHING_MODE"],
        message: "live publishing is not allowed when APP_ENV=local (use simulated)",
      });
    }
    if (env.TTS_PROVIDER === "fake" && env.APP_ENV !== "local") {
      ctx.addIssue({
        code: "custom",
        path: ["TTS_PROVIDER"],
        message: "the fake TTS is only allowed when APP_ENV=local",
      });
    }
  });

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type WebServerEnv = z.infer<typeof webServerEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type PlatformOAuthEnv = z.infer<typeof platformOAuthEnvSchema>;
