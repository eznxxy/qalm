import { LoginForm } from "@/components/login-form";

/**
 * (auth) route group: rendered outside the app shell. LoginForm suspends on
 * useSearchParams (?next redirect target) and shows its own loading state.
 */
export default function LoginPage() {
  return <LoginForm />;
}
