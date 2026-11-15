import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { VideoJob } from "@/db/schema";
import { falConfigFromEnv, findModel, pollVideo, submitVideo, VideoGenError, type FalConfig } from "./video";

const { videoJobs } = schema;

export const VideoRequestSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().trim().min(5).max(2000),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  duration: z.number().int(),
});

export async function createVideoJob(userId: string, input: z.infer<typeof VideoRequestSchema>, config?: FalConfig) {
  const cfg = config ?? falConfigFromEnv();
  const model = findModel(input.model);
  const q = await submitVideo(cfg, model, input.prompt, input.aspectRatio, input.duration);
  const db = await getDb();
  const [row]: VideoJob[] = await db
    .insert(videoJobs)
    .values({
      id: randomUUID(),
      userId,
      provider: "fal",
      model: model.id,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      duration: input.duration,
      status: "queued",
      statusUrl: q.statusUrl,
      responseUrl: q.responseUrl,
    })
    .returning();
  return row;
}

/** Update a job from fal if it's still running. */
async function refresh(job: VideoJob, config: FalConfig): Promise<VideoJob> {
  if (job.status === "done" || job.status === "failed" || !job.statusUrl || !job.responseUrl) return job;
  const r = await pollVideo(config, job.statusUrl, job.responseUrl);
  const patch =
    r.state === "done"
      ? { status: "done", videoUrl: r.videoUrl }
      : r.state === "failed"
        ? { status: "failed", error: r.error }
        : { status: r.state };
  if (patch.status === job.status) return job;
  const db = await getDb();
  const [row]: VideoJob[] = await db
    .update(videoJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(videoJobs.id, job.id))
    .returning();
  return row;
}

export async function getVideoJob(userId: string, id: string, config?: FalConfig) {
  const db = await getDb();
  const [job]: VideoJob[] = await db.select().from(videoJobs).where(and(eq(videoJobs.id, id), eq(videoJobs.userId, userId)));
  if (!job) throw new VideoGenError("Video not found");
  return refresh(job, config ?? falConfigFromEnv());
}

export async function listVideoJobs(userId: string, config?: FalConfig) {
  const db = await getDb();
  const jobs: VideoJob[] = await db
    .select()
    .from(videoJobs)
    .where(eq(videoJobs.userId, userId))
    .orderBy(desc(videoJobs.createdAt))
    .limit(60);
  const pending = jobs.some((j) => j.status === "queued" || j.status === "running");
  if (!pending) return jobs;
  let cfg: FalConfig;
  try {
    cfg = config ?? falConfigFromEnv();
  } catch {
    return jobs;
  }
  return Promise.all(jobs.map((j) => refresh(j, cfg).catch(() => j)));
}
