import { randomInt } from "node:crypto";

export const MAX_URL_LENGTH = 8192;
const CODE = /^[A-Za-z0-9]{8}$/;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function normalizeUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_URL_LENGTH ||
    CONTROLS.test(value)
  ) {
    throw new HttpError(
      400,
      "URL must be a nonempty string without control characters (max 8192 characters).",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "Invalid URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new HttpError(
      400,
      "Only HTTP(S) URLs without credentials are allowed.",
    );
  }
  if (url.href.length > MAX_URL_LENGTH)
    throw new HttpError(400, "Normalized URL is too long.");
  return url.href;
}

export function validateBase(value = "https://example.com"): string {
  const url = new URL(normalizeUrl(value));
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new Error("SHORT_URL_BASE_URL must be an HTTP(S) origin only.");
  }
  // Reject non-origin input even when URL parsing would normalize its path away.
  if (!/^https?:\/\/[^/?#\\]+\/?$/i.test(value))
    throw new Error("SHORT_URL_BASE_URL must be an origin only.");
  return url.origin;
}

export function generateCode(): string {
  return Array.from(
    { length: 8 },
    () => ALPHABET[randomInt(ALPHABET.length)],
  ).join("");
}

export class UrlStore {
  // 課題仕様により永続化しない。再起動で失われ、別プロセス・別サーバーとは共有されない。
  private readonly byUrl = new Map<string, string>();
  private readonly byCode = new Map<string, string>();
  readonly base: string;

  constructor(
    base = "https://example.com",
    private readonly generator: () => string = generateCode,
  ) {
    this.base = validateBase(base);
  }

  shorten(input: unknown): string {
    const url = normalizeUrl(input);
    const existing = this.byUrl.get(url);
    if (existing) return `${this.base}/${existing}`;
    // No awaits: collision check and both registrations are one synchronous operation.
    for (let attempt = 0; attempt < 128; attempt++) {
      const code = this.generator();
      if (!CODE.test(code))
        throw new Error("Generator must return eight alphanumeric characters.");
      if (this.byCode.has(code)) continue;
      this.byCode.set(code, url);
      this.byUrl.set(url, code);
      return `${this.base}/${code}`;
    }
    throw new HttpError(503, "Unable to allocate a short URL. Please retry.");
  }

  resolve(input: unknown): string {
    const normalized = normalizeUrl(input);
    const url = new URL(normalized);
    if (
      url.origin !== this.base ||
      url.search ||
      url.hash ||
      !/^\/[A-Za-z0-9]{8}$/.test(url.pathname) ||
      normalized !== input
    ) {
      throw new HttpError(
        400,
        "このサービスで生成された短縮URLを、そのまま入力してください。",
      );
    }
    return this.lookup(url.pathname.slice(1));
  }

  lookup(code: string): string {
    const url = this.byCode.get(code);
    if (!url) throw new HttpError(404, "短縮URLが見つかりません。");
    return url;
  }
}
