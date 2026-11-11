import { resolveTectonicBin } from "@/lib/compile";

export type HealthStatus = {
  ok: true;
  service: "lumina";
  tectonic: boolean;
  databaseConfigured: boolean;
};

export function healthStatus(): HealthStatus {
  return {
    ok: true,
    service: "lumina",
    tectonic: Boolean(resolveTectonicBin()),
    databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
  };
}
