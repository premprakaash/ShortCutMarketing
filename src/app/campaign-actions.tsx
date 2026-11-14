"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CampaignActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = status === "ACTIVE" ? "PAUSED" : "ACTIVE";

  async function toggle() {
    if (next === "ACTIVE" && !confirm("Start this campaign? It will begin spending your budget.")) return;
    setBusy(true);
    const res = await fetch(`/api/campaigns/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Could not update campaign");
      return;
    }
    router.refresh();
  }

  return (
    <button className="btn small" onClick={toggle} disabled={busy}>
      {busy ? "…" : next === "ACTIVE" ? "Start" : "Pause"}
    </button>
  );
}
