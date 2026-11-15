"use client";

import { useVideos, type ModelInfo } from "./use-videos";
import VideoGenerator from "./video-generator";
import VideoLibrary from "./video-library";

export default function Studio({ models, aiReady, videoReady }: { models: ModelInfo[]; aiReady: boolean; videoReady: boolean }) {
  const { videos, loaded, setVideos } = useVideos();
  return (
    <>
      <div className="card">
        <VideoGenerator models={models} aiReady={aiReady} videoReady={videoReady} onStarted={(v) => setVideos((list) => [v, ...list])} />
      </div>
      <div className="section">
        <h2>Your videos</h2>
        {loaded ? <VideoLibrary videos={videos} models={models} /> : <div className="muted">Loading…</div>}
      </div>
    </>
  );
}
