import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const value = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error("connector_encryption_unavailable");
  return Buffer.from(value, "hex");
}
export function connectorEncryptionReady() {
  try { encryptionKey(); return true; } catch { return false; }
}
export function encryptCredential(token: string, ownerId: string, connectionId: string, revision: number) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(JSON.stringify([ownerId, connectionId, revision])));
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function decryptCredential(encrypted: string, ownerId: string, connectionId: string, revision: number) {
  try {
    const [version, iv, tag, data, extra] = encrypted.split(".");
    if (version !== "v1" || extra || !iv || !tag || !data) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    cipher.setAAD(Buffer.from(JSON.stringify([ownerId, connectionId, revision])));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8");
  } catch { throw new Error("connector_credential_unavailable"); }
}
