import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { getInstallationToken } from "./auth.js";

const GitHubAppSchema = z
  .object({
    app_id: z.number().int().positive(),
    installation_id: z.number().int().positive(),
    private_key_path_env: z.string().min(1).optional(),
    private_key_env: z.string().min(1).optional(),
  })
  .refine((a) => a.private_key_path_env || a.private_key_env, {
    message:
      "github_app needs either private_key_path_env (path to .pem) or private_key_env (PEM content).",
  });

const VoiceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    github_token_env: z.string().min(1).optional(),
    github_app: GitHubAppSchema.optional(),
  })
  .refine((v) => v.github_token_env || v.github_app, {
    message: "Each voice needs either github_token_env (PAT) or github_app.",
  });

const ConfigFileSchema = z.object({
  repository: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, "repository must be in the form owner/repo"),
  voices: z.array(VoiceSchema).min(1),
});

export type Voice = z.infer<typeof VoiceSchema>;

export interface Config {
  owner: string;
  repo: string;
  voices: Voice[];
}

export async function loadConfig(path: string): Promise<Config> {
  const raw = await readFile(path, "utf-8");
  const parsed = ConfigFileSchema.parse(parse(raw));
  const [owner, repo] = parsed.repository.split("/");
  return { owner, repo, voices: parsed.voices };
}

export function getVoice(config: Config, id: string): Voice {
  const voice = config.voices.find((v) => v.id === id);
  if (!voice) {
    const known = config.voices.map((v) => v.id).join(", ");
    throw new Error(`Unknown voice id "${id}". Known voices: ${known}`);
  }
  return voice;
}

export async function getVoiceToken(voice: Voice): Promise<string> {
  if (voice.github_app) {
    const app = voice.github_app;
    let privateKeyPem: string | undefined;

    if (app.private_key_env) {
      privateKeyPem = process.env[app.private_key_env];
      if (!privateKeyPem) {
        throw new Error(
          `Missing env var ${app.private_key_env} (should contain PEM content) for voice "${voice.id}".`
        );
      }
    } else if (app.private_key_path_env) {
      const keyPath = process.env[app.private_key_path_env];
      if (!keyPath) {
        throw new Error(
          `Missing env var ${app.private_key_path_env} (should point to .pem file) for voice "${voice.id}".`
        );
      }
      const { readFile } = await import("node:fs/promises");
      privateKeyPem = await readFile(keyPath, "utf-8");
    }

    return getInstallationToken({
      appId: app.app_id,
      installationId: app.installation_id,
      privateKeyPem: privateKeyPem!,
    });
  }

  const token = process.env[voice.github_token_env!];
  if (!token) {
    throw new Error(
      `Missing env var ${voice.github_token_env} for voice "${voice.id}".`
    );
  }
  return token;
}
