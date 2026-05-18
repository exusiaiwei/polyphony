import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const PersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  github_token_env: z.string().min(1),
});

const ConfigFileSchema = z.object({
  repository: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, "repository must be in the form owner/repo"),
  personas: z.array(PersonaSchema).min(1),
});

export type Persona = z.infer<typeof PersonaSchema>;

export interface Config {
  owner: string;
  repo: string;
  personas: Persona[];
}

export async function loadConfig(path: string): Promise<Config> {
  const raw = await readFile(path, "utf-8");
  const parsed = ConfigFileSchema.parse(parse(raw));
  const [owner, repo] = parsed.repository.split("/");
  return { owner, repo, personas: parsed.personas };
}

export function getPersona(config: Config, id: string): Persona {
  const persona = config.personas.find((p) => p.id === id);
  if (!persona) {
    const known = config.personas.map((p) => p.id).join(", ");
    throw new Error(`Unknown persona id "${id}". Known personas: ${known}`);
  }
  return persona;
}

export function getPersonaToken(persona: Persona): string {
  const token = process.env[persona.github_token_env];
  if (!token) {
    throw new Error(
      `Missing environment variable ${persona.github_token_env} for persona "${persona.id}".`
    );
  }
  return token;
}
