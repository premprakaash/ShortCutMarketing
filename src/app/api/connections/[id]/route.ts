import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { connectionOptions, deleteConnection, selectAccount } from "@/lib/service";
import { getUserId } from "@/lib/user";

type Ctx = { params: Promise<{ id: string }> };

/** Ad accounts and pages available on this connection. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return NextResponse.json(await connectionOptions(await getUserId(), id));
  } catch (err) {
    return errorResponse(err);
  }
}

const SelectSchema = z.object({ adAccountId: z.string().min(1), pageId: z.string().min(1).nullable().default(null) });

/** Choose which ad account / page this connection uses. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = SelectSchema.parse(await req.json());
    await selectAccount(await getUserId(), id, body.adAccountId, body.pageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteConnection(await getUserId(), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
