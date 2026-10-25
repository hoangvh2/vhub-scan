import type { DocReader, FsDoc, Primitive } from "../src/cloud/firestore.js";
import { GenerationConflict, type BlobStore } from "../src/cloud/storage.js";

/** Cloud Storage stand-in with real generation preconditions. */
export class MemoryBlobs implements BlobStore {
  objects = new Map<string, { bytes: Buffer; generation: string }>();
  uploads: { name: string; ifGeneration?: string }[] = [];
  private next = 100;
  async generation(name: string) {
    return this.objects.get(name)?.generation ?? null;
  }
  async download(name: string) {
    const o = this.objects.get(name);
    return o ? { bytes: Buffer.from(o.bytes), generation: o.generation } : null;
  }
  async upload(name: string, bytes: Buffer, ifGeneration?: string) {
    this.uploads.push({ name, ifGeneration });
    const cur = this.objects.get(name)?.generation ?? "0";
    if (ifGeneration !== undefined && ifGeneration !== cur) throw new GenerationConflict(name);
    const generation = String(this.next++);
    this.objects.set(name, { bytes: Buffer.from(bytes), generation });
    return generation;
  }
}

/** Firestore stand-in for the cloud scan: documents by path, with get and partial update. */
export class MemoryDocs implements DocReader {
  docs = new Map<string, Record<string, Primitive>>();
  private full = (p: string) => `projects/p/databases/(default)/documents/${p}`;
  async set(path: string, fields: Record<string, Primitive>) {
    this.docs.set(path, { ...fields });
  }
  async get(path: string): Promise<FsDoc | null> {
    const f = this.docs.get(path);
    return f ? { name: this.full(path), id: path.slice(path.lastIndexOf("/") + 1), fields: { ...f } } : null;
  }
  async update(path: string, fields: Record<string, Primitive>) {
    const cur = this.docs.get(path);
    if (!cur) throw new Error(`Firestore PATCH 404: ${path}`);
    this.docs.set(path, { ...cur, ...fields });
  }
  async list(coll: string): Promise<FsDoc[]> {
    return [...this.docs.entries()]
      .filter(([k]) => k.startsWith(coll + "/") && !k.slice(coll.length + 1).includes("/"))
      .map(([k, fields]) => ({ name: this.full(k), id: k.slice(k.lastIndexOf("/") + 1), fields: { ...fields } }));
  }
  async remove(names: string[]) {
    for (const n of names) this.docs.delete(n.replace(this.full(""), ""));
  }
}
