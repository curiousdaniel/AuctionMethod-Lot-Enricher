import { prisma } from "./prisma";

export function getContinueUrl(): string {
  const host = process.env.VERCEL_URL ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}/api/enrich-continue`;
}

export function getContinueHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
  };
}

/**
 * Returns true if there are PENDING items ready to process
 * AND no other chain is currently running (no PROCESSING items).
 */
export async function shouldStartChain(): Promise<{ pending: number; alreadyRunning: boolean }> {
  const [pendingCount, processingCount] = await Promise.all([
    prisma.enrichedItem.count({
      where: { status: "PENDING", retryCount: { lt: 3 } },
    }),
    prisma.enrichedItem.count({
      where: { status: "PROCESSING" },
    }),
  ]);

  return {
    pending: pendingCount,
    alreadyRunning: processingCount > 0,
  };
}

export async function getPendingCount(): Promise<number> {
  return prisma.enrichedItem.count({
    where: { status: "PENDING", retryCount: { lt: 3 } },
  });
}
