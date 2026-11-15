"use client";

import { useCallback, useEffect, useState } from "react";

export type Video = {
  id: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  duration: number;
  status: "queued" | "running" | "done" | "failed";
  videoUrl: string | null;
  error: string | null;
  createdAt: string;
};

export type ModelInfo = { id: string; name: string; note: string; durations: number[]; aspects: string[] };

/** The user's video library, polling every few seconds while anything is generating. */
export function useVideos() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/videos");
    if (r.ok) setVideos((await r.json()).videos);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pending = videos.some((v) => v.status === "queued" || v.status === "running");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [pending, refresh]);

  return { videos, loaded, refresh, setVideos };
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const issues = (json.issues as { path: string; message: string }[] | undefined)?.map((i) => `${i.path}: ${i.message}`);
    throw new Error(issues?.join("\n") || json.error || "Request failed");
  }
  return json as T;
}
