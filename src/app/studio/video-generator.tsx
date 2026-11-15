"use client";

import { useState } from "react";
import { postJson, type ModelInfo, type Video } from "./use-videos";

/** Idea → AI prompt → choose model → generate. Used in AI Studio and the campaign wizard. */
export default function VideoGenerator({
  models,
  aiReady,
  videoReady,
  initialPrompt = "",
  onStarted,
}: {
  models: ModelInfo[];
  aiReady: boolean;
  videoReady: boolean;
  initialPrompt?: string;
  onStarted: (v: Video) => void;
}) {
  const [idea, setIdea] = useState("");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const [aspect, setAspect] = useState(model?.aspects[0] ?? "9:16");
  const [duration, setDuration] = useState(model?.durations.at(-1) ?? 8);
  const [busy, setBusy] = useState<"prompt" | "video" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep prompt in sync when the parent supplies one (e.g. from the AI ad kit)
  const [lastInitial, setLastInitial] = useState(initialPrompt);
  if (initialPrompt !== lastInitial) {
    setLastInitial(initialPrompt);
    if (initialPrompt) setPrompt(initialPrompt);
  }

  function pickModel(id: string) {
    const m = models.find((x) => x.id === id)!;
    setModelId(id);
    if (!m.aspects.includes(aspect)) setAspect(m.aspects[0]);
    if (!m.durations.includes(duration)) setDuration(m.durations.at(-1)!);
  }

  async function writePrompt() {
    setBusy("prompt");
    setError(null);
    try {
      const r = await postJson<{ prompt: string }>("/api/ai/prompt", { idea, aspectRatio: aspect, duration });
      setPrompt(r.prompt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("video");
    setError(null);
    try {
      const r = await postJson<{ video: Video }>("/api/videos", { model: model.id, prompt, aspectRatio: aspect, duration });
      onStarted(r.video);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      {error && <div className="alert error" style={{ whiteSpace: "pre-line" }}>{error}</div>}
      {!videoReady && (
        <div className="alert info">
          Video generation needs <span className="mono">FAL_KEY</span> in the server settings.
        </div>
      )}

      <div>
        <label>
          Your idea <span className="hint">(rough is fine)</span>
        </label>
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "stretch" }}>
          <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. Morning coffee ritual for our new cold brew, cozy and premium" />
          <button className="btn" onClick={writePrompt} disabled={!aiReady || idea.trim().length < 3 || busy !== null} title={aiReady ? "" : "Add ANTHROPIC_API_KEY to enable"}>
            {busy === "prompt" ? "Writing…" : "✦ Write prompt"}
          </button>
        </div>
      </div>

      <div>
        <label>
          Video prompt <span className="counter">{prompt.length}/2000</span>
        </label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={2000} placeholder="Describe the shot: subject, action, setting, lighting, camera movement, style, sound…" />
      </div>

      <div className="grid3">
        <div>
          <label>Model</label>
          <select value={model?.id} onChange={(e) => pickModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.note}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Format</label>
          <div className="chips">
            {model?.aspects.map((a) => (
              <button key={a} type="button" className={`chip${aspect === a ? " on" : ""}`} onClick={() => setAspect(a)}>
                {a === "9:16" ? "9:16 Reels" : a === "16:9" ? "16:9 YouTube" : "1:1 Feed"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label>Length</label>
          <div className="chips">
            {model?.durations.map((s) => (
              <button key={s} type="button" className={`chip${duration === s ? " on" : ""}`} onClick={() => setDuration(s)}>
                {s}s
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <button className="btn primary big" onClick={generate} disabled={!videoReady || prompt.trim().length < 5 || busy !== null}>
          {busy === "video" ? "Starting…" : "▶ Generate video"}
        </button>
        <span className="faint" style={{ marginLeft: 12 }}>
          Takes about 1–4 minutes. You can keep working meanwhile.
        </span>
      </div>
    </div>
  );
}
