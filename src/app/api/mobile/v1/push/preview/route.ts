import { NextResponse } from "next/server";
import { sendTopicPush } from "@/lib/push/fcm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function adminKey(): string {
  return process.env.PUSH_ADMIN_KEY ?? process.env.SPONSORSHIP_ADMIN_KEY ?? "";
}

function topicFor(segment: string): string {
  const cleaned = segment.trim().replace(/^slnews_/, "");
  return `slnews_${cleaned.replace(/[^A-Za-z0-9_.~%-]/g, "_")}`;
}

export async function GET() {
  return NextResponse.json({
    segments: [
      "breaking",
      "topic_politics",
      "topic_sports",
      "team_lal",
      "league_nba",
    ],
    note: "Topic names are derived from follow ids: slnews_topic_politics, slnews_team_lal.",
  });
}

export async function POST(request: Request) {
  const expected = adminKey();
  if (!expected || request.headers.get("x-admin-key") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let payload: {
    segment?: string;
    title?: string;
    body?: string;
    dryRun?: boolean;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const segment = (payload.segment ?? "").trim();
  const title = (payload.title ?? "").trim();
  const body = (payload.body ?? "").trim();
  if (!segment || !title || !body) {
    return NextResponse.json(
      { error: "segment, title and body are required" },
      { status: 400 }
    );
  }
  const topic = topicFor(segment);
  const preview = { topic, segment, title, body };
  if (payload.dryRun !== false) {
    return NextResponse.json({ preview, sent: false });
  }
  const result = await sendTopicPush(topic, {
    title,
    body,
    url: "/for_you",
    category: segment.replace(/^slnews_/, ""),
  });
  return NextResponse.json({ preview, sent: result.ok, result });
}
