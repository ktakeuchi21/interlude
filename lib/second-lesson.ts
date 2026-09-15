import type { Lesson } from "./content";
export const secondLesson: Lesson = {
  id: "choosing-an-ai-problem", version: 1, courseId: "ai-product", order: 2,
  title: "Choosing an AI problem", objective: "Turn an appealing AI idea into a small, testable improvement to a real workflow.", minutes: 5,
  sections: [
    { title: "Name the moment that needs help", sources: ["google-needs"], paragraphs: [
      "Google's People + AI Guidebook recommends starting with people's needs, mapping their existing workflow, and testing whether AI adds useful value. It also points out that a simpler rule-based approach can sometimes work better. These are design recommendations, not evidence that any particular AI feature will succeed.",
      "Consider a fictional product team that receives twenty research notes a week. Its initial idea is an AI research assistant. That phrase leaves almost every important choice open. Is the problem collecting notes, finding a passage, comparing interviews, or deciding what to build? Spend a few minutes following one note from arrival to use. In this example, suppose the researcher already has good summaries but repeatedly searches for the original quotation behind a claim. A better starting problem is helping the researcher locate supporting evidence while preparing a decision."
    ] },
    { title: "Give the baseline a fair chance", sources: [], paragraphs: [
      "For our fictional team, compare three possible changes: consistent tags on every note, better keyword search, and a model that proposes relevant passages. These are proposed alternatives for this teaching example. We have not measured which one wins. The comparison matters because each option solves a slightly different problem and introduces a different maintenance burden.",
      "Imagine a researcher enters the exact product name and finds the quotation immediately using keyword search. There may be little reason to add a model to that moment. Now imagine the researcher remembers an idea but not its wording. A tool that identifies meaningfully related passages might help. The next step is a small test using real search needs and appropriate data, rather than deciding from the appeal of the technology. Keep the old search method available while comparing the new one."
    ] },
    { title: "Bound the promise", sources: ["microsoft-capability"], paragraphs: [
      "Microsoft's HAX guideline on system capabilities recommends setting clear expectations about the tasks and domains an AI system supports. Its examples illustrate that a tool can support one task without supporting a nearby one. This is useful when choosing a product boundary: a broad label can imply abilities you have not built or evaluated.",
      "For our example, a bounded promise could be: given an English-language research note collection, propose up to three passages relevant to the researcher's question, with links to their original context. The researcher decides which passage is useful. This promise does not imply that the tool has determined the correct product decision. Specify the supported collection and show what an empty result means. A boundary is useful only if the experience makes it visible."
    ] },
    { title: "Choose what the person still owns", sources: ["google-needs"], paragraphs: [
      "The Google guide distinguishes automation from augmentation. It recommends considering the nature of the task and how people value doing it, rather than assuming that removing human participation is always desirable. It also advises considering downstream effects when defining success.",
      "In our scenario, retrieving a passage and interpreting its importance are separate activities. A researcher may welcome help with the first while wanting to retain the second. For a pilot, we could leave the researcher's decision process intact and change only passage discovery. A useful observation would be whether people can find suitable evidence with less total effort, including checking the proposed passage and reading its context. A fast suggestion that misleads the decision meeting would not meet that goal."
    ] },
    { title: "Write the decision you need the pilot to answer", sources: [], paragraphs: [
      "A small pilot is easier to interpret when the decision is explicit. Our fictional team's question might be: does passage suggestion improve evidence retrieval enough to justify maintaining it? Before testing, record the current process, a representative set of search tasks, what counts as relevant evidence, and a reason to stop. The exact thresholds should come from the team's baseline and tolerance for mistakes; the numbers should not be invented after seeing the results.",
      "You can practice this now with an idea from your own work. Write one sentence naming the person, the moment of difficulty, and the desired improvement. Then name one simpler alternative and one observation that would change your mind. You have moved from an attractive feature label to a decision that a team can investigate. That is a useful beginning for an AI product brief."
    ] }
  ],
  takeaway: "Choose a specific workflow improvement, compare it with a baseline, and make the product's promise testable.",
  reflection: "Which part of a workflow do you want help with, and which part do you want to keep doing yourself?",
  challenge: "Write a problem statement for one AI idea: person, difficult moment, desired improvement, simpler alternative, and the decision a pilot should answer.",
  quiz: { question: "A team wants an AI research assistant. Which starting point best defines a useful pilot?", options: ["Add a chatbot to every research page", "Ask which current research step causes difficulty and compare bounded improvements", "Choose a model before observing the research workflow"], answer: 1, explanation: "A defined workflow problem and baseline make it possible to judge whether AI contributes useful value. The feature label alone does not identify what should improve." },
  sources: [
    { id: "google-needs", title: "User Needs + Defining Success", publisher: "Google PAIR", url: "https://pair.withgoogle.com/chapter/user-needs/", published: null, inspected: "2026-09-13", supports: "Sections on workflow mapping, whether AI adds value, automation versus augmentation, and downstream effects. The research-team scenario and proposed pilot are original illustrative examples." },
    { id: "microsoft-capability", title: "Make clear what the system can do", publisher: "Microsoft HAX Toolkit", url: "https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-what-the-system-can-do/", published: null, inspected: "2026-09-13", supports: "Guideline 1 recommends setting expectations about supported tasks and domains. The bounded passage-retrieval promise is our illustrative application of that guidance." }
  ],
  review: "Source guidance inspected during implementation. Fictional examples and proposed decisions are labeled; no measured product outcome or external expert review is claimed."
};
