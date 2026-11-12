/** CI has fixture credentials only; unexpected provider traffic must fail before network I/O. */
if (process.env.TEST_OFFLINE === "1") {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("offline_test_external_request_blocked");
    return nativeFetch(input, { ...init, redirect: "manual" });
  };
}
