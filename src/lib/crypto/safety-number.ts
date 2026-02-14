export async function generateSafetyNumber(
  localIdentityKey: JsonWebKey,
  remoteIdentityKey: JsonWebKey
): Promise<string> {
  const encoder = new TextEncoder();

  // Deterministic ordering - lower key first
  const localStr = JSON.stringify(localIdentityKey);
  const remoteStr = JSON.stringify(remoteIdentityKey);

  const [first, second] = localStr < remoteStr
    ? [localStr, remoteStr]
    : [remoteStr, localStr];

  const combined = encoder.encode(first + second);

  // Iterative hashing (5 rounds) for stronger fingerprint
  let hash = await crypto.subtle.digest('SHA-256', combined);
  for (let i = 0; i < 4; i++) {
    hash = await crypto.subtle.digest('SHA-256', hash);
  }

  const bytes = new Uint8Array(hash);
  const numbers: string[] = [];

  for (let i = 0; i < 30 && i + 3 < bytes.length; i += 5) {
    const num = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    numbers.push(String(num % 100000).padStart(5, '0'));
  }

  return numbers.join(' ');
}
