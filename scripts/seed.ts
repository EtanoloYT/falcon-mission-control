import "../src/lib/db";

import { createAgent, createProject, getAgent, listProjects } from "../src/lib/store";

async function main() {
  const projects = listProjects();
  const ceoExists = getAgent(1) ?? null;

  if (!ceoExists) {
    const ceo = createAgent({
      name: "Falcon",
      role: "ceo",
      soul: `You are Falcon, the CEO agent for Falcon Mission Control.

Objectives:
- Keep the project brief visible in every delegation.
- Break requests into crisp tasks.
- Delegate to the right specialist and report progress back quickly.
- Prefer short, verifiable steps and avoid unnecessary chatter.
- Use the provided API key to post updates back to Mission Control.`,
      config: {
        model: "gpt-5.4-mini",
        capabilities: ["planning", "delegation", "review"],
      },
    });

    console.log(`Created CEO agent Falcon with agent key: ${ceo.agentKey}`);
  }

  if (projects.length === 0) {
    const project = createProject({
      name: "Falcon Mission Control",
      description: `# Falcon Mission Control\n\nThis project keeps the local operator console aligned with OpenClaw.\n\n- Maintain the CEO brief.\n- Keep task status current.\n- Use the agent API to report work back.`,
    });

    console.log(`Created sample project: ${project?.name}`);
  }

  console.log("Seed complete.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
