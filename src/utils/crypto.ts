// @deprecated — XOR + displacement block cipher for game data (duplicated from C++ PlatformCore).
// Per-player key derivation: SHA256-like hash of (playerHash + masterSalt).
// ⚠️ This module is kept ONLY for decrypting legacy save data during a one-time migration.
// All NEW encryption/persistence is handled by C++ PlatformCore via the TS Platform Bridge.

const MASTER_SALT = 'cb7d8a914ef26350a13becd49f287506';

function deriveKey(hash: string): Uint8Array {
  let h = 0x811c9dc5;
  const input = hash + MASTER_SALT;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x45d9f3b) >>> 0;
    h = ((h << 16) ^ h ^ (h >>> 5)) >>> 0;
    key[i] = h & 0xff;
  }
  return key;
}

function rotl32(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

function rotr32(v: number, n: number): number {
  return ((v >>> n) | (v << (32 - n))) >>> 0;
}

export function encrypt(plaintext: string, playerHash: string): string {
  const key = deriveKey(playerHash);
  const data = new TextEncoder().encode(plaintext);
  const paddedLen = Math.ceil(data.length / 4) * 4;
  const out = new Uint8Array(paddedLen);

  for (let i = 0; i < data.length; i += 4) {
    let block = 0;
    for (let j = 0; j < 4; j++) {
      block = (block << 8) | (i + j < data.length ? data[i + j] : 0);
    }

    const keyOff = (i / 4) % 4;
    const keyBlock = (key[keyOff * 4] << 24) | (key[keyOff * 4 + 1] << 16)
                   | (key[keyOff * 4 + 2] << 8) | key[keyOff * 4 + 3];
    block ^= keyBlock;
    block = rotl32(block, 7);

    for (let j = 0; j < 4; j++) {
      out[i + j] = (block >>> (24 - j * 8)) & 0xff;
    }
  }

  let binary = '';
  for (let i = 0; i < out.length; i++) binary += String.fromCharCode(out[i]);
  return btoa(binary);
}

export function decrypt(encrypted: string, playerHash: string): string {
  const key = deriveKey(playerHash);
  const binary = atob(encrypted);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  const out = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i += 4) {
    let block = 0;
    for (let j = 0; j < 4 && i + j < data.length; j++) {
      block = (block << 8) | data[i + j];
    }

    block = rotr32(block, 7);

    const keyOff = (i / 4) % 4;
    const keyBlock = (key[keyOff * 4] << 24) | (key[keyOff * 4 + 1] << 16)
                   | (key[keyOff * 4 + 2] << 8) | key[keyOff * 4 + 3];
    block ^= keyBlock;

    for (let j = 0; j < 4 && i + j < data.length; j++) {
      out[i + j] = (block >>> (24 - j * 8)) & 0xff;
    }
  }

  // Strip trailing null bytes (padding)
  let end = out.length;
  while (end > 0 && out[end - 1] === 0) end--;
  return new TextDecoder().decode(out.slice(0, end));
}
