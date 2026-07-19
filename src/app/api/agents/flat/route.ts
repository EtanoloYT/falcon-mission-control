import { withAuth } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listAgentsFlat } from "@/lib/store";

export const GET = withAuth(async () => ok(listAgentsFlat()), { allow: ["user", "agent"] });
