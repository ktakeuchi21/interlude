import { requireChatGPTUser } from "./chatgpt-auth";
import { LearningApp } from "@/components/learning-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <LearningApp displayName={user.fullName?.split(" ")[0] ?? "Your space"} />;
}
