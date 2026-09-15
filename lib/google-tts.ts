import { GOOGLE_PROJECT_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL } from "./google-project";
import { AppError } from "./errors";
import { boundedBytes } from "./jobs";
import type { ChirpVoice } from "./chirp-voices";

// Workers support manual redirect handling; never forward Google credentials.
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SYNTHESIS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const encoder = new TextEncoder();
function base64url(bytes: Uint8Array) {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
export async function googleAccessToken(secret: string, transport: typeof fetch = fetch) {
  // Fixed endpoints and scope: a key file cannot redirect credentials elsewhere.
  let account: { client_email: string; private_key: string; project_id: string };
  let key: CryptoKey;
  try {
    if (secret.length > 16_000) throw new Error();
    const parsed = JSON.parse(secret);
    if (parsed.type !== "service_account" || parsed.project_id !== GOOGLE_PROJECT_ID || parsed.client_email !== GOOGLE_SERVICE_ACCOUNT_EMAIL || parsed.token_uri !== TOKEN_URL || typeof parsed.private_key !== "string") throw new Error();
    account = parsed;
    const pem = /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/.exec(account.private_key);
    if (!pem) throw new Error();
    const der = Uint8Array.from(atob(pem[1].replace(/\s/g, "")), c => c.charCodeAt(0));
    key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch { throw new AppError("The Google narration secret needs checking. Save the complete Interlude service-account JSON in Site secrets.", 503); }
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = base64url(encoder.encode(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: TOKEN_URL, iat: now, exp: now + 3600 })));
  const unsigned = `${head}.${body}`, signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const response = await transport(TOKEN_URL, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(new Uint8Array(signature))}` }), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) { await response.body?.cancel(); throw new AppError("Google could not authorize narration. Check the saved service-account key; no text was sent for narration.", 503); }
  let result;
  try { result = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 16_000))); } catch { throw new AppError("Google returned an unusable authorization response.", 502); }
  if (typeof result.access_token !== "string" || !result.access_token || result.access_token.length > 8192 || result.token_type !== "Bearer") throw new AppError("Google returned an unusable authorization response.", 502);
  return result.access_token as string;
}

export function splitChirpText(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 8000) throw new AppError("This lesson needs to be shortened before narration.");
  const chunks: string[] = []; let current = "", size = 0;
  for (const word of normalized.split(" ")) {
    const bytes = encoder.encode(word).length;
    if (bytes > 3800) throw new AppError("The narration contains an oversized word.");
    if (size && size + bytes + 1 > 3800) { chunks.push(current); current = ""; size = 0; }
    current += (size ? " " : "") + word; size += bytes + (size ? 1 : 0);
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chirpPcm(wav: Uint8Array) {
  const fail = () => new AppError("Google returned an unsupported audio file. This attempt is held and will not be resent automatically.", 502);
  if (wav.length < 44 || wav.length > 16_000_044) throw fail();
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) + 8 !== wav.length) throw fail();
  let format = false, pcm: Uint8Array | null = null;
  for (let at = 12; at + 8 <= wav.length;) {
    const size = view.getUint32(at + 4, true), start = at + 8;
    if (start + size > wav.length) throw fail();
    if (tag(at) === "fmt ") {
      if (format || size < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1 || view.getUint32(start + 4, true) !== 24000 || view.getUint32(start + 8, true) !== 48000 || view.getUint16(start + 12, true) !== 2 || view.getUint16(start + 14, true) !== 16) throw fail();
      format = true;
    } else if (tag(at) === "data") { if (pcm || !size || size % 2) throw fail(); pcm = wav.subarray(start, start + size); }
    at = start + size + size % 2;
  }
  if (!format || !pcm) throw fail();
  return pcm;
}

export async function synthesizeChirp(token: string, text: string, voice: ChirpVoice, transport: typeof fetch = fetch) {
  const response = await transport(SYNTHESIS_URL, { method: "POST", redirect: "manual", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-goog-user-project": GOOGLE_PROJECT_ID }, body: JSON.stringify({ input: { text }, voice: { languageCode: "en-US", name: `en-US-Chirp3-HD-${voice}` }, audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 } }), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) { await response.body?.cancel(); throw new AppError(`Google narration did not complete (HTTP ${response.status}). The attempt is held; it will not be resent automatically.`, 502); }
  let result;
  try { result = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 21_400_000))); } catch { throw new AppError("Google's audio response could not be read. The attempt is held.", 502); }
  if (typeof result.audioContent !== "string" || result.audioContent.length > 21_334_000) throw new AppError("Google's audio response was incomplete or too large.", 502);
  let bytes;
  try { const binary = atob(result.audioContent); bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); } catch { throw new AppError("Google's audio response could not be decoded.", 502); }
  return chirpPcm(bytes);
}
