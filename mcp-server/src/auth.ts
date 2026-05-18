import { createPrivateKey, createSign } from "node:crypto";

interface AppCredentials {
  appId: number;
  installationId: number;
  privateKeyPem: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

function encodeBase64Url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

function generateJwt(appId: number, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) })
  );
  const unsigned = `${header}.${payload}`;

  const key = createPrivateKey(privateKeyPem);
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(key).toString("base64url");

  return `${unsigned}.${signature}`;
}

export async function getInstallationToken(
  creds: AppCredentials
): Promise<string> {
  const cacheKey = `${creds.appId}:${creds.installationId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const jwt = generateJwt(creds.appId, creds.privateKeyPem);

  const res = await fetch(
    `https://api.github.com/app/installations/${creds.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to get installation token for app ${creds.appId}: ${res.status} ${body}`
    );
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  tokenCache.set(cacheKey, {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  });

  return data.token;
}
