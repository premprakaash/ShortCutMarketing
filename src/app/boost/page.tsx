import Link from "next/link";
import { listConnections } from "@/lib/service";
import { getUserId } from "@/lib/user";
import BoostForm from "./boost-form";

export const dynamic = "force-dynamic";

/**
 * "Boost this video". ShortcutVid can link here with the video pre-filled:
 * /boost?videoUrl=...&thumbnailUrl=...&title=...&link=...
 */
export default async function BoostPage({
  searchParams,
}: {
  searchParams: Promise<{ videoUrl?: string; thumbnailUrl?: string; title?: string; link?: string }>;
}) {
  const q = await searchParams;
  const ready = (await listConnections(await getUserId())).filter((c) => c.adAccountId);

  return (
    <main>
      <h1>Boost a video</h1>
      <p className="sub">Turn a video into an ad. It is created paused unless you choose to start it right away.</p>
      {ready.length === 0 ? (
        <div className="card empty">
          Connect an ad account and choose a page first. <Link href="/connections">Go to Ad accounts →</Link>
        </div>
      ) : (
        <BoostForm
          connections={ready.map((c) => ({
            id: c.id,
            label: `${c.platform === "meta" ? "Meta" : c.platform} · ${c.adAccountName} (${c.currency})`,
            currency: c.currency ?? "INR",
            hasPage: Boolean(c.pageId),
          }))}
          defaults={{
            videoUrl: q.videoUrl ?? "",
            thumbnailUrl: q.thumbnailUrl ?? "",
            title: q.title ?? "",
            link: q.link ?? "",
          }}
        />
      )}
    </main>
  );
}
