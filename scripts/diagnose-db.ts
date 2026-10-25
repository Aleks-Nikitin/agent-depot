import "dotenv/config";
import { lookup } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { databaseUrl } from "../lib/db/connection";

// Never authenticates or prints URLs, addresses, usernames or passwords.
async function main() {
  let stage = "configuration";
  try {
    const value = databaseUrl();
    if (!value) throw new Error("missing_database_url");
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("invalid_database_url");
    const port = Number(url.port || 5432);
    stage = "dns";
    const addresses = await lookup(url.hostname, { all: true });
    console.log(JSON.stringify({ stage, result: "resolved", addressCount: addresses.length }));
    stage = "tcp";
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: url.hostname, port, autoSelectFamily: true });
      let secured: tls.TLSSocket | undefined;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        secured?.destroy(); socket.destroy();
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new Error("connection_timeout")), 15_000);
      socket.once("error", finish);
      socket.once("connect", () => {
        console.log(JSON.stringify({ stage, result: "connected" }));
        stage = "postgresql_ssl";
        socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]));
      });
      socket.once("data", data => {
        if (data.length !== 1 || data[0] !== 83) return finish(new Error("server_tls_unavailable"));
        stage = "tls_verification";
        secured = tls.connect({ socket, servername: url.hostname, rejectUnauthorized: true });
        secured.once("error", finish);
        secured.once("secureConnect", () => {
          console.log(JSON.stringify({ stage, result: "verified", authorized: secured!.authorized, protocol: secured!.getProtocol() }));
          finish();
        });
      });
    });
    console.log("Database TLS diagnostic passed. No credentials were sent.");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
    // Allow only our fixed messages; OS/TLS exception text can contain addresses.
    const fixed = error instanceof Error && ["missing_database_url", "invalid_database_url", "invalid_database_target", "connection_timeout", "server_tls_unavailable"].includes(error.message)
      ? error.message : "connection_failed";
    console.error(JSON.stringify({ stage, result: fixed, errorCode: code }));
    process.exitCode = 1;
  }
}
void main();
