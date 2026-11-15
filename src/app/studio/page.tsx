import { VIDEO_MODELS } from "@/lib/ai/video";
import Studio from "./studio";

export const dynamic = "force-dynamic";

export default function StudioPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">AI Studio</div>
          <h1>Generate video ads</h1>
          <p className="sub">Describe your idea, let AI write the prompt, pick a video model and generate.</p>
        </div>
      </div>
      <Studio
        models={VIDEO_MODELS.map(({ id, name, note, durations, aspects }) => ({ id, name, note, durations, aspects }))}
        aiReady={Boolean(process.env.ANTHROPIC_API_KEY)}
        videoReady={Boolean(process.env.FAL_KEY)}
      />
    </>
  );
}
