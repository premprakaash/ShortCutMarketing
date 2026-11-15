"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { platformInfo } from "@/lib/platforms";
import { PlatformLogo } from "../platform-badge";
import { postJson, useVideos, type ModelInfo, type Video } from "../studio/use-videos";
import VideoGenerator from "../studio/video-generator";
import VideoLibrary from "../studio/video-library";

type Account = {
  id: string;
  platform: string;
  accountName: string;
  currency: string;
  pageLabel: string | null;
  pageName: string | null;
  ready: boolean;
};

type Kit = {
  campaignName: string;
  videoPrompt: string;
  primaryText: string;
  headline: string;
  headlines: string[];
  descriptions: string[];
  longHeadline: string;
  businessName: string;
  keywords: string[];
  callToAction: string;
};

type Outcome = { connectionId: string; platform: string; accountName: string | null; ok: boolean; error?: string };

const STEPS = ["Describe", "Video", "Platforms & budget", "Audience", "Ad copy", "Launch"];
const CTAS = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "WATCH_MORE", "CONTACT_US", "BOOK_NOW"];
const ctaLabel = (c: string) => c.replace("_", " ").toLowerCase().replace(/^./, (s) => s.toUpperCase());
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`counter${value.length > max ? " over" : ""}`}>{value.length}/{max}</span>;
}

export default function Wizard({
  accounts,
  models,
  aiReady,
  videoReady,
  defaults,
}: {
  accounts: Account[];
  models: ModelInfo[];
  aiReady: boolean;
  videoReady: boolean;
  defaults: { videoUrl: string; thumbnailUrl: string; title: string; link: string };
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { videos, setVideos } = useVideos();

  // 1. Describe
  const [brief, setBrief] = useState({
    product: defaults.title,
    brand: "",
    audience: "",
    offer: "",
    objective: "traffic",
    tone: "friendly and confident",
    language: "English",
  });
  const [videoPrompt, setVideoPrompt] = useState("");

  // 2. Video
  const [videoTab, setVideoTab] = useState<"generate" | "library" | "url">(defaults.videoUrl ? "url" : "generate");
  const [videoUrl, setVideoUrl] = useState(defaults.videoUrl);
  const [thumbnailUrl, setThumbnailUrl] = useState(defaults.thumbnailUrl);

  // 3. Platforms
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [total, setTotal] = useState("1000");

  // 4. Audience
  const [aud, setAud] = useState({ countries: "IN", ageMin: "18", ageMax: "65", gender: "all", days: "7" });

  // 5. Copy
  const [copy, setCopy] = useState({
    name: defaults.title ? `${defaults.title} campaign` : "",
    primaryText: "",
    headline: defaults.title.slice(0, 40),
    headlines: "",
    descriptions: "",
    longHeadline: "",
    businessName: "",
    keywords: "",
    linkUrl: defaults.link,
    callToAction: "LEARN_MORE",
    logoUrl: "",
    youtubeVideoId: "",
  });

  // 6. Launch
  const [launchActive, setLaunchActive] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);

  const selected = accounts.filter((a) => budgets[a.id] !== undefined);
  const set = <T extends object>(setter: React.Dispatch<React.SetStateAction<T>>, k: keyof T) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setter((s) => ({ ...s, [k]: e.target.value }));

  async function generateKit() {
    setBusy(true);
    setError(null);
    try {
      const { kit } = await postJson<{ kit: Kit }>("/api/ai/ad-kit", brief);
      setVideoPrompt(kit.videoPrompt);
      setCopy((c) => ({
        ...c,
        name: c.name || kit.campaignName,
        primaryText: kit.primaryText,
        headline: kit.headline,
        headlines: kit.headlines.join("\n"),
        descriptions: kit.descriptions.join("\n"),
        longHeadline: kit.longHeadline,
        businessName: kit.businessName || brief.brand.slice(0, 25),
        keywords: kit.keywords.join("\n"),
        callToAction: kit.callToAction,
      }));
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(a: Account) {
    setBudgets((b) => {
      const next = { ...b };
      if (next[a.id] !== undefined) delete next[a.id];
      else next[a.id] = "500";
      return next;
    });
  }

  function splitEvenly() {
    if (!selected.length) return;
    const each = Math.max(1, Math.floor(Number(total) / selected.length));
    setBudgets(Object.fromEntries(selected.map((a) => [a.id, String(each)])));
  }

  const needs = useMemo(() => {
    const out: string[] = [];
    const platforms = new Set(selected.map((a) => a.platform));
    if (platforms.has("google")) {
      if (copy.youtubeVideoId) {
        if (!copy.logoUrl) out.push("Google (YouTube): add a square logo image URL.");
        if (!copy.businessName) out.push("Google (YouTube): add a business name.");
      } else {
        if (lines(copy.headlines).length < 3) out.push("Google Search: add at least 3 short headlines.");
        if (lines(copy.descriptions).length < 1) out.push("Google Search: add at least 1 description.");
        if (lines(copy.keywords).length < 1) out.push("Google Search: add keywords.");
      }
    }
    if (platforms.has("pinterest") && !thumbnailUrl) out.push("Pinterest: add a cover image URL in the Video step.");
    for (const a of selected) if (!a.ready) out.push(`${platformInfo(a.platform).short}: choose a ${a.pageLabel?.toLowerCase()} on the Ad accounts page.`);
    return out;
  }, [selected, copy, thumbnailUrl]);

  async function launch() {
    if (launchActive && !confirm("Start these ads now? They will begin spending their daily budgets.")) return;
    setBusy(true);
    setError(null);
    const start = new Date(Date.now() + 15 * 60_000);
    const days = Number(aud.days);
    try {
      const r = await postJson<{ results: Outcome[] }>("/api/launch", {
        name: copy.name,
        objective: brief.objective,
        startTime: start.toISOString(),
        endTime: days > 0 ? new Date(start.getTime() + days * 86_400_000).toISOString() : undefined,
        audience: {
          countries: aud.countries.split(",").map((c) => c.trim()).filter(Boolean),
          ageMin: Number(aud.ageMin),
          ageMax: Number(aud.ageMax),
          gender: aud.gender,
        },
        creative: {
          videoUrl,
          thumbnailUrl: thumbnailUrl || undefined,
          primaryText: copy.primaryText,
          headline: copy.headline,
          headlines: lines(copy.headlines),
          descriptions: lines(copy.descriptions),
          longHeadline: copy.longHeadline || undefined,
          businessName: copy.businessName || undefined,
          logoUrl: copy.logoUrl || undefined,
          youtubeVideoId: copy.youtubeVideoId || undefined,
          keywords: lines(copy.keywords),
          linkUrl: copy.linkUrl,
          callToAction: copy.callToAction,
        },
        launchActive,
        targets: selected.map((a) => ({ connectionId: a.id, dailyBudget: Number(budgets[a.id]) })),
      });
      setResults(r.results);
    } catch (e) {
      setError((e as Error).message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  const canNext = [
    true,
    Boolean(videoUrl),
    selected.length > 0 && selected.every((a) => Number(budgets[a.id]) > 0),
    Boolean(aud.countries.trim()),
    Boolean(copy.name && copy.primaryText && copy.headline && copy.linkUrl),
    true,
  ][step];

  if (accounts.length === 0) {
    return (
      <div className="card empty">
        <div className="big">🔌</div>
        <p>Connect at least one ad account (and choose its ad account) to create campaigns.</p>
        <Link href="/connections" className="btn primary">
          Connect ad accounts →
        </Link>
      </div>
    );
  }

  if (results) {
    const ok = results.filter((r) => r.ok).length;
    return (
      <div className="card">
        <h2>{ok === results.length ? "🎉 Your ads were created" : `${ok} of ${results.length} platforms succeeded`}</h2>
        <p className="muted">{launchActive ? "They start running in about 15 minutes, after platform review." : "They're saved paused. Start them from the dashboard when you're ready."}</p>
        <div className="stack" style={{ marginTop: 14 }}>
          {results.map((r) => (
            <div key={r.connectionId} className="row spread" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
              <div className="row">
                <PlatformLogo id={r.platform} size={28} />
                <div>
                  <strong>{platformInfo(r.platform).short}</strong> <span className="muted">{r.accountName}</span>
                  {r.error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{r.error}</div>}
                </div>
              </div>
              <span className={`badge ${r.ok ? "done" : "failed"}`}>{r.ok ? "Created" : "Failed"}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <Link href="/" className="btn primary">
            Go to dashboard
          </Link>
          {ok < results.length && (
            <button className="btn" onClick={() => setResults(null)}>
              Fix and retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="steps">
        {STEPS.map((s, i) => (
          <button key={s} className={`step-pill${i === step ? " on" : ""}${i < step ? " done" : ""}`} onClick={() => setStep(i)}>
            <span className="n">{i < step ? "✓" : i + 1}</span>
            {s}
          </button>
        ))}
      </div>

      {error && <div className="alert error" style={{ whiteSpace: "pre-line" }}>{error}</div>}

      <div className="card">
        {step === 0 && (
          <>
            <h2>What are you advertising?</h2>
            <p className="muted" style={{ marginTop: -6 }}>
              AI turns this into a video prompt plus ad copy sized for every platform. You can edit everything after.
            </p>
            <div className="field">
              <label>Product or service</label>
              <textarea value={brief.product} onChange={set(setBrief, "product")} placeholder="e.g. Handmade cold brew coffee delivered in Bengaluru, 3 flavours, no sugar" />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Brand name</label>
                <input value={brief.brand} onChange={set(setBrief, "brand")} maxLength={60} />
              </div>
              <div className="field">
                <label>Who is it for?</label>
                <input value={brief.audience} onChange={set(setBrief, "audience")} placeholder="Working professionals 22–35" />
              </div>
              <div className="field">
                <label>
                  Offer <span className="hint">(optional)</span>
                </label>
                <input value={brief.offer} onChange={set(setBrief, "offer")} placeholder="20% off first order" />
              </div>
              <div className="field">
                <label>Goal</label>
                <select value={brief.objective} onChange={set(setBrief, "objective")}>
                  <option value="traffic">Website visits</option>
                  <option value="video_views">Video views</option>
                  <option value="awareness">Reach / awareness</option>
                </select>
              </div>
              <div className="field">
                <label>Tone</label>
                <input value={brief.tone} onChange={set(setBrief, "tone")} />
              </div>
              <div className="field">
                <label>Ad language</label>
                <input value={brief.language} onChange={set(setBrief, "language")} placeholder="English, Hindi, Tamil…" />
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>Choose the video</h2>
            <div className="chips" style={{ marginBottom: 16 }}>
              {(
                [
                  ["generate", "✦ Generate with AI"],
                  ["library", `My videos (${videos.filter((v) => v.status === "done").length})`],
                  ["url", "Paste a link"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={`chip${videoTab === k ? " on" : ""}`} onClick={() => setVideoTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            {videoTab === "generate" && (
              <VideoGenerator
                models={models}
                aiReady={aiReady}
                videoReady={videoReady}
                initialPrompt={videoPrompt}
                onStarted={(v: Video) => {
                  setVideos((list) => [v, ...list]);
                  setVideoTab("library");
                }}
              />
            )}
            {videoTab === "library" && (
              <VideoLibrary
                videos={videos}
                models={models}
                pickedUrl={videoUrl}
                pickLabel="Use this video"
                onPick={(v) => setVideoUrl(v.videoUrl ?? "")}
              />
            )}
            {videoTab === "url" && (
              <div className="field">
                <label>
                  Video URL <span className="hint">(public MP4/MOV, e.g. from ShortcutVid)</span>
                </label>
                <input type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…/video.mp4" />
              </div>
            )}
            <hr className="divider" />
            <div className="grid2">
              <div>
                <label>
                  Cover image URL <span className="hint">(optional; required for Pinterest)</span>
                </label>
                <input type="url" value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} />
              </div>
              <div>
                <label>Selected video</label>
                {videoUrl ? (
                  <div className="mono clamp2" style={{ color: "var(--yellow)" }}>
                    {videoUrl}
                  </div>
                ) : (
                  <div className="faint">None yet</div>
                )}
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="row spread">
              <h2 style={{ margin: 0 }}>Where should it run?</h2>
              <div className="row">
                <input style={{ width: 130 }} type="number" min="1" value={total} onChange={(e) => setTotal(e.target.value)} aria-label="Total daily budget" />
                <button className="btn small" onClick={splitEvenly} disabled={!selected.length}>
                  Split total evenly
                </button>
              </div>
            </div>
            <p className="muted">Pick platforms and set each one&apos;s daily budget in that account&apos;s currency.</p>
            <div className="grid-auto">
              {accounts.map((a) => {
                const on = budgets[a.id] !== undefined;
                return (
                  <div key={a.id} className={`tile${on ? " selected" : ""}`}>
                    <label className="tile-head" style={{ margin: 0, cursor: "pointer" }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(a)} />
                      <PlatformLogo id={a.platform} size={28} />
                      <div style={{ flex: 1 }}>
                        <strong>{platformInfo(a.platform).short}</strong>
                        <div className="faint">{a.accountName}</div>
                      </div>
                    </label>
                    {!a.ready && <div className="faint" style={{ color: "var(--warn)" }}>Choose a {a.pageLabel?.toLowerCase()} on Ad accounts</div>}
                    {on && (
                      <div>
                        <label>Daily budget ({a.currency})</label>
                        <input
                          type="number"
                          min="1"
                          value={budgets[a.id]}
                          onChange={(e) => setBudgets((b) => ({ ...b, [a.id]: e.target.value }))}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Who should see it?</h2>
            <div className="grid2">
              <div className="field">
                <label>
                  Countries <span className="hint">(2-letter codes, comma separated)</span>
                </label>
                <input value={aud.countries} onChange={set(setAud, "countries")} placeholder="IN, AE, US" />
              </div>
              <div className="field">
                <label>
                  Run for <span className="hint">(days, 0 = until paused)</span>
                </label>
                <input type="number" min="0" max="365" value={aud.days} onChange={set(setAud, "days")} />
              </div>
              <div className="field">
                <label>Age</label>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input type="number" min="18" max="65" value={aud.ageMin} onChange={set(setAud, "ageMin")} />
                  <span className="muted">to</span>
                  <input type="number" min="18" max="65" value={aud.ageMax} onChange={set(setAud, "ageMax")} />
                </div>
              </div>
              <div className="field">
                <label>Gender</label>
                <div className="chips">
                  {[
                    ["all", "Everyone"],
                    ["female", "Women"],
                    ["male", "Men"],
                  ].map(([v, l]) => (
                    <button key={v} className={`chip${aud.gender === v ? " on" : ""}`} onClick={() => setAud((s) => ({ ...s, gender: v }))}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="row spread">
              <h2 style={{ margin: 0 }}>Ad copy</h2>
              {aiReady && (
                <button className="btn small" onClick={generateKit} disabled={busy || brief.product.trim().length < 3}>
                  {busy ? "Writing…" : "✦ Rewrite with AI"}
                </button>
              )}
            </div>
            <p className="muted">Shared by every platform. Extra fields are only used where a platform needs them.</p>
            <div className="grid2">
              <div className="field">
                <label>Campaign name</label>
                <input value={copy.name} onChange={set(setCopy, "name")} />
              </div>
              <div className="field">
                <label>Link people go to</label>
                <input type="url" value={copy.linkUrl} onChange={set(setCopy, "linkUrl")} placeholder="https://yourshop.in" />
              </div>
            </div>
            <div className="field">
              <label>
                Main text <Counter value={copy.primaryText} max={500} />
              </label>
              <textarea value={copy.primaryText} onChange={set(setCopy, "primaryText")} />
            </div>
            <div className="grid2">
              <div className="field">
                <label>
                  Headline <Counter value={copy.headline} max={40} />
                </label>
                <input value={copy.headline} onChange={set(setCopy, "headline")} />
              </div>
              <div className="field">
                <label>Button</label>
                <select value={copy.callToAction} onChange={set(setCopy, "callToAction")}>
                  {CTAS.map((c) => (
                    <option key={c} value={c}>
                      {ctaLabel(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>
                  Brand name <Counter value={copy.businessName} max={25} />
                </label>
                <input value={copy.businessName} onChange={set(setCopy, "businessName")} />
              </div>
              <div className="field">
                <label>
                  Long headline <span className="hint">(Google)</span> <Counter value={copy.longHeadline} max={90} />
                </label>
                <input value={copy.longHeadline} onChange={set(setCopy, "longHeadline")} />
              </div>
            </div>
            <details style={{ marginTop: 6 }} open={selected.some((a) => a.platform === "google")}>
              <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 12 }}>Google Ads extras</summary>
              <div className="grid2">
                <div className="field">
                  <label>
                    Short headlines <span className="hint">(one per line, max 30 chars, 3+)</span>
                  </label>
                  <textarea value={copy.headlines} onChange={set(setCopy, "headlines")} rows={5} />
                </div>
                <div className="field">
                  <label>
                    Descriptions <span className="hint">(one per line, max 90 chars)</span>
                  </label>
                  <textarea value={copy.descriptions} onChange={set(setCopy, "descriptions")} rows={5} />
                </div>
                <div className="field">
                  <label>
                    Search keywords <span className="hint">(one per line)</span>
                  </label>
                  <textarea value={copy.keywords} onChange={set(setCopy, "keywords")} rows={5} />
                </div>
                <div>
                  <div className="field">
                    <label>
                      YouTube video ID <span className="hint">(for YouTube ads instead of Search)</span>
                    </label>
                    <input value={copy.youtubeVideoId} onChange={set(setCopy, "youtubeVideoId")} placeholder="dQw4w9WgXcQ" />
                  </div>
                  <div className="field">
                    <label>
                      Square logo URL <span className="hint">(YouTube ads)</span>
                    </label>
                    <input type="url" value={copy.logoUrl} onChange={set(setCopy, "logoUrl")} />
                  </div>
                </div>
              </div>
            </details>
          </>
        )}

        {step === 5 && (
          <>
            <h2>Review &amp; launch</h2>
            <div className="grid2">
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  <span className="faint">Campaign</span>
                  <div>
                    <strong>{copy.name || "—"}</strong>
                  </div>
                </div>
                <div>
                  <span className="faint">Audience</span>
                  <div>
                    {aud.countries} · {aud.ageMin}–{aud.ageMax} · {aud.gender === "all" ? "everyone" : aud.gender} ·{" "}
                    {Number(aud.days) > 0 ? `${aud.days} days` : "until paused"}
                  </div>
                </div>
                <div>
                  <span className="faint">Ad</span>
                  <div>{copy.headline}</div>
                  <div className="muted clamp2">{copy.primaryText}</div>
                </div>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <span className="faint">Platforms &amp; daily budgets</span>
                {selected.map((a) => (
                  <div key={a.id} className="row spread">
                    <span className="row" style={{ gap: 8 }}>
                      <PlatformLogo id={a.platform} size={22} /> {platformInfo(a.platform).short}
                    </span>
                    <strong>
                      {budgets[a.id]} {a.currency}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
            {needs.length > 0 && (
              <div className="alert info" style={{ marginTop: 16 }}>
                {needs.map((n) => (
                  <div key={n}>• {n}</div>
                ))}
              </div>
            )}
            <hr className="divider" />
            <label className="row" style={{ fontWeight: 500 }}>
              <input type="checkbox" checked={launchActive} onChange={(e) => setLaunchActive(e.target.checked)} />
              Start the ads right away (otherwise they&apos;re saved paused so you can review them on each platform)
            </label>
          </>
        )}
      </div>

      <div className="wizard-foot">
        <button className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          ← Back
        </button>
        <div className="row">
          {step === 0 && (
            <button className="btn" onClick={() => setStep(1)}>
              Skip — I&apos;ll write it myself
            </button>
          )}
          {step === 0 ? (
            <button className="btn primary" onClick={generateKit} disabled={!aiReady || busy || brief.product.trim().length < 3} title={aiReady ? "" : "Add ANTHROPIC_API_KEY to enable AI"}>
              {busy ? "AI is writing…" : "✦ Generate ad with AI"}
            </button>
          ) : step < STEPS.length - 1 ? (
            <button className="btn primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Next →
            </button>
          ) : (
            <button className="btn primary big" onClick={launch} disabled={busy || selected.length === 0 || !videoUrl}>
              {busy ? "Creating ads… (can take a few minutes)" : `🚀 Launch on ${selected.length} platform${selected.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
