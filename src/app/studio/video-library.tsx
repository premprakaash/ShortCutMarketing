"use client";

import type { ModelInfo, Video } from "./use-videos";

const STATUS: Record<Video["status"], string> = {
  queued: "In queue",
  running: "Generating",
  done: "Ready",
  failed: "Failed",
};

export default function VideoLibrary({
  videos,
  models,
  pickedUrl,
  onPick,
  pickLabel = "Use in campaign",
}: {
  videos: Video[];
  models: ModelInfo[];
  pickedUrl?: string;
  onPick?: (v: Video) => void;
  pickLabel?: string;
}) {
  if (videos.length === 0) {
    return (
      <div className="empty">
        <div className="big">✦</div>
        Your generated videos will appear here.
      </div>
    );
  }
  return (
    <div className="video-grid">
      {videos.map((v) => (
        <div key={v.id} className={`video-card${pickedUrl && v.videoUrl === pickedUrl ? " picked" : ""}`}>
          <div className="video-frame" style={{ aspectRatio: v.aspectRatio.replace(":", " / ") }}>
            {v.status === "done" && v.videoUrl ? (
              <video src={v.videoUrl} controls playsInline muted loop preload="metadata" />
            ) : v.status === "failed" ? (
              <span className="faint" style={{ padding: 12, textAlign: "center" }}>
                {v.error ?? "Generation failed"}
              </span>
            ) : (
              <div className="spinner" />
            )}
          </div>
          <div className="video-body">
            <div className="row spread">
              <span className={`badge ${v.status}`}>{STATUS[v.status]}</span>
              <span className="faint">
                {v.aspectRatio} · {v.duration}s
              </span>
            </div>
            <div className="faint">{models.find((m) => m.id === v.model)?.name ?? v.model}</div>
            <div className="muted clamp2" title={v.prompt}>
              {v.prompt}
            </div>
            {v.status === "done" && v.videoUrl && (
              <div className="row">
                {onPick ? (
                  <button className="btn small primary" onClick={() => onPick(v)}>
                    {pickedUrl === v.videoUrl ? "✓ Selected" : pickLabel}
                  </button>
                ) : (
                  <a className="btn small primary" href={`/create?videoUrl=${encodeURIComponent(v.videoUrl)}`}>
                    {pickLabel}
                  </a>
                )}
                <a className="btn small ghost" href={v.videoUrl} target="_blank" rel="noreferrer" download>
                  Download
                </a>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
