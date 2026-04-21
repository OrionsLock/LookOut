import { defineConfig } from "@lookout/config";

export default defineConfig({
  baseUrl: "http://localhost:3000",
  auth: {
    type: "credentials",
    loginUrl: "/login",
    usernameSelector: "#email",
    passwordSelector: "#password",
    submitSelector: 'button[type="submit"]',
    successUrlPattern: "/dashboard",
    username: "demo@lookout.dev",
    password: "lookout123",
  },
  crawl: {
    maxStepsPerGoal: 25,
    maxParallelAgents: 1,
    goals: [
      { id: "sign-in", prompt: "Sign in with demo credentials and reach the dashboard" },
      { id: "create-key", prompt: "Create a new API key from the keys section" },
      { id: "update-settings-email", prompt: "Update the email on settings and save" },
    ],
  },
  llm: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    vision: true,
  },
});
