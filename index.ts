/**
 * SyncedDB-compatible REST API server (Bun).
 * File-based JSON storage under STORAGE_PATH (default /mnt) for Docker volume mount.
 * Store name is dynamic: any valid store name in the path (e.g. /todos, /items) is supported.
 * @see https://github.com/darrachequesne/synceddb
 */

const STORAGE_PATH = process.env.STORAGE_PATH ?? "./data";
const PORT = parseInt(process.env.PORT ?? "3000", 10);

/** Allowed characters for store name (no path traversal). */
const STORE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

function assertValidStoreName(storeName: string): void {
  if (!storeName || !STORE_NAME_REGEX.test(storeName)) {
    throw new Error("Invalid store name");
  }
}

function storeDir(storeName: string): string {
  assertValidStoreName(storeName);
  return `${STORAGE_PATH}/${storeName}`;
}

function entityPath(storeName: string, id: string): string {
  assertValidStoreName(storeName);
  const safeId = String(id).replace(/[/\\]/g, "");
  if (!safeId) throw new Error("Invalid id");
  return `${STORAGE_PATH}/${storeName}/${safeId}.json`;
}

async function ensureStorageRoot(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORAGE_PATH, { recursive: true });
}

async function ensureStoreDir(storeName: string): Promise<void> {
  const dir = storeDir(storeName);
  const fs = await import("node:fs/promises");
  await fs.mkdir(dir, { recursive: true });
}

async function listEntityIds(storeName: string): Promise<string[]> {
  const dir = storeDir(storeName);
  const fs = await import("node:fs/promises");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
}

type Entity = Record<string, unknown> & { id: string; version: number; updatedAt: string };

async function readEntity(storeName: string, id: string): Promise<Entity | null> {
  const path = entityPath(storeName, id);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const text = await file.text();
  try {
    return JSON.parse(text) as Entity;
  } catch {
    return null;
  }
}

async function writeEntity(storeName: string, entity: Entity): Promise<void> {
  await ensureStoreDir(storeName);
  const path = entityPath(storeName, String(entity.id));
  await Bun.write(path, JSON.stringify(entity, null, 0));
}

async function getAllEntities(storeName: string): Promise<Entity[]> {
  const ids = await listEntityIds(storeName);
  const entities: Entity[] = [];
  for (const id of ids) {
    const e = await readEntity(storeName, id);
    if (e) entities.push(e);
  }
  return entities;
}

function compareCursor(a: Entity, b: Entity): number {
  const da = new Date(a.updatedAt).getTime();
  const db = new Date(b.updatedAt).getTime();
  if (da !== db) return da - db;
  return String(a.id).localeCompare(String(b.id));
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function parsePath(url: string): { storeName: string; id: string | null } | null {
  const pathname = new URL(url, "http://localhost").pathname;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1) return { storeName: segments[0]!, id: null };
  if (segments.length === 2) return { storeName: segments[0]!, id: segments[1]! };
  return null;
}

async function handleGet(storeName: string, url: string): Promise<Response> {
  const u = new URL(url, "http://localhost");
  const size = Math.min(Math.max(1, parseInt(u.searchParams.get("size") ?? "100", 10)), 1000);
  const after = u.searchParams.get("after") ?? undefined;
  const afterId = u.searchParams.get("after_id") ?? undefined;

  let afterDate: Date | null = null;
  let afterIdVal: string | null = null;
  if (afterId !== undefined && afterId !== null && afterId !== "") {
    afterIdVal = afterId;
    if (after) afterDate = new Date(after);
  } else if (after) {
    const parts = after.split(",");
    if (parts.length >= 2) {
      afterDate = new Date(parts[0]!);
      afterIdVal = parts[1]!;
    } else {
      afterDate = new Date(after);
    }
  }

  const all = await getAllEntities(storeName);
  all.sort(compareCursor);

  let startIndex = 0;
  if (afterDate !== null && afterIdVal !== null) {
    const t = afterDate.getTime();
    startIndex = all.findIndex((e) => {
      const et = new Date(e.updatedAt).getTime();
      return et > t || (et === t && String(e.id) > afterIdVal!);
    });
    if (startIndex < 0) startIndex = all.length;
  } else if (afterDate !== null) {
    const t = afterDate.getTime();
    startIndex = all.findIndex((e) => new Date(e.updatedAt).getTime() > t);
    if (startIndex < 0) startIndex = all.length;
  }

  const slice = all.slice(startIndex, startIndex + size + 1);
  const hasMore = slice.length > size;
  const data = hasMore ? slice.slice(0, size) : slice;

  return new Response(JSON.stringify({ data, hasMore }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handlePost(storeName: string, req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const id = body.id;
  if (id === undefined || id === null) return new Response("Bad Request", { status: 400 });

  const existing = await readEntity(storeName, String(id));
  if (existing) return new Response("Conflict", { status: 409 });

  const now = new Date().toISOString();
  const entity: Entity = {
    ...body,
    id: String(id),
    version: 1,
    updatedAt: now,
  } as Entity;
  await writeEntity(storeName, entity);
  return new Response(null, { status: 204 });
}

async function handlePut(storeName: string, id: string, req: Request): Promise<Response> {
  const existing = await readEntity(storeName, id);
  if (!existing) return new Response(null, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const expectedVersion = existing.version + 1;
  if (Number(body.version) !== expectedVersion) {
    return new Response(JSON.stringify(existing), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date().toISOString();
  const entity: Entity = {
    ...body,
    id: existing.id,
    version: expectedVersion,
    updatedAt: now,
  } as Entity;
  await writeEntity(storeName, entity);
  return new Response(null, { status: 204 });
}

async function handleDelete(storeName: string, id: string): Promise<Response> {
  const existing = await readEntity(storeName, id);
  if (!existing) return new Response(null, { status: 404 });

  const now = new Date().toISOString();
  const tombstone: Entity = {
    id: existing.id,
    version: -1,
    updatedAt: now,
  };
  await writeEntity(storeName, tombstone);
  return new Response(null, { status: 204 });
}

async function handleFetch(req: Request): Promise<Response> {
  const url = req.url;
  const method = req.method;
  const origin = req.headers.get("Origin") ?? null;

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Max-Age": "86400",
        ...corsHeaders(origin),
      },
    });
  }

  const path = parsePath(url);
  if (!path) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  try {
    assertValidStoreName(path.storeName);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid store name" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  let res: Response;
  try {
    if (path.id === null) {
      if (method === "GET") res = await handleGet(path.storeName, url);
      else if (method === "POST") res = await handlePost(path.storeName, req);
      else res = new Response("Method Not Allowed", { status: 405 });
    } else {
      if (method === "GET") {
        const entity = await readEntity(path.storeName, path.id);
        if (!entity) res = new Response(null, { status: 404 });
        else res = jsonResponse(entity);
      } else if (method === "PUT") res = await handlePut(path.storeName, path.id, req);
      else if (method === "DELETE") res = await handleDelete(path.storeName, path.id);
      else res = new Response("Method Not Allowed", { status: 405 });
    }
  } catch (err) {
    console.error(err);
    res = new Response("Internal Server Error", { status: 500 });
  }

  const h = new Headers(res.headers);
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => h.set(k, v));
  return new Response(res.body, { status: res.status, headers: h });
}

await ensureStorageRoot();

const server = Bun.serve({
  port: PORT,
  fetch: handleFetch,
  error(err) {
    console.error(err);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`SyncedDB file backend listening at http://localhost:${server.port} (storage: ${STORAGE_PATH})`);
