import { NextResponse } from "next/server";
import { channelSyncRepository } from "@/lib/db";
import { runChannelSync } from "@/lib/channel-sync";
import { runtimeUploadFrontierProvider, runtimeVideoArtifactProvider } from "@/lib/providers/runtime";
import { SchedulerIdentityError, verifySchedulerRequest } from "@/lib/scheduler-identity";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

export async function POST(request: Request) {
  let audience: string;
  let serviceAccountEmail: string;
  try {
    audience = required("CHANNEL_SYNC_SCHEDULER_AUDIENCE");
    serviceAccountEmail = required("CHANNEL_SYNC_SCHEDULER_SERVICE_ACCOUNT_EMAIL");
  } catch {
    return NextResponse.json(
      { error: { code: "SYNC_NOT_CONFIGURED", message: "Channel sync is not configured." } },
      { status: 503 },
    );
  }

  try {
    await verifySchedulerRequest(request.headers.get("authorization"), {
      audience,
      serviceAccountEmail,
    });
  } catch (error) {
    if (error instanceof SchedulerIdentityError && error.code === "wrong_identity") {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Request identity is not authorized." } },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authenticated Scheduler identity required." } },
      { status: 401 },
    );
  }

  try {
    const result = await runChannelSync(
      channelSyncRepository(),
      runtimeUploadFrontierProvider(),
      runtimeVideoArtifactProvider(),
    );
    console.info("channel_sync_run", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (error) {
    console.error("channel_sync_failed", JSON.stringify({
      error_class: error instanceof Error ? error.name : "UnknownError",
    }));
    return NextResponse.json(
      { error: { code: "SYNC_UNAVAILABLE", message: "Channel synchronization is temporarily unavailable." } },
      { status: 503 },
    );
  }
}
