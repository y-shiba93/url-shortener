import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { spawnSync } from "node:child_process";
import { createApp } from "../src/app.js";
import {
  generateCode,
  normalizeUrl,
  UrlStore,
  validateBase,
} from "../src/store.js";

test("normalization, root slash equivalence and path slash distinction", () => {
  const store = new UrlStore();
  assert.equal(
    store.shorten("https://EXAMPLE.org:443"),
    store.shorten("https://example.org/"),
  );
  assert.notEqual(
    store.shorten("https://example.org/path"),
    store.shorten("https://example.org/path/"),
  );
  assert.equal(
    normalizeUrl("https://example.org/日本"),
    new URL("https://example.org/日本").href,
  );
  for (const input of [
    null,
    "",
    "relative",
    "ftp://example.org",
    "https://a:b@example.org",
    "https://example.org/\n",
    "https://example.org/\u007f",
    "https://example.org/" + "a".repeat(8192),
  ]) {
    assert.throws(() => normalizeUrl(input));
  }
});

test("cryptographic code shape and synchronous collision retry", () => {
  for (let i = 0; i < 100; i++)
    assert.match(generateCode(), /^[A-Za-z0-9]{8}$/);
  const codes = ["AAAA0000", "AAAA0000", "BBBB0000"];
  let calls = 0;
  const store = new UrlStore(undefined, () => codes[calls++]);
  const first = store.shorten("https://one.example");
  assert.equal(store.shorten("https://one.example/"), first);
  assert.equal(calls, 1);
  assert.equal(
    store.shorten("https://two.example"),
    "https://example.com/BBBB0000",
  );
  assert.equal(store.resolve(first), "https://one.example/");
  assert.equal(calls, 3);
  const stuck = new UrlStore(undefined, () => "AAAAAAAA");
  stuck.shorten("https://one.example");
  assert.throws(() => stuck.shorten("https://two.example"), /allocate/);
  assert.equal(
    stuck.resolve("https://example.com/AAAAAAAA"),
    "https://one.example/",
  );
});

test("base validation and strict resolve validation", () => {
  assert.equal(validateBase(), "https://example.com");
  assert.equal(validateBase("http://localhost:3000/"), "http://localhost:3000");
  for (const base of [
    "https://example.com/path",
    "https://example.com/a/..",
    "https://example.com/?",
    "https://example.com/#",
    "https://u:p@example.com",
    "file:///tmp",
  ])
    assert.throws(() => validateBase(base));
  const store = new UrlStore(undefined, () => "Ab12Cd34");
  store.shorten("https://target.example");
  for (const input of [
    "https://other.example/Ab12Cd34",
    "https://example.com/Ab12Cd34?x=1",
    "https://example.com/Ab12Cd34#x",
    "https://example.com/Ab12Cd34/",
    "https://example.com/a/../Ab12Cd34",
  ])
    assert.throws(() => store.resolve(input));
  assert.throws(
    () => store.resolve("https://example.com/Unknown1"),
    /not found/,
  );
});

test("invalid startup configuration fails before listening", () => {
  for (const value of ["0", "65536", "-1", "3.5", "abc", ""]) {
    const result = spawnSync(process.execPath, ["dist/src/server.js"], {
      env: { ...process.env, PORT: value },
      timeout: 3000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /PORT must/);
  }
  const result = spawnSync(process.execPath, ["dist/src/server.js"], {
    env: {
      ...process.env,
      PORT: "3000",
      SHORT_URL_BASE_URL: "https://example.com/path",
    },
    timeout: 3000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr.toString(), /origin only/);
});

test("HTTP APIs, redirects, body limits and static UI", async (t) => {
  const server = createApp(new UrlStore(undefined, () => "Ab12Cd34"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: string, type = "application/json") =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });
  const shortened = await post(
    "/api/shorten",
    JSON.stringify({ url: "https://target.example" }),
  );
  assert.equal(shortened.status, 200);
  assert.deepEqual(await shortened.json(), {
    shortUrl: "https://example.com/Ab12Cd34",
  });
  const resolved = await post(
    "/api/resolve",
    JSON.stringify({ shortUrl: "https://example.com/Ab12Cd34" }),
  );
  assert.deepEqual(await resolved.json(), { url: "https://target.example/" });
  const redirect = await fetch(base + "/Ab12Cd34", { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://target.example/");
  assert.equal(redirect.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(base + "/Unknown1")).status, 404);
  assert.equal((await fetch(base + "/api/shorten")).status, 405);
  assert.equal((await post("/api/shorten", "{}", "text/plain")).status, 415);
  for (const body of ["{", "[]", "null", "{}", '{"url":4}'])
    assert.equal((await post("/api/shorten", body)).status, 400);
  assert.equal((await post("/api/shorten", " ".repeat(16385))).status, 413);
  assert.equal((await post("/api/shorten", " ".repeat(16384))).status, 400);
  const chunkedStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const req = request(
        base + "/api/shorten",
        { method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.write(" ".repeat(8000));
      req.end(" ".repeat(9000));
    },
  );
  assert.equal(chunkedStatus, 413);
  assert.match(await (await fetch(base)).text(), /URL短縮・復元/);
  assert.equal((await fetch(base + "/app.js")).status, 200);
  assert.equal((await fetch(base + "/style.css")).status, 200);
  assert.equal((await fetch(base + "/package.json")).status, 404);
  assert.equal((await fetch(base + "/__dev/status")).status, 404);
  assert.equal((await fetch(base + "/__dev/events")).status, 404);
  assert.equal((await fetch(base + "/__dev/reload.js")).status, 404);
  assert.doesNotMatch(await (await fetch(base)).text(), /__dev\/reload\.js/);
});

test("development reload endpoints are isolated from production", async (t) => {
  const server = createApp(new UrlStore(), undefined, true);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const page = await (await fetch(base)).text();
  const version = page.match(/data-version="([a-f0-9-]+)"/)?.[1];
  assert.ok(version);
  assert.match(page, /src="\/__dev\/reload\.js"/);
  assert.deepEqual(await (await fetch(base + "/__dev/status")).json(), {
    version,
  });
  const controller = new AbortController();
  const events = await fetch(base + "/__dev/events", {
    signal: controller.signal,
  });
  assert.equal(
    events.headers.get("content-type"),
    "text/event-stream; charset=utf-8",
  );
  const reader = events.body?.getReader();
  assert.ok(reader);
  const first = await reader.read();
  assert.match(
    new TextDecoder().decode(first.value),
    new RegExp(`data: ${version}\\n\\n`),
  );
  controller.abort();
  const script = await fetch(base + "/__dev/reload.js");
  assert.equal(script.status, 200);
  const source = await script.text();
  assert.match(source, /new EventSource\(["']\/__dev\/events["']\)/);
  assert.match(source, /location\.reload\(\)/);
});
