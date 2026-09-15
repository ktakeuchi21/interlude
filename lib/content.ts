import { secondLesson } from "./second-lesson";
import { aiProductLessons } from "./ai-product-lessons";
import { aiDevelopmentLessons } from "./ai-development-lessons";
import { aiHealthcareLessons } from "./ai-healthcare-lessons";
export type Source = { id: string; title: string; publisher: string; url: string; published: string | null; inspected: string; supports: string };
export type Lesson = { id: string; version: number; courseId: string; order: number; title: string; objective: string; minutes: number; sections: { title: string; paragraphs: string[]; sources: string[] }[]; takeaway: string; reflection: string; challenge: string; quiz: { question: string; options: string[]; answer: number; explanation: string }; sources: Source[]; review: string };
export type Course = { id: string; title: string; label: string; description: string; color: string; lessons: string[] };

export const courses: Course[] = [
  { id: "ai-product", title: "AI for product managers", label: "PRODUCT & STRATEGY", description: "Turn AI possibilities into useful, dependable products.", color: "blue", lessons: ["What models can and cannot do", "Choosing an AI problem", "Inference, latency, and cost", "Prompts, retrieval, and tools", "Designing for uncertainty", "Evals and success criteria", "Pilots, adoption, and monitoring", "Your AI product brief"] },
  { id: "ai-development", title: "AI for software development", label: "SOFTWARE & BUILDING", description: "Understand the software. Build thoughtfully with AI.", color: "teal", lessons: ["Frontend, backend, and data", "APIs and application state", "Giving an AI assistant useful context", "Small, reviewable changes", "Reviewing generated code", "Tests and debugging", "Secrets, access, and deployment", "Plan a small feature"] },
  { id: "ai-healthcare", title: "AI in pharma & healthcare", label: "HEALTHCARE & COMMERCIALIZATION", description: "Find practical opportunities in complex, human workflows.", color: "violet", lessons: ["Mapping the workflows", "Market and customer insights", "Field-team knowledge assistance", "Content and review workflows", "Patient support and access", "Healthcare administration", "Evidence, data, and oversight", "Design an AI pilot"] },
];

export const firstLesson: Lesson = {
  id: "what-models-can-do", version: 1, courseId: "ai-product", order: 1,
  title: "What models can and cannot do", objective: "Separate a model's ability to produce an answer from your product's ability to deliver a dependable result.", minutes: 5,
  sections: [
    { title: "Start with the job", sources: [], paragraphs: [
      "Imagine you are building an assistant for a product team. After each customer interview, it produces a short summary and suggests follow-up questions. The first demo is impressive. It captures the main complaint and presents tidy bullet points. It is tempting to conclude that the hard part is solved. But a demo answers only a small question: can the system produce a useful-looking result for this particular input? Your product must answer a larger one: can a person use these results to do their job reliably, across the situations they actually encounter?",
      "For this lesson, keep that interview assistant in mind. It is an illustrative example, not a claim about a deployed product. The distinction will help you evaluate almost any AI idea, from a personal writing tool to an internal knowledge assistant."
    ] },
    { title: "An answer is generated, not guaranteed", sources: ["openai-text", "nist"], paragraphs: [
      "Language models generate responses from the context and instructions provided to them. OpenAI documents that generation is non-deterministic: outputs can vary, and different model versions can respond differently to the same prompting approach. Instructions help shape a response, but they do not convert an open-ended task into a guaranteed calculation. This is why a polished answer should be treated as an output to evaluate rather than proof that a system understood everything correctly.",
      "NIST identifies a related risk called confabulation: generated content can confidently state something false. In our example, the assistant might turn a customer's tentative suggestion into a firm requirement, or invent a supporting quote. Fluent writing and factual support are different qualities. A confident tone is not a reliable indicator of accuracy."
    ] },
    { title: "The product is more than its model", sources: ["anthropic"], paragraphs: [
      "A useful AI application often combines a model with retrieval, tools, memory, and ordinary software. Anthropic describes these additions as ways of augmenting a language model. A retrieval step might supply the interview transcript. A tool might look up the customer's account. A software check might require every quoted passage to match the transcript exactly. Each part has a specific job, and the quality of the final result depends on how those parts work together.",
      "Anthropic also distinguishes a workflow with predefined steps from an agent that chooses its own path. For a bounded interview-summary task, a predictable workflow may be enough. More autonomy is a design choice with consequences, not an automatic upgrade. Start with the simplest approach that can meet the actual requirement, then add complexity when you have evidence it helps."
    ] },
    { title: "Turn the demo into a testable promise", sources: ["openai-evals"], paragraphs: [
      "OpenAI's evaluation guidance recommends task-specific evaluations and continued evaluation as an application changes. Translate that into a concrete product habit: describe what a useful output must do, collect realistic examples, and check the behavior systematically. For our assistant, a useful summary might preserve the customer's meaning, distinguish observations from interpretations, and attach accurate evidence. Test the awkward transcripts too: an unclear speaker, a contradiction, or an interview with no actionable request.",
      "Here is a practical decision rule for this example: keep the summary editable and let the researcher inspect its evidence before sharing it. Then measure whether the whole workflow saves useful time, including correction and review. A system that drafts quickly but requires extensive repair may not improve the job. That is our product-design inference, not a reported result from either vendor."
    ] },
    { title: "Ask the next useful question", sources: [], paragraphs: [
      "When someone presents an AI capability, ask which task it supports, what information it needs, what failure looks like, and how a person recovers. These questions move the conversation from a striking demonstration to an accountable product decision. They also help you work with engineers: instead of asking for an assistant that is simply smarter, you can specify a behavior that can be built and tested.",
      "You do not need to know every model detail to begin. You do need to separate the generated answer, the surrounding workflow, and the user's eventual outcome. Keep those three things distinct, and you will make better decisions about what to automate, where to add checks, and when a person should stay involved."
    ] }
  ],
  takeaway: "Evaluate the complete workflow: a convincing answer is only one part of a useful AI product.",
  reflection: "Think of an AI feature you use. What would a convincing but incorrect answer look like, and how would you notice it?",
  challenge: "Write one testable promise for an AI feature at work. Include the task, required evidence, and what should happen when the system cannot support its answer.",
  quiz: { question: "An interview assistant writes fluent summaries in three demos. What is the most useful next step?", options: ["Let it send every summary automatically", "Evaluate realistic cases against explicit criteria, including errors and review effort", "Make the prompt longer until the output sounds confident"], answer: 1, explanation: "A few convincing outputs do not establish dependable behavior. Test the whole workflow against the task and include the cost of checking and correcting its output." },
  sources: [
    { id: "openai-text", title: "Text generation", publisher: "OpenAI", url: "https://developers.openai.com/api/docs/guides/text", published: null, inspected: "2026-09-13", supports: "Generation is non-deterministic; model snapshots and prompt evaluations help monitor behavior." },
    { id: "nist", title: "Generative AI Risk Management Profile", publisher: "NIST", url: "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf", published: "2024-07-26", inspected: "2026-09-13", supports: "Section 2.2 describes confabulation and the danger of confidently generated false statements." },
    { id: "anthropic", title: "Building effective agents", publisher: "Anthropic", url: "https://www.anthropic.com/engineering/building-effective-agents", published: "2024-12-19", inspected: "2026-09-13", supports: "Augmented models use retrieval, tools, and memory; workflows and agents differ in who controls the steps." },
    { id: "openai-evals", title: "Evaluation best practices", publisher: "OpenAI", url: "https://developers.openai.com/api/docs/guides/evaluation-best-practices", published: null, inspected: "2026-09-13", supports: "Task-specific evaluation and continued measurement as an application changes." },
  ], review: "Initial lesson inspected against linked primary sources during implementation; not an external expert review."
};

export const seedLessons = [firstLesson, secondLesson, ...aiProductLessons, ...aiDevelopmentLessons, ...aiHealthcareLessons];
export function lessonKey(lesson: Pick<Lesson, "id" | "version">) { return `${lesson.id}:v${lesson.version}`; }
export function narrationText(lesson: Lesson) { return [lesson.title, ...lesson.sections.flatMap(s => [s.title, ...s.paragraphs]), "The takeaway.", lesson.takeaway].join("\n\n"); }
