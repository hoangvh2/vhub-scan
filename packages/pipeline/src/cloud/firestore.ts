import type { FetchLike } from "../sources/http.js";

/** A Firestore value in the REST encoding. Only the kinds this app stores. */
export type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string };

export type Primitive = string | number | boolean | null;

export function encode(v: Primitive): FsValue {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
}

export function decode(v: Record<string, unknown> | undefined): Primitive | undefined {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue as string;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue as number;
  if ("booleanValue" in v) return v.booleanValue as boolean;
  if ("timestampValue" in v) return v.timestampValue as string;
  if ("nullValue" in v) return null;
  return undefined;
}

export interface FsDoc {
  /** Full resource name: projects/p/databases/(default)/documents/... */
  name: string;
  /** Last path segment. */
  id: string;
  fields: Record<string, Primitive | undefined>;
}

/** What sync needs from Firestore. The REST client below implements it; tests use an in-memory one. */
export interface DocStore {
  set(path: string, fields: Record<string, Primitive>): Promise<void>;
  list(collectionPath: string): Promise<FsDoc[]>;
  remove(names: string[]): Promise<void>;
}

/** What the cloud scan also needs: read one document, change some of its fields. */
export interface DocReader extends DocStore {
  /** Null when the document does not exist. */
  get(path: string): Promise<FsDoc | null>;
  /** Sets only these fields of an existing document. */
  update(path: string, fields: Record<string, Primitive>): Promise<void>;
}

const toDoc = (d: { name: string; fields?: Record<string, Record<string, unknown>> }): FsDoc => ({
  name: d.name,
  id: d.name.slice(d.name.lastIndexOf("/") + 1),
  fields: Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, decode(v)])),
});

/** Minimal Firestore REST client (no SDK): get, set or update a document, list a collection, delete in batches. */
export class FirestoreRest implements DocReader {
  private readonly base: string;
  readonly root: string;

  constructor(
    private readonly o: { projectId: string; token: () => Promise<string>; baseUrl?: string; fetchImpl?: FetchLike; timeoutMs?: number },
  ) {
    this.base = (o.baseUrl ?? "https://firestore.googleapis.com").replace(/\/$/, "");
    this.root = `projects/${o.projectId}/databases/(default)/documents`;
  }

  private async call(method: string, url: string, body?: unknown, allow404 = false): Promise<unknown> {
    const f = this.o.fetchImpl ?? fetch;
    const r = await f(url, {
      method,
      headers: { authorization: `Bearer ${await this.o.token()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000),
    });
    const text = await r.text();
    if (allow404 && r.status === 404) return null;
    if (!r.ok) {
      let msg = text.slice(0, 200);
      try {
        msg = (JSON.parse(text) as { error?: { status?: string; message?: string } }).error?.message ?? msg;
      } catch {
        /* not JSON */
      }
      throw new Error(`Firestore ${method} ${r.status}: ${msg}`);
    }
    return text ? JSON.parse(text) : {};
  }

  async set(path: string, fields: Record<string, Primitive>): Promise<void> {
    const enc = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)]));
    await this.call("PATCH", `${this.base}/v1/${this.root}/${path}`, { fields: enc });
  }

  async get(path: string): Promise<FsDoc | null> {
    const r = (await this.call("GET", `${this.base}/v1/${this.root}/${path}`, undefined, true)) as { name: string; fields?: Record<string, Record<string, unknown>> } | null;
    return r ? toDoc(r) : null;
  }

  async update(path: string, fields: Record<string, Primitive>): Promise<void> {
    const q = new URLSearchParams({ "currentDocument.exists": "true" });
    for (const k of Object.keys(fields)) q.append("updateMask.fieldPaths", k);
    const enc = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)]));
    await this.call("PATCH", `${this.base}/v1/${this.root}/${path}?${q}`, { fields: enc });
  }

  async list(collectionPath: string): Promise<FsDoc[]> {
    const out: FsDoc[] = [];
    let page = "";
    for (let i = 0; i < 20; i++) {
      const q = new URLSearchParams({ pageSize: "300" });
      if (page) q.set("pageToken", page);
      const r = (await this.call("GET", `${this.base}/v1/${this.root}/${collectionPath}?${q}`)) as {
        documents?: { name: string; fields?: Record<string, Record<string, unknown>> }[];
        nextPageToken?: string;
      };
      for (const d of r.documents ?? []) out.push(toDoc(d));
      if (!r.nextPageToken) break;
      page = r.nextPageToken;
    }
    return out;
  }

  async remove(names: string[]): Promise<void> {
    for (let i = 0; i < names.length; i += 400) {
      const writes = names.slice(i, i + 400).map((name) => ({ delete: name }));
      await this.call("POST", `${this.base}/v1/${this.root}:commit`, { writes });
    }
  }
}
