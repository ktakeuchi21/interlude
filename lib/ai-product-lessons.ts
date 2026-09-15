import type { Lesson, Source } from "./content";

const inspected = "2026-09-14";
const source = (id: string, title: string, publisher: string, url: string, supports: string, published: string | null = null): Source => ({ id, title, publisher, url, supports, published, inspected });
const review = "Initial course lesson researched and reviewed against the linked primary sources during the build on September 14, 2026. Examples and proposed decision rules are illustrative teaching, not reported deployments or external expert review.";

export const aiProductLessons: Lesson[] = [
  {
    id: "inference-latency-cost", version: 1, courseId: "ai-product", order: 3,
    title: "Inference, latency, and cost", minutes: 5,
    objective: "Set a useful response-time and cost target for an AI workflow, then choose what to measure before optimizing.",
    sections: [
      { title: "The work happens at request time", sources: ["google-inference"], paragraphs: [
        "You have chosen a useful problem. Now imagine a researcher pressing a button to summarize an interview. The model already exists; your application sends it instructions and a transcript, then receives generated text. Google’s machine-learning glossary calls this use of a trained language model inference. It is different from training the model. For a product manager, the distinction matters because each use of your feature can consume time and computing resources, even though your team never trains anything.",
        "Our interview assistant is a fictional example. We will use it to connect three questions: how well does the result work, how long does the person wait, and what does a useful completed task cost?"
      ] },
      { title: "Measure the whole wait", sources: ["openai-latency"], paragraphs: [
        "OpenAI’s latency guidance identifies several possible improvements, including fewer requests, shorter outputs, parallel work where steps are independent, and streaming results. These are options to test, not guarantees for your application. The model is only one part of the wait: your product may also upload a transcript, retrieve material, check a response, and save the result.",
        "For our assistant, record the time from pressing the button to seeing a usable summary. Also record when the first useful text appears. A fast first sentence may reassure the researcher, but it does not help them send a summary that is still incomplete. Choose the timing measure around the action they need to take."
      ] },
      { title: "Find the expensive part", sources: ["openai-cost"], paragraphs: [
        "OpenAI’s cost guidance recommends considering fewer requests, fewer tokens, and smaller models that still meet the quality requirement. A token is a unit of text processing; it is not necessarily a whole word. Your engineer can show the request’s measured usage and the applicable rates. Ask about all steps, including retrieval and retries, rather than inspecting only the final answer.",
        "Use a deliberately fictional calculation. Suppose one attempt costs eight-tenths of a cent and you make five hundred attempts. That is four dollars. If only four hundred results are usable, the generation cost per usable result is one cent. The denominator changes the product conclusion: cheap attempts can still produce an expensive workflow."
      ] },
      { title: "Include the person in the comparison", sources: [], paragraphs: [
        "Now suppose the cheaper configuration needs four minutes of editing per summary, while another needs one. Those are invented numbers, but they expose a real question to investigate. Time spent correcting an output belongs in your evaluation, even if it does not appear on the model provider’s invoice. Compare total effort and task quality alongside direct software costs.",
        "Define usable before comparing options. In this example, a usable summary keeps the interviewee’s meaning, separates observation from interpretation, and contains no invented quotation. If a shorter answer drops essential evidence, making it faster has not improved the product. Keep the quality requirement fixed while trying a different model or shorter format."
      ] },
      { title: "Match the design to the moment", sources: [], paragraphs: [
        "A researcher who needs a headline during a live meeting has a different tolerance for waiting from someone preparing tomorrow’s synthesis. For the live task, try a brief first result with a clear completion state. For the later task, consider a saved job that the person can return to. These are design proposals for our example, not claims that either pattern is always better.",
        "Test awkward cases too. A long transcript, a poor connection, and several simultaneous requests may reveal waits hidden by a tidy demo. Inspect unusually slow requests as well as the typical one. Give a stalled request an understandable status and a recovery path instead of leaving an unexplained spinner."
      ] },
      { title: "Write a decision you can test", sources: [], paragraphs: [
        "Your first specification can be simple: name the task, define an acceptable result, set a provisional waiting-time target, and set a cost ceiling per usable result. Then collect evidence from representative cases before choosing an optimization. Label each target as a hypothesis until you have measurements.",
        "When an engineer proposes a faster model, ask what changes in quality, total waiting time, and review effort. When someone proposes another model call, ask what measurable benefit it adds. You do not need to optimize the entire system yourself. You need a shared definition of an improvement that actually helps the person doing the work."
      ] }
    ],
    takeaway: "Compare quality, end-to-end waiting time, and cost per usable result, including the effort needed to review it.",
    reflection: "Where would waiting be most disruptive in an AI feature you use: before the first response, before the complete answer, or before you can act?",
    challenge: "Optional · about 5 minutes: choose one AI task and write a quality requirement, a provisional time target, and the costs you would measure. Mark untested numbers as assumptions.",
    quiz: { question: "One configuration is cheaper per request but produces more unusable summaries. What comparison best informs the product decision?", options: ["The price of one request alone", "Total cost and review effort per usable result at the required quality", "Whichever configuration begins showing text first"], answer: 1, explanation: "Compare successful work at a consistent quality bar. Failed attempts, retries, waiting, and human correction can change which option is worthwhile." },
    sources: [
      source("google-inference", "Machine Learning Glossary: inference", "Google", "https://developers.google.com/machine-learning/glossary#inference", "Inference uses a trained model to produce a response to an input; the lesson's calculations are fictional examples."),
      source("openai-latency", "Latency optimization", "OpenAI", "https://developers.openai.com/api/docs/guides/latency-optimization", "Possible latency interventions include reducing requests and output, parallelizing independent work, and streaming."),
      source("openai-cost", "Cost optimization", "OpenAI", "https://developers.openai.com/api/docs/guides/cost-optimization", "Cost optimization considers request count, token usage, and model choice alongside accuracy; no current provider price is asserted in this lesson.")
    ], review
  },
  {
    id: "prompts-retrieval-tools", version: 1, courseId: "ai-product", order: 4,
    title: "Prompts, retrieval, and tools", minutes: 5,
    objective: "Distinguish instructions, supplied knowledge, and permitted actions so you can diagnose what an AI feature actually needs.",
    sections: [
      { title: "Three different kinds of help", sources: [], paragraphs: [
        "Imagine an internal assistant for a fictional equipment company. An employee asks which inspection checklist applies to a returned device, then asks the assistant to create a maintenance ticket. The first request needs a useful answer. The second changes a business record. Calling both requests a chat hides the different work your product must perform.",
        "Separate three ingredients: instructions that describe the task, information needed to answer it, and actions the application permits. We will call these prompts, retrieval, and tools. A weakness in one ingredient does not automatically mean you need a more capable model. First ask whether the system received the right task, the right evidence, and the right authority."
      ] },
      { title: "A prompt specifies the behavior", sources: ["openai-prompt"], paragraphs: [
        "OpenAI describes prompt engineering as writing effective instructions and recommends evaluating behavior as prompts and model versions change. Clear instructions can describe the goal, expected format, examples, and boundaries. They guide generation; they do not make every response deterministic.",
        "For our checklist assistant, compare a vague request to be helpful with a concrete instruction: identify the applicable checklist from the supplied documents, explain which device details matter, and say when the evidence is insufficient. Add an example of an ambiguous device name. That prompt gives the team something to test. It still cannot supply a new checklist that was never included or retrieved."
      ] },
      { title: "Retrieval brings relevant information", sources: ["openai-retrieval"], paragraphs: [
        "Retrieval searches a collection and supplies relevant material. OpenAI’s retrieval documentation describes semantic search, which can find related meaning even when wording differs. It also describes filtering results by attributes. These mechanisms help select context; relevance scores alone do not prove that a passage answers the user’s question correctly.",
        "In our example, searching for a return inspection could find a document that uses the phrase incoming equipment check. But the product must distinguish the current checklist from an obsolete version and one device family from another. Ask to inspect the actual passages supplied to the model. When the right document is absent, rewriting the answer’s tone will not repair the missing evidence."
      ] },
      { title: "A tool connects the model to an action", sources: ["openai-tools"], paragraphs: [
        "OpenAI’s function-calling guide describes a flow in which a model requests a tool call, application code executes it, and the result returns to the model. A tool can retrieve data or perform an action. The model’s request and the application’s successful execution are separate events.",
        "For our assistant, creating a maintenance ticket might require a device identifier, location, and issue description. The application should check that required values are valid and that this employee may create the ticket. A generated sentence saying the ticket exists is insufficient. Show the saved ticket identifier only after the operation actually succeeds, and provide a useful failure message when it does not."
      ] },
      { title: "Diagnose the layer that failed", sources: [], paragraphs: [
        "Try three deliberately different failures. First, the assistant supplies a long essay when the employee needs three steps. Inspect the instructions and output format. Second, it recommends an old checklist. Inspect document selection and version filtering. Third, it says a ticket was created but no record exists. Inspect the tool result and how the interface reports success.",
        "This diagnosis prevents an expensive guessing game. For each failure, ask the engineer to show the input, supplied evidence, requested action, and actual result, with appropriate access controls. You are defining a product investigation, not asking the model to explain hidden internal reasoning. The observable workflow is enough to identify many useful next experiments."
      ] },
      { title: "Choose the smallest complete workflow", sources: [], paragraphs: [
        "A reasonable first release for this fictional company might answer checklist questions with linked evidence and prepare an editable ticket draft. A person confirms the details before submission. Later, the team could consider more automation if measured performance and the consequences justify it. This is our proposed sequence, not a universal approval rule for every action.",
        "Write one sentence for each ingredient: what the assistant should do, which information it must use, and which actions it may take. Then add what happens if an ingredient is missing. That small specification turns an open-ended request for an intelligent assistant into a workflow that a designer, engineer, and tester can discuss together."
      ] }
    ],
    takeaway: "Prompts guide behavior, retrieval supplies information, and tools connect to data or actions. Diagnose the missing ingredient before adding complexity.",
    reflection: "Think of a disappointing AI answer. Was the task unclear, was necessary information missing, or did an action fail?",
    challenge: "Optional · about 5 minutes: sketch an assistant with three lines: instructions, evidence, and permitted actions. Add one missing-information case and one failed-action case.",
    quiz: { question: "The assistant answers from an obsolete checklist even though its writing is clear. What should you investigate first?", options: ["Whether the retrieved context includes the correct version and device", "Whether the answer needs a friendlier tone", "Whether every question should use a larger model"], answer: 0, explanation: "This failure points first to evidence selection. Inspect the retrieved material and filters before changing language style or model size." },
    sources: [
      source("openai-prompt", "Prompt engineering", "OpenAI", "https://developers.openai.com/api/docs/guides/prompt-engineering", "Instructions shape behavior, generated outputs vary, and prompts/model versions need evaluation."),
      source("openai-retrieval", "Retrieval", "OpenAI", "https://developers.openai.com/api/docs/guides/retrieval", "Semantic search finds related meaning; retrieved chunks, origin and attribute filters support context selection."),
      source("openai-tools", "Function calling", "OpenAI", "https://developers.openai.com/api/docs/guides/function-calling", "A model tool request, application execution, and returned tool output are distinct steps.")
    ], review
  },
  {
    id: "designing-for-uncertainty", version: 1, courseId: "ai-product", order: 5,
    title: "Designing for uncertainty", minutes: 5,
    objective: "Design a useful recovery path for an AI mistake and make human review specific enough to work.",
    sections: [
      { title: "Start with a plausible mistake", sources: [], paragraphs: [
        "Imagine a fictional sales-operations assistant preparing a renewal brief. It finds two documents: an older proposal with one delivery date and a later email with another. It produces a polished paragraph that quietly chooses the wrong date. The user sees a fluent answer, not the unresolved conflict. The interface has hidden information the person needs in order to judge the result.",
        "Designing for uncertainty means deciding what should happen in this situation before it surprises someone. Start with a concrete mistake, the person affected, and the next action. A wrong internal draft and a wrong commitment sent to a customer have different consequences, even when the underlying sentence is identical."
      ] },
      { title: "Help people judge when to rely on it", sources: ["pair-trust"], paragraphs: [
        "Google’s People + AI Guidebook recommends calibrated trust: helping people understand capabilities and limits so they can decide when to rely on a system. It also cautions that confidence displays can mislead and should be tested for usefulness. A number is valuable only if its meaning helps the user make a better decision.",
        "For our renewal brief, a label saying ninety percent confident would not resolve the conflicting dates. A more useful design could show both dated source passages and state that they disagree. This is our proposed design for the example. It gives the account owner a specific uncertainty to resolve instead of asking them to interpret an unexplained score."
      ] },
      { title: "Make review an actual task", sources: [], paragraphs: [
        "Human review is incomplete as a requirement until you name the reviewer, the evidence, the decision, and the time available. In our example, the account owner checks the proposed delivery date against the latest approved record before sending the brief. The interface places the relevant passages beside the disputed statement and lets the owner edit it.",
        "Test whether a reviewer can notice the problem under realistic conditions. A tiny warning after a long document may satisfy a checklist without helping the person. Ask a colleague to use an intentionally conflicting example and explain what they would verify. If they simply accept the paragraph, investigate the interaction rather than assuming review has solved the risk."
      ] },
      { title: "Offer a way forward", sources: ["pair-errors"], paragraphs: [
        "The Guidebook’s failure guidance treats errors as part of the experience and asks teams to give people a way to recover. An AI product can fail by producing an unwanted result as well as by returning a technical error. The recovery should fit the failure and the consequences of continuing.",
        "If the current approved record is missing, our assistant could leave the delivery date blank, retain the rest of the draft, and ask the account owner to supply the source. If document retrieval fails, it could offer the saved material with a clear limitation or let the person continue manually. Neither case requires discarding all of the user’s work."
      ] },
      { title: "Separate drafting from consequential action", sources: [], paragraphs: [
        "In this fictional workflow, generating an editable brief is different from emailing a delivery commitment. Define the action boundary explicitly. You might allow automatic drafting while requiring the account owner to verify the date before sending. Whether that is sufficient depends on the organization, the task, and observed failures; it is not a general rule that a confirmation button makes any action safe.",
        "Also consider what happens after a mistake escapes review. Who can correct the record? Can the team identify which source and draft were used? Who contacts the customer? Thinking through recovery can reveal product requirements that would stay invisible if the team looked only at the model’s answer."
      ] },
      { title: "Practice with one failure scenario", sources: [], paragraphs: [
        "Choose one realistic error and walk it through the complete experience: the system encounters uncertainty, the interface presents it, a person makes a decision, and the result is saved or sent. Write down where the process could fail again. In our example, the reviewer might lack access to the record or be unable to tell which document is current.",
        "Use that walkthrough to specify a recovery path and test it. You are aiming for informed reliance: people can use the useful parts of the assistant, identify its limits, and continue when it cannot help. Confidence in the product should come from demonstrated behavior and understandable controls, not from a consistently confident writing style."
      ] }
    ],
    takeaway: "For an important AI mistake, specify what the user sees, what they verify, and how they recover. Human review needs a concrete job.",
    reflection: "Where does an AI tool you use make uncertainty visible, and where does its presentation make an answer look more settled than it is?",
    challenge: "Optional · about 5 minutes: write a failure walkthrough for one AI feature. Name the mistake, its consequence, the reviewer’s evidence, and the recovery action.",
    quiz: { question: "An assistant finds conflicting delivery dates. Which design best supports the account owner’s decision?", options: ["Choose one date and add a generic AI disclaimer", "Show an unexplained confidence percentage", "Expose the conflicting dated evidence and provide a way to resolve or omit the date"], answer: 2, explanation: "The owner needs actionable evidence and a recovery path. A warning or score alone does not resolve which date is correct." },
    sources: [
      source("pair-trust", "Explainability + Trust", "Google PAIR", "https://pair.withgoogle.com/chapter/explainability-trust/", "Calibrate trust to capabilities and limitations; evaluate whether confidence displays inform or mislead users."),
      source("pair-errors", "Errors + Graceful Failure", "Google PAIR", "https://pair.withgoogle.com/chapter/errors-failing/", "Plan for AI errors and help people understand, recover, and move forward. The renewal workflow is an original hypothetical application.")
    ], review
  },
  {
    id: "evals-success-criteria", version: 1, courseId: "ai-product", order: 6,
    title: "Evals and success criteria", minutes: 5,
    objective: "Turn an AI product promise into a small, representative evaluation with explicit scoring and a meaningful baseline.",
    sections: [
      { title: "Replace impressive with testable", sources: ["openai-evals"], paragraphs: [
        "Your team has two versions of an AI feature, and everyone prefers a different demo. How do you decide? An evaluation, often called an eval, is a structured way to test performance against a defined task. OpenAI’s evaluation guidance emphasizes task-specific cases, explicit criteria, ongoing evaluation, and human judgment alongside scores. The purpose is evidence for a decision, not a decorative percentage.",
        "Consider a fictional assistant that extracts decisions from meeting notes. The product promise is that a project lead can quickly identify what was actually agreed. A polished list is insufficient if it turns suggestions into commitments. Start by translating the promise into observable behaviors."
      ] },
      { title: "Write the scoring rules first", sources: [], paragraphs: [
        "For this example, a decision item passes only when the notes support it, the responsible person is correct if one is named, and uncertainty remains visible. A fabricated decision fails even if the rest of the list reads well. Also check whether the assistant misses an important actual decision. These are proposed criteria for our scenario, not a universal scoring standard.",
        "Have two colleagues score the same few outputs and compare disagreements. One may count a tentative proposal as a decision while the other does not. Resolve the definition and add an example to the scoring guide. Otherwise a higher score could reflect changing interpretation rather than a better product."
      ] },
      { title: "Choose cases that challenge the promise", sources: ["pair-data"], paragraphs: [
        "Google’s People + AI Guidebook connects data needs to user needs and stresses representative examples, data quality, and labeling decisions. Its chapter primarily discusses training data. We apply that representativeness principle here to the cases used for product evaluation: test the work you expect people to bring, not only the inputs that made your demo look good.",
        "For our meeting assistant, include short and long notes, an absent owner, a reversed decision, and a meeting where nothing was decided. Include different writing styles your intended users actually encounter. A deliberately difficult case can expose a failure mode, but do not pretend that a handpicked stress set estimates how often that failure occurs in everyday use."
      ] },
      { title: "Keep a baseline and a fair comparison", sources: [], paragraphs: [
        "Compare the candidate with a practical baseline. That could be a project lead using an ordinary template, or the existing version of your assistant. Use the same cases and the same scoring rules. Keep some cases separate from the ones used to adjust the prompt, so you can check whether the improvement extends beyond the examples the team has been tuning.",
        "Suppose a trial contains twenty notes and one version succeeds on eighteen. Eighteen out of twenty describes that trial. It is not proof of ninety percent reliability for every team, language, or future meeting. Keep the case mix, failure types, and size of the trial visible alongside the number."
      ] },
      { title: "Separate output quality from product value", sources: [], paragraphs: [
        "An extraction can be accurate but still require too much effort to check. Measure the project lead’s time to reach a correct usable list, including review and correction. Track severe errors separately from formatting issues; averaging them together could hide a result that should stop a release. Define what would make you proceed, revise the feature, or stop the trial before seeing the results.",
        "Our proposed release decision might require acceptable evidence support and reduced total review time, with no unresolved fabricated commitments in the tested cases. That last condition is a stop rule for this small trial, not a statistical guarantee that the system can never fabricate a commitment."
      ] },
      { title: "Keep learning after the comparison", sources: [], paragraphs: [
        "When a real user encounters a new failure, preserve an appropriate example and turn it into a future check. Protect private material and retain only what you are authorized to use. A useful evaluation set evolves as the product encounters new kinds of work; it should not quietly become a collection of sensitive transcripts with no owner or retention plan.",
        "Your first evaluation can be modest. Write one product promise, a few representative cases, explicit scoring guidance, and a baseline. Record the result and what remains uncertain. You now have a repeatable conversation about evidence whenever someone proposes a new prompt, model, retrieval method, or action."
      ] }
    ],
    takeaway: "Evaluate the task you promise to improve, using representative cases, explicit scoring, a baseline, and a clear decision rule.",
    reflection: "What would count as a serious failure in an AI feature you work with, even if its average score looked good?",
    challenge: "Optional · about 10 minutes: draft five evaluation cases for one feature, including a no-answer case and a difficult case. Define what passes, what fails, and which baseline you will compare against.",
    quiz: { question: "A prompt performs well on the five examples repeatedly used to tune it. What is the most useful next check?", options: ["Evaluate separate representative cases with the same rubric and baseline", "Publish its score as a guarantee for all users", "Keep rewriting the same five examples until the score is perfect"], answer: 0, explanation: "A separate set helps reveal whether the improvement generalizes beyond tuning examples. Case selection, severity, and human review still matter." },
    sources: [
      source("openai-evals", "Evaluation best practices", "OpenAI", "https://developers.openai.com/api/docs/guides/evaluation-best-practices", "Task-specific evaluation, representative cases, explicit metrics, human calibration, and continued evaluation. The lesson does not depend on the vendor's Evals platform."),
      source("pair-data", "Data Collection + Evaluation", "Google PAIR", "https://pair.withgoogle.com/chapter/data-collection/", "Connect data needs to user needs; examine representation, quality, and labeling. Applying this training-data guidance to product evaluation cases is identified as an inference.")
    ], review
  },
  {
    id: "pilots-adoption-monitoring", version: 1, courseId: "ai-product", order: 7,
    title: "Pilots, adoption, and monitoring", minutes: 5,
    objective: "Plan a bounded AI pilot that measures useful work, captures failures, and has a named owner and stopping rule.",
    sections: [
      { title: "A pilot should answer a decision", sources: [], paragraphs: [
        "Imagine a fictional operations team testing an assistant that drafts explanations for delayed orders. A successful demonstration shows that the assistant can produce a plausible message. A useful pilot asks a narrower business question: can staff resolve these cases with less total effort while preserving accurate information and an appropriate customer experience? Those are different tests.",
        "Write the decision before inviting participants. For example, after a limited trial, the team will decide whether to expand draft assistance, revise the workflow, or stop. The trial’s size and duration should fit the cases and consequences. The sample plan in this lesson is an illustration, not a statistically sufficient design for every organization."
      ] },
      { title: "Bound the work and the rollout", sources: ["openai-production"], paragraphs: [
        "OpenAI’s production guidance discusses separating staging from production and managing access and spending. The broader product lesson is to identify where experimentation ends and real operations begin. A test that looks harmless in a demo can have different consequences when connected to live customer records.",
        "For our example, start with a defined group and a narrow category of delayed orders. Keep the assistant’s output as a draft, with the ordinary manual workflow available. Specify which records it can read, what it cannot change, and who handles failures. Use approved test material during setup, then follow the organization’s actual access rules for the live trial."
      ] },
      { title: "Measure the result, not just visits", sources: [], paragraphs: [
        "If twenty staff members open the assistant, you have evidence of initial use. You do not yet know whether it helps. Measure completed cases, correctness, total handling time, and the effort of checking the draft. Compare with the existing process for comparable cases. Also ask why a person abandoned the assistant or chose the manual path.",
        "In our invented pilot, some staff stop using the tool because finding the right order takes longer than writing the message. Others like its drafting but must rewrite the same misleading phrase. These observations point to different product changes. A single adoption percentage would hide both, and a faster generated draft would not necessarily fix either problem."
      ] },
      { title: "Make feedback specific and usable", sources: ["pair-feedback"], paragraphs: [
        "Google’s People + AI Guidebook describes feedback and control as ways for users to shape an AI experience and help a team improve it. Design the feedback around an action people can take and an issue the team can investigate. Do not imply that clicking a button immediately retrains or fixes the model unless that is what your system actually does.",
        "For the delayed-order assistant, offer a small number of useful reasons: wrong order information, unsuitable wording, or missing next step. Allow a short explanation and retain the relevant version context with appropriate access controls. A product owner reviews the reports and decides which need prompt changes, data fixes, interface changes, or a temporary pause."
      ] },
      { title: "Watch for quiet deterioration", sources: ["google-monitoring"], paragraphs: [
        "Google’s Rules of Machine Learning advises teams to understand freshness needs, watch for silent failures, and give data features owners. Its examples concern machine-learning systems more broadly, not a guarantee about this assistant. We apply the same operational concern to the information and services on which an AI workflow depends.",
        "Suppose our order feed stops updating but the assistant keeps producing fluent drafts. A basic uptime check could remain green while usefulness deteriorates. Track the freshness of the information, failed lookups, unusual correction rates, and the time and cost of completed work. Give each signal a person who knows what to do when it changes."
      ] },
      { title: "Decide when to expand or stop", sources: [], paragraphs: [
        "Before the trial, define the evidence needed to expand and the failures that trigger a pause. In our example, an incorrect delivery commitment might stop automated drafting for the affected case type until the cause is understood. The manual workflow remains available. A named owner records the issue, fixes it, and repeats the relevant checks before widening use.",
        "End the pilot with a decision and its limits. State which users and cases were tested, what improved, what failed, and what still lacks evidence. If the result is promising, expand deliberately to a new group or case type. A pilot earns the next experiment; it does not prove that every future use will work."
      ] }
    ],
    takeaway: "A useful pilot has a decision, a bounded audience and task, outcome measures, feedback, monitoring, and a practical way to pause.",
    reflection: "What signal would tell you that an AI feature is quietly becoming less useful even though it still responds successfully?",
    challenge: "Optional · about 10 minutes: write a pilot card naming the users, task, comparison, measures, owner, expansion criteria, and one stopping condition.",
    quiz: { question: "Staff open an AI assistant frequently, but spend longer correcting its drafts than doing the task manually. What does the pilot show?", options: ["Adoption proves the workflow should expand", "The generation speed is the only remaining concern", "Usage is occurring, but the intended improvement in useful work is not established"], answer: 2, explanation: "Usage and task value are separate. Review total effort and quality against a meaningful baseline before expanding." },
    sources: [
      source("openai-production", "Production best practices", "OpenAI", "https://developers.openai.com/api/docs/guides/production-best-practices", "Production preparation includes access, spending, and separation of staging and production. The pilot plan is an original application."),
      source("pair-feedback", "Feedback + Control", "Google PAIR", "https://pair.withgoogle.com/chapter/feedback-controls/", "Feedback and user control should help users shape the experience and provide useful information for improvement."),
      source("google-monitoring", "Rules of Machine Learning: monitoring", "Google", "https://developers.google.com/machine-learning/guides/rules-of-ml", "Rules 8–11 discuss freshness, checks before release, silent failures, and ownership. Applying them to a generative workflow is identified as an inference.")
    ], review
  },
  {
    id: "your-ai-product-brief", version: 1, courseId: "ai-product", order: 8,
    title: "Your AI product brief", minutes: 5,
    objective: "Combine the course into a short product brief that connects a user problem, workflow, evidence, evaluation, and rollout decision.",
    sections: [
      { title: "Make the idea discussable", sources: ["pair-needs"], paragraphs: [
        "You now have the ingredients for an AI product decision. The final step is to put them into a brief that another person can question, improve, and test. Google’s People + AI Guidebook starts with user needs and a definition of success. That is a useful starting point for your brief too: describe the work and the person before describing the technology.",
        "We will build an illustrative brief for a fictional research team that summarizes customer interviews. The format here is our synthesis of the course, not a prescribed template from a vendor. Its value is the shared understanding it creates, rather than whether every sentence fits perfectly on one page."
      ] },
      { title: "Name the person, task, and evidence", sources: [], paragraphs: [
        "Begin with a specific situation: after an interview, a researcher needs an accurate draft of the main findings and unanswered questions. Today they review the transcript and write a summary themselves. The proposed benefit is less total preparation time while preserving the customer’s meaning. Do not invent a measured baseline; label it unknown until you observe the current process.",
        "Add the evidence behind the problem. Perhaps you have interviewed researchers or watched them work. Record what you actually learned and what is still assumed. In this fictional example, all benefit claims remain hypotheses. A clear unknown is more useful than a confident number with no supporting observation."
      ] },
      { title: "Describe the smallest useful workflow", sources: ["anthropic-patterns"], paragraphs: [
        "Anthropic’s engineering guidance recommends starting with the simplest suitable approach and adding complexity when it is justified. It distinguishes predefined workflows from agents that choose their own steps. Use that distinction to describe what your feature needs instead of treating an autonomous agent as the default product specification.",
        "Our first version could accept an approved transcript, produce a short draft with supporting passages, and let the researcher edit and save it. It would not send messages to customers or turn suggestions into committed roadmap decisions. Those boundaries help the team estimate and test a complete workflow without silently adding responsibilities the problem does not require."
      ] },
      { title: "State the evidence and failure boundaries", sources: [], paragraphs: [
        "Specify the information the feature may use, how it knows which version is relevant, and which outputs need supporting evidence. For the interview assistant, the transcript supports statements about what the participant said. It does not establish how common the opinion is across all customers. The brief should make that distinction explicit.",
        "Then describe a failure and recovery. If a passage is ambiguous, the assistant flags the uncertainty and the researcher checks it. If the transcript is unavailable, the feature does not pretend it analyzed it. Name the person responsible for handling the issue and preserve a manual way to finish the job. Keep confidential material within the organization’s approved process."
      ] },
      { title: "Write the test and operating assumptions", sources: [], paragraphs: [
        "Define success using observable results: faithful summaries, no invented quotations in the evaluated cases, and less total preparation effort than the baseline. Include varied transcripts, explicit scoring guidance, and someone qualified to judge the examples. Record what would cause you to revise or stop. These are proposed criteria to refine with the research team, not a promise of perfect future performance.",
        "Add waiting time, cost per usable summary, expected volume, and who monitors the workflow. Separate measurements from estimates. A brief that lists a low model price but omits repeated attempts and review effort leaves an important part of the decision unanswered. You can start with unknowns if you also state how you will measure them."
      ] },
      { title: "End with the next decision", sources: [], paragraphs: [
        "Finish with a bounded experiment. In our example, try draft summaries on approved material with a small set of researchers, compare against their existing process, collect corrections, and review the evidence before expanding. Name the owner and the decision date. The outcome can be continue, revise, or stop; a useful brief makes all three possible.",
        "Your own brief needs only a clear problem, evidence, workflow, boundaries, evaluation, operating assumptions, and next decision. If a section feels vague, turn it into a question to investigate. You have moved from asking what AI can do to specifying a product that can demonstrate whether it helps. Save the brief and return to it as evidence changes."
      ] }
    ],
    takeaway: "An AI product brief connects the user’s job to a bounded workflow, evidence, failure recovery, success criteria, operating assumptions, and the next decision.",
    reflection: "Which assumption in your proposed AI feature could most change whether the idea is worth pursuing?",
    challenge: "Optional · about 15 minutes: draft your own brief using seven labels: Problem and user; Evidence; Workflow; Boundaries and recovery; Evaluation; Time and cost; Pilot decision and owner. Mark each important claim as measured, sourced, or assumed. Save it here as your application note.",
    quiz: { question: "Which statement belongs in a useful early AI product brief?", options: ["Use the most advanced model and decide the user problem later", "Reduce researchers’ total summary-preparation effort; measure the current baseline and compare on representative transcripts", "The demo looked convincing, so the feature is ready for every research team"], answer: 1, explanation: "The statement names the user’s work, intended benefit, missing evidence, and a way to test the proposal. It supports a decision without pretending the result is already known." },
    sources: [
      source("pair-needs", "User Needs + Defining Success", "Google PAIR", "https://pair.withgoogle.com/chapter/user-needs/", "Begin with the user's needs, choose a suitable problem, and define success. The seven-part brief is an original teaching synthesis."),
      source("anthropic-patterns", "Building effective agents", "Anthropic", "https://www.anthropic.com/engineering/building-effective-agents", "Choose simple suitable approaches and distinguish predefined workflows from model-directed agents; historical engineering guidance, not a current tooling recommendation.", "2024-12-19")
    ], review
  }
];
