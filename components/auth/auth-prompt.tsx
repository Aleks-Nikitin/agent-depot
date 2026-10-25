import { AuthRequired } from "./auth-required";

export function AuthPrompt() {
  return <AuthRequired githubEnabled={!!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET} />;
}
