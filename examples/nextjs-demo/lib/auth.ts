export const DEMO_USER = "demo@lookout.dev";
export const DEMO_PASS = "lookout123";

export function isValidLogin(email: string, password: string): boolean {
  return email === DEMO_USER && password === DEMO_PASS;
}
