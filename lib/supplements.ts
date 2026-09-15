import { z } from "zod";
export type Supplement = {
  id: string; lessonKeys: string[]; kind: "video" | "podcast"; provider: "youtube" | "spotify";
  mediaId: string; title: string; creator: string; durationSeconds: number; published: string;
  sourceUrl: string; description: string; context: string; checked: string;
};
export const supplements: Supplement[] = [
  { id: "3b1b-llms-briefly", lessonKeys: ["what-models-can-do:v1"], kind: "video", provider: "youtube", mediaId: "LPZh9BOjkQs",
    title: "Large Language Models explained briefly", creator: "3Blue1Brown · Grant Sanderson", durationSeconds: 477, published: "2024-11-20",
    sourceUrl: "https://www.3blue1brown.com/lessons/mini-llm/", checked: "2026-09-13",
    description: "A visual introduction to next-token prediction, training, and transformers.", context: "An introductory explanation published in 2024. It simplifies the architecture and does not establish the reliability of a particular product." },
  { id: "lennys-reads-pm-agents", lessonKeys: ["choosing-an-ai-problem:v1"], kind: "podcast", provider: "spotify", mediaId: "0iIMDaUJQ4yrTyGm2J5ZoY",
    title: "Make product management fun again with AI agents", creator: "Lenny’s Reads · audio edition of Tal Raviv’s guest post", durationSeconds: 1346, published: "2025-04-29",
    sourceUrl: "https://www.lennysnewsletter.com/p/make-product-management-fun-again-9f6", checked: "2026-09-13",
    description: "A longer discussion of choosing an initial agent task, setting boundaries, and testing it.", context: "Creator guidance and examples from 2025, read by Lennybot, an AI voice. Named tools and their capabilities may have changed." },
];
export const supplementRequest = z.object({ key: z.string().min(3).max(120), supplementId: z.string().min(3).max(80) }).strict();
export function lessonSupplements(key: string) { return supplements.filter(s => s.lessonKeys.includes(key)); }
export function mediaDuration(seconds: number) { const s = Math.max(0, Math.round(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
