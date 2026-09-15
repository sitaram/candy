/**
 * Label the neighbour groups for one repo. One small model call; output is 2-4 groups whose labels
 * say *why* the members belong together, in the reader's words, not ours.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { ai, MODEL } from "./llm";
import type { Item } from "../corpus/api";
import type { Neighbor, RelGroup } from "../corpus/related";

const SYSTEM = `You organise "related projects" for a mobile card about one open-source repo. You get the repo and up to 20 neighbours with the signals that connected them. Return 2-4 groups.

Each label is a short phrase (3-7 words) that tells a busy engineer what the group IS relative to the main repo — the relationship, not a category name. Good: "Does the same job, in Rust", "Runs on top of it", "The bigger, older incumbent", "Same trick for images instead of text", "What it replaced". Bad: "Related tools", "Similar projects", "Machine learning", "Alternatives" (too generic), anything with the word "projects" or "tools".

Rules: every neighbour appears at most once; drop neighbours that don't fit anywhere (fewer, tighter groups beat a catch-all); 2-6 members per group; first group is the most useful one; never invent a repo id — use only ids given.`;

const TOOL: Anthropic.Tool = {
  name: "emit_groups",
  description: "Return the labelled groups.",
  input_schema: {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
          required: ["label", "ids"],
        },
      },
    },
    required: ["groups"],
  },
};

function sig(n: Neighbor): string {
  const s = n.signals; const bits: string[] = [];
  if (s.alt) bits.push("named alternative");
  if (s.linkedFrom) bits.push("its README links to the main repo");
  if (s.linksTo) bits.push("main repo's README links to it");
  if (s.sameOwner) bits.push("same owner");
  if (s.shared.length) bits.push(`shares: ${s.shared.slice(0, 4).join(", ")}`);
  if (s.cos) bits.push(`text similarity ${s.cos.toFixed(2)}`);
  return bits.join("; ");
}

export async function relateOne(me: Item, ns: Neighbor[]): Promise<{ groups: RelGroup[]; model: string; tokens: number }> {
  const c = me.card!;
  const lines = [
    `MAIN: ${me.repo.id} — ${c.pitch}`,
    `category ${c.category}; tags ${c.tags.join(", ")}; language ${me.repo.language ?? "?"}; ${me.repo.stars}★`,
    c.alternatives.length ? `named alternatives: ${c.alternatives.join(", ")}` : "",
    "", "NEIGHBOURS:",
    ...ns.map((n) => `- ${n.item.repo.id} (${n.item.repo.language ?? "?"}, ${n.item.repo.stars}★): ${n.item.card?.pitch ?? n.item.repo.description}\n    signals: ${sig(n)}`),
  ].filter((l) => l !== "");
  const res = await ai().messages.create({
    model: MODEL, max_tokens: 700, system: SYSTEM,
    tools: [TOOL], tool_choice: { type: "tool", name: "emit_groups" },
    messages: [{ role: "user", content: lines.join("\n") }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("no tool_use");
  const valid = new Set(ns.map((n) => n.item.repo.id));
  const raw = (block.input as { groups: RelGroup[] }).groups ?? [];
  const seen = new Set<string>();
  const groups = raw
    .map((g) => ({ label: String(g.label).trim().slice(0, 60), ids: (g.ids ?? []).map((i) => String(i).toLowerCase()).filter((i) => valid.has(i) && !seen.has(i) && (seen.add(i), true)).slice(0, 6) }))
    .filter((g) => g.label && g.ids.length >= 1)
    .slice(0, 4);
  return { groups, model: res.model, tokens: res.usage.input_tokens + res.usage.output_tokens };
}
