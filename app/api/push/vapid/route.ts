import { NextResponse } from "next/server";
import { pushPublicKey } from "@/lib/push";

// Read the key at request time (env isn't present during the Docker build, so a
// statically cached GET would return an empty key).
export const dynamic = "force-dynamic";

// Public VAPID key the browser needs to create a push subscription.
export async function GET() {
  return NextResponse.json({ key: pushPublicKey() });
}
