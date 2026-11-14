"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Conn = { id: string; label: string; currency: string; hasPage: boolean };

const OBJECTIVES = [
  { value: "traffic", label: "Website visits", help: "Send people to your link" },
  { value: "video_views", label: "Video views", help: "Get your video watched" },
  { value: "awareness", label: "Reach", help: "Show it to as many people as possible" },
];

const CTAS = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "WATCH_MORE", "CONTACT_US", "BOOK_NOW"];

export default function BoostForm({
  connections,
  defaults,
}: {
  connections: Conn[];
  defaults: { videoUrl: string; thumbnailUrl: string; title: string; link: string };
}) {
  const router = useRouter();
  const [connectionId, setConnectionId] = useState(connections[0].id);
  const conn = connections.find((c) => c.id === connectionId)!;

  const [f, setF] = useState({
    name: defaults.title ? `Boost: ${defaults.title}` : "",
    objective: "traffic",
    dailyBudget: "500",
    countries: "IN",
    ageMin: "18",
    ageMax: "65",
    gender: "all",
    videoUrl: defaults.videoUrl,
    thumbnailUrl: defaults.thumbnailUrl,
    primaryText: "",
    headline: defaults.title,
    linkUrl: defaults.link,
    callToAction: "LEARN_MORE",
    days: "7",
    launchActive: false,
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.launchActive && !confirm(`Start spending up to ${f.dailyBudget} ${conn.currency} per day now?`)) return;
    setBusy(true);
    setErrors([]);

    const start = new Date(Date.now() + 10 * 60 * 1000); // give the platform a few minutes for review
    const days = Number(f.days);
    const spec = {
      name: f.name,
      objective: f.objective,
      dailyBudget: Number(f.dailyBudget),
      startTime: start.toISOString(),
      endTime: days > 0 ? new Date(start.getTime() + days * 86_400_000).toISOString() : undefined,
      audience: {
        countries: f.countries.split(",").map((c) => c.trim()).filter(Boolean),
        ageMin: Number(f.ageMin),
        ageMax: Number(f.ageMax),
        gender: f.gender,
      },
      creative: {
        videoUrl: f.videoUrl,
        thumbnailUrl: f.thumbnailUrl || undefined,
        primaryText: f.primaryText,
        headline: f.headline,
        linkUrl: f.linkUrl,
        callToAction: f.callToAction,
      },
      launchActive: f.launchActive,
    };

    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, spec }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(
        body.issues?.map((i: { path: string; message: string }) => `${i.path.replace("spec.", "")}: ${i.message}`) ?? [
          body.error ?? "Could not create the ad",
        ],
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form className="card" onSubmit={submit}>
      {errors.length > 0 && (
        <div className="alert error">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      <fieldset>
        <legend>Where</legend>
        <div className="grid2">
          <div>
            <label>Ad account</label>
            <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {!conn.hasPage && <div className="muted">Choose a Facebook Page for this account on the Ad accounts page.</div>}
          </div>
          <div>
            <label>Campaign name</label>
            <input required value={f.name} onChange={set("name")} placeholder="Diwali sale video" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Goal &amp; budget</legend>
        <div className="grid2">
          <div>
            <label>Goal</label>
            <select value={f.objective} onChange={set("objective")}>
              {OBJECTIVES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} — {o.help}
                </option>
              ))}
            </select>
          </div>
          <div className="grid2">
            <div>
              <label>
                Daily budget <span className="hint">({conn.currency})</span>
              </label>
              <input type="number" min="1" step="1" required value={f.dailyBudget} onChange={set("dailyBudget")} />
            </div>
            <div>
              <label>
                Run for <span className="hint">(days, 0 = no end)</span>
              </label>
              <input type="number" min="0" max="365" value={f.days} onChange={set("days")} />
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Audience</legend>
        <div className="grid2">
          <div>
            <label>
              Countries <span className="hint">(codes, comma separated, e.g. IN, AE)</span>
            </label>
            <input required value={f.countries} onChange={set("countries")} />
          </div>
          <div className="grid2">
            <div>
              <label>Age</label>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input type="number" min="18" max="65" value={f.ageMin} onChange={set("ageMin")} />
                <span>–</span>
                <input type="number" min="18" max="65" value={f.ageMax} onChange={set("ageMax")} />
              </div>
            </div>
            <div>
              <label>Gender</label>
              <select value={f.gender} onChange={set("gender")}>
                <option value="all">All</option>
                <option value="female">Women</option>
                <option value="male">Men</option>
              </select>
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Ad</legend>
        <div className="grid2">
          <div>
            <label>
              Video URL <span className="hint">(public MP4/MOV link from ShortcutVid)</span>
            </label>
            <input type="url" required value={f.videoUrl} onChange={set("videoUrl")} placeholder="https://cdn.shortcutvid.in/…mp4" />
          </div>
          <div>
            <label>
              Cover image URL <span className="hint">(optional)</span>
            </label>
            <input type="url" value={f.thumbnailUrl} onChange={set("thumbnailUrl")} />
          </div>
          <div>
            <label>Headline</label>
            <input required maxLength={255} value={f.headline} onChange={set("headline")} />
          </div>
          <div>
            <label>Link people go to</label>
            <input type="url" required value={f.linkUrl} onChange={set("linkUrl")} placeholder="https://yourshop.in" />
          </div>
          <div>
            <label>Button</label>
            <select value={f.callToAction} onChange={set("callToAction")}>
              {CTAS.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ").toLowerCase().replace(/^./, (s) => s.toUpperCase())}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label>Ad text</label>
          <textarea required value={f.primaryText} onChange={set("primaryText")} placeholder="What should people know?" />
        </div>
      </fieldset>

      <div className="row spread">
        <label className="row" style={{ fontWeight: 400, margin: 0 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={f.launchActive} onChange={set("launchActive")} />
          Start the ad right away (otherwise it is saved paused)
        </label>
        <button className="btn primary" disabled={busy || !conn.hasPage}>
          {busy ? "Creating ad… (can take a minute)" : "Create ad"}
        </button>
      </div>
    </form>
  );
}
