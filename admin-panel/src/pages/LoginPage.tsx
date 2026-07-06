import { motion } from "framer-motion";
import { Lock, LogIn, Shield } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAdmin } from "../context/AdminContext";
import { GlassCard } from "../components/ui/GlassCard";
import { DEFAULT_ADMIN_EMAIL } from "../lib/utils";

export default function LoginPage() {
  const { login, session, loading } = useAdmin();
  const [email, setEmail] = useState(DEFAULT_ADMIN_EMAIL);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (session && !loading) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <img src="/assets/globalvest-logo-light.svg" alt="GlobalVest" className="mx-auto h-10" />
          <h1 className="mt-6 text-2xl font-bold">Admin Portal</h1>
          <p className="mt-2 text-sm text-gv-muted">Secure access to user data & operations</p>
        </div>

        <GlassCard className="!p-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              setSubmitting(true);
              const ok = await login(email, password);
              if (!ok) setError("Invalid admin email or password.");
              setSubmitting(false);
            }}
          >
            <div className="mb-4">
              <label className="gv-label" htmlFor="email">Admin Email</label>
              <input
                id="email"
                type="email"
                className="gv-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="mb-4">
              <label className="gv-label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="gv-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="mb-4 rounded-gv-sm bg-gv-danger/15 px-3 py-2 text-sm text-gv-danger">{error}</p>
            )}

            <button type="submit" className="gv-btn-primary w-full" disabled={submitting}>
              <Shield size={18} />
              {submitting ? "Signing in…" : "Sign In to Admin"}
            </button>
          </form>

          <div className="mt-6 space-y-2 border-t border-gv-border pt-4 text-xs text-gv-muted">
            <p className="flex items-center gap-2"><Lock size={14} /> Authorized personnel only</p>
            <p className="flex items-center gap-2"><LogIn size={14} /> Default: admin@globalvest.com / admin123</p>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}
