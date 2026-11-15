import { VIDEO_MODELS } from "@/lib/ai/video";
import { getConnector } from "@/lib/connectors";
import { listConnections } from "@/lib/service";
import { getUserId } from "@/lib/user";
import Wizard from "./wizard";

export const dynamic = "force-dynamic";

/**
 * Create a campaign on one or many platforms.
 * ShortcutVid can link here with a video pre-filled:
 * /create?videoUrl=...&thumbnailUrl=...&title=...&link=...
 */
export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ videoUrl?: string; thumbnailUrl?: string; title?: string; link?: string }>;
}) {
  const q = await searchParams;
  const conns = (await listConnections(await getUserId())).filter((c) => c.adAccountId);

  const accounts = conns.map((c) => {
    let pageLabel: string | null = null;
    try {
      pageLabel = getConnector(c.platform).pageLabel;
    } catch {
      /* platform keys removed from server */
    }
    return {
      id: c.id,
      platform: c.platform,
      accountName: c.adAccountName ?? "",
      currency: c.currency ?? "INR",
      pageLabel,
      pageName: c.pageName,
      ready: !pageLabel || Boolean(c.pageId),
    };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Create campaign</div>
          <h1>One ad. Every platform.</h1>
          <p className="sub">AI writes the copy and makes the video. You choose where it runs and how much to spend.</p>
        </div>
      </div>
      <Wizard
        accounts={accounts}
        models={VIDEO_MODELS.map(({ id, name, note, durations, aspects }) => ({ id, name, note, durations, aspects }))}
        aiReady={Boolean(process.env.ANTHROPIC_API_KEY)}
        videoReady={Boolean(process.env.FAL_KEY)}
        defaults={{ videoUrl: q.videoUrl ?? "", thumbnailUrl: q.thumbnailUrl ?? "", title: q.title ?? "", link: q.link ?? "" }}
      />
    </>
  );
}
