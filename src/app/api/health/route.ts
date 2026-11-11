import { connection } from "next/server";
import { healthStatus } from "@/lib/health";
import { jsonOk } from "@/lib/http";

export async function GET() {
  await connection();
  return jsonOk(healthStatus());
}
