import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync } from "node:fs";
import { HttpError, UrlStore } from "./store.js";

const BODY_LIMIT = 16 * 1024;
const publicRoot = new URL("../../public/", import.meta.url);

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
      req.headers["content-type"] ?? "",
    )
  ) {
    throw new HttpError(
      415,
      "Content-Type must be application/json with UTF-8 encoding.",
    );
  }
  if (
    req.headers["content-encoding"] &&
    req.headers["content-encoding"] !== "identity"
  ) {
    throw new HttpError(415, "Content-Encoding is not supported.");
  }
  if (Number(req.headers["content-length"]) > BODY_LIMIT)
    throw new HttpError(413, "Body exceeds 16 KiB.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, "Body exceeds 16 KiB.");
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(
      400,
      "Body must be a valid JSON object encoded as UTF-8.",
    );
  }
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

export function createApp(store = new UrlStore(), assetsRoot = publicRoot) {
  const assets = new Map([
    [
      "/",
      {
        body: readFileSync(new URL("index.html", assetsRoot)),
        type: "text/html; charset=utf-8",
      },
    ],
    [
      "/style.css",
      {
        body: readFileSync(new URL("style.css", assetsRoot)),
        type: "text/css; charset=utf-8",
      },
    ],
    [
      "/app.js",
      {
        body: readFileSync(new URL("app.js", assetsRoot)),
        type: "text/javascript; charset=utf-8",
      },
    ],
  ]);
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const path = req.url ?? "/";
      if (path === "/api/shorten" || path === "/api/resolve") {
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          throw new HttpError(405, "Method not allowed.");
        }
        const body = await readJson(req);
        json(
          res,
          200,
          path === "/api/shorten"
            ? { shortUrl: store.shorten(body.url) }
            : { url: store.resolve(body.shortUrl) },
        );
        return;
      }
      if (req.method === "GET") {
        const asset = assets.get(path);
        if (asset) {
          res.writeHead(200, { "Content-Type": asset.type });
          res.end(asset.body);
          return;
        }
        if (/^\/[A-Za-z0-9]{8}$/.test(path)) {
          res.writeHead(302, { Location: store.lookup(path.slice(1)) });
          res.end();
          return;
        }
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      if (!req.readableEnded) {
        res.setHeader("Connection", "close");
        req.resume();
      }
      json(res, error instanceof HttpError ? error.status : 500, {
        error:
          error instanceof HttpError ? error.message : "Internal server error.",
      });
    }
  });
}
