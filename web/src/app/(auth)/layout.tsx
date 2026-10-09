/**
 * (auth) route-group layout: passthrough. Login/bootstrap must stay OUTSIDE
 * the §3 shell (40px controls per the card) — this group simply has no shell.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
