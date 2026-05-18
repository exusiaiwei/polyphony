import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const VoiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  github_token_env: z.string().min(1),
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

export function getVoiceToken(voice: Voice): string {
  const token = process.env[voice.github_token_env];
  if (!token) {
    throw new Error(
      `Missing environment variable ${voice.github_token_env} for voice "${voice.id}".`
    );
  }
  return token;
}
