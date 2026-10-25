import type { FetchLike } from "../sources/http.js";

/** The upload lost a race: the object changed since the generation the caller last saw. */
export class GenerationConflict extends Error {
  constructor(name: string) {
    super(`${name} đã bị nơi khác cập nhật`);
    this.name = "GenerationConflict";
  }
}

/** What database hand-over needs from Cloud Storage. GcsRest implements it; tests use an in-memory one. */
export interface BlobStore {
  /** Current generation, or null when the object does not exist. */
  generation(name: string): Promise<string | null>;
  download(name: string): Promise<{ bytes: Buffer; generation: string } | null>;
  /**
   * Writes only if the object is still at `ifGeneration` ("0" = must not exist yet), else throws GenerationConflict.
   * Omit it to overwrite unconditionally. Returns the new generation.
   */
  upload(name: string, bytes: Buffer, ifGeneration?: string): Promise<string>;
}

/** Minimal Cloud Storage JSON API client (no SDK). */
export class GcsRest implements BlobStore {
  private readonly base: string;

  constructor(private readonly o: { bucket: string; token: () => Promise<string>; baseUrl?: string; fetchImpl?: FetchLike; timeoutMs?: number }) {
    this.base = (o.baseUrl ?? "https://storage.googleapis.com").replace(/\/$/, "");
  }

  private async req(method: string, url: string, body?: Buffer): Promise<Response> {
    const f = this.o.fetchImpl ?? fetch;
    return f(url, {
      method,
      headers: { authorization: `Bearer ${await this.o.token()}`, ...(body ? { "content-type": "application/octet-stream" } : {}) },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
    });
  }

  private obj(name: string): string {
    return `${this.base}/storage/v1/b/${encodeURIComponent(this.o.bucket)}/o/${encodeURIComponent(name)}`;
  }

  private async fail(r: Response, what: string): Promise<never> {
    const text = await r.text().catch(() => "");
    let msg = text.slice(0, 200);
    try {
      msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(`Cloud Storage ${what} ${r.status}: ${msg}`);
  }

  async generation(name: string): Promise<string | null> {
    const r = await this.req("GET", `${this.obj(name)}?fields=generation`);
    if (r.status === 404) return null;
    if (!r.ok) return this.fail(r, "GET");
    return String(((await r.json()) as { generation?: string }).generation ?? "");
  }

  async download(name: string): Promise<{ bytes: Buffer; generation: string } | null> {
    // Pinned to the generation read first, so the bytes and the generation always belong together.
    const generation = await this.generation(name);
    if (generation === null) return null;
    const r = await this.req("GET", `${this.obj(name)}?alt=media&generation=${encodeURIComponent(generation)}`);
    if (r.status === 404) return null;
    if (!r.ok) return this.fail(r, "GET");
    return { bytes: Buffer.from(await r.arrayBuffer()), generation };
  }

  async upload(name: string, bytes: Buffer, ifGeneration?: string): Promise<string> {
    const q = new URLSearchParams({ uploadType: "media", name });
    if (ifGeneration !== undefined) q.set("ifGenerationMatch", ifGeneration);
    const r = await this.req("POST", `${this.base}/upload/storage/v1/b/${encodeURIComponent(this.o.bucket)}/o?${q}`, bytes);
    if (r.status === 412) throw new GenerationConflict(name);
    if (!r.ok) return this.fail(r, "upload");
    return String(((await r.json()) as { generation?: string }).generation ?? "");
  }
}
