import "../src/lib/db";

import { importAgentsFromOpenclaw } from "../src/lib/agent-import";

async function main() {
  console.log("Importing agents from OpenClaw (read-only: list only, no add/delete)...");

  const summary = await importAgentsFromOpenclaw();

  for (const item of summary.details) {
    const label = item.action === "imported" ? "+ imported" : item.action === "updated" ? "~ updated " : "- skipped ";
    const reason = item.reason ? ` (${item.reason})` : "";
    console.log(`  ${label} ${item.name} [${item.openclawId}]${reason}`);
  }

  console.log("");
  console.log(
    `Done. imported=${summary.imported} updated=${summary.updated} skipped=${summary.skipped} total_seen=${summary.details.length}`
  );
}

void main().catch((error) => {
  console.error("Import failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
