import { CampaignSpecSchema } from "@/lib/connectors/types";

export type Call = { method: string; url: URL; path: string; body: unknown; headers: Record<string, string> };
type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; raw?: BodyInit };
type Handler = (call: Call) => Reply | unknown;

/**
 * A fake HTTP layer for connector tests. Routes are matched by
 * "METHOD host/path" (query string ignored); the first matching prefix wins.
 */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = Object.fromEntries(new URLSearchParams(body as string));
      }
    }
    const path = url.pathname;
    const call = { method, url, path, body, headers };
    calls.push(call);
    const key = `${method} ${url.host}${path}`;
    const match = Object.keys(routes)
      .filter((k) => key === k || key.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!match) return new Response(JSON.stringify({ error: { message: `no route for ${key}` } }), { status: 404 });
    const out = routes[match](call) as Reply;
    const isReply =
      out && typeof out === "object" && ("body" in out || "raw" in out || typeof (out as Reply).status === "number");
    const reply: Reply = isReply ? out : { body: out };
    const status = reply.status ?? 200;
    const noBody = status === 204 || status === 304;
    return new Response(noBody ? null : (reply.raw ?? JSON.stringify(reply.body ?? {})), {
      status,
      headers: reply.headers,
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

export const testDeps = { sleep: async () => {}, mediaPollMs: 1, mediaTimeoutMs: 5_000 };

export const baseSpec = CampaignSpecSchema.parse({
  name: "Diwali boost",
  objective: "traffic",
  dailyBudget: 500,
  audience: { countries: ["IN"], ageMin: 21, ageMax: 45, gender: "female" },
  creative: {
    videoUrl: "https://cdn.example.com/v.mp4",
    thumbnailUrl: "https://cdn.example.com/cover.jpg",
    primaryText: "Big Diwali sale on handmade sweets",
    headline: "50% off sweets",
    headlines: ["Diwali sweets sale", "Handmade in Pune", "Order today"],
    descriptions: ["Fresh handmade sweets delivered", "Gift boxes for every family"],
    businessName: "Sweet Co",
    keywords: ["diwali sweets", "buy sweets online"],
    linkUrl: "https://shop.example.com",
  },
});

export const VIDEO_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]); // tiny fake mp4
