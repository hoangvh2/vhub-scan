import { cfgWith, fakeFetch, gh } from "./helpers.js";

const READMES: Record<string, string> = {
  "acme/taskflow": "# Taskflow\nPlan your week from the terminal and automate chores.",
  "lifehub/planner": "# Planner\nA calendar assistant for personal life.",
};

export function world() {
  const search = [
    gh("acme/taskflow", { stars: 40, desc: "A command line assistant that plans your week, tracks habits and automates repetitive daily workflow tasks" }),
    gh("mirror/taskflow", { stars: 2, desc: "A command line assistant that plans your week, tracks habits and automates repetitive daily workflow tasks" }),
    gh("acme/video-studio", { desc: "A simple video editor with timeline and effects for creators who like tools" }),
    gh("tiny/thing", { desc: "todo" }),
    gh("old/legacy", { created: "2025-01-01T00:00:00Z", stars: 3, desc: "An old but friendly helper for planning your household chores and budget" }),
    gh("lifehub/planner", { stars: 25, desc: "A calendar assistant for personal life: reminders, budget and a weekly planner you own", topics: ["productivity", "calendar"] }),
  ];
  const all = [...search]; // repo lookups keep working after the search stops listing something
  const requests: string[] = [];
  const route = (u: URL): unknown => {
    if (u.pathname === "/search/repositories") return { items: search };
    const readme = /^\/repos\/([^/]+\/[^/]+)\/readme$/.exec(u.pathname);
    if (readme) return READMES[readme[1]!] ?? "# readme\nsome text about the project";
    const repo = /^\/repos\/([^/]+\/[^/]+)$/.exec(u.pathname);
    if (repo) return all.find((r) => r.full_name === repo[1]) ?? { status: 404 };
    return undefined;
  };
  const hnRoute = (u: URL): unknown => {
    if (u.pathname.endsWith("showstories.json")) return [102, 101];
    if (u.pathname.endsWith("/101.json")) return { id: 101, type: "story", title: "Show HN: Taskflow", url: "https://github.com/acme/taskflow", by: "acme", time: 1792800000, score: 55, descendants: 9 };
    if (u.pathname.endsWith("/102.json")) return { id: 102, type: "story", title: "Show HN: Habito – a habit tracker and calendar assistant for busy people", url: "https://habito.example.com", by: "bob", time: 1792800000, score: 30, descendants: 4 };
  };
  return { fetchImpl: fakeFetch(route, requests), hnFetch: fakeFetch(hnRoute), requests, search };
}

export const cfg = () => {
  const c = cfgWith();
  c.sources.github.queries = ["topic:productivity created:>{d14}"];
  return c;
};

