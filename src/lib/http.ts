import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiError } from "./ai/claude";
import { VideoGenError } from "./ai/video";
import { ConnectorError } from "./connectors";

/** Turn thrown errors into clean JSON responses. */
export function errorResponse(err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  if (err instanceof ConnectorError || err instanceof AiError || err instanceof VideoGenError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  console.error(err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export function appUrl(path = ""): string {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}
