export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "youtube-following",
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
