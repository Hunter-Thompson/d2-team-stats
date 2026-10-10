import { resolveVanityUrl } from "./steam.ts";

// Dota's 32-bit account_id is the 64-bit SteamID minus this offset.
const STEAM64_BASE = 76561197960265728n;
export const ANONYMOUS_ACCOUNT_ID = 4294967295;

export function toSteam64(accountId: number) {
  return (STEAM64_BASE + BigInt(accountId)).toString();
}

export function toAccountId(steam64: string) {
  return Number(BigInt(steam64) - STEAM64_BASE);
}

function fromNumber(digits: string) {
  const n = BigInt(digits);
  if (n > STEAM64_BASE) return toAccountId(digits);
  if (n > 0n && n < 2n ** 32n - 1n) return Number(n);
  return null;
}

/**
 * Accepts a Dota friend ID, a 64-bit SteamID, a Steam profile URL (/profiles/ or /id/),
 * a Dotabuff / OpenDota / STRATZ player URL, or a bare Steam vanity name.
 */
export async function resolvePlayerInput(raw: string): Promise<number> {
  const input = raw.trim();
  if (!input) throw new Error("Enter a friend ID, SteamID or profile URL.");

  if (/^\d+$/.test(input)) {
    const id = fromNumber(input);
    if (id !== null) return id;
    throw new Error(`"${input}" is not a valid friend ID or SteamID.`);
  }

  const profiles = input.match(/steamcommunity\.com\/profiles\/(\d+)/i);
  if (profiles) {
    const id = fromNumber(profiles[1]);
    if (id !== null) return id;
  }

  const statsSite = input.match(/(?:dotabuff\.com|opendota\.com|stratz\.com)\/players\/(\d+)/i);
  if (statsSite) {
    const id = fromNumber(statsSite[1]);
    if (id !== null) return id;
  }

  const vanity = input.match(/steamcommunity\.com\/id\/([^/?#]+)/i)?.[1] ?? input;
  if (/^[\w-]{2,64}$/.test(vanity)) {
    const steam64 = await resolveVanityUrl(vanity);
    if (steam64) return toAccountId(steam64);
  }
  throw new Error(`Couldn't find a Steam account for "${input}".`);
}
