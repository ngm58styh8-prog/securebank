import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  confirmVariant = "primary",
  requireReason = true,
  requireAmount = false,
  loading = false,
  onClose,
  onConfirm
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger" | "success";
  requireReason?: boolean;
  requireAmount?: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (data: { reason: string; amount?: number }) => void;
}) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm md:items-center"
          onClick={onClose}
        >
          <motion.form
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="gv-glass-strong w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const reason = String(fd.get("reason") || "").trim();
              const amountRaw = fd.get("amount");
              const amount = amountRaw ? parseFloat(String(amountRaw)) : undefined;
              if (requireReason && !reason) return;
              if (requireAmount && (!amount || amount <= 0)) return;
              onConfirm({ reason, amount });
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{title}</h3>
                {description && <p className="mt-1 text-sm text-gv-muted">{description}</p>}
              </div>
              <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-white/10">
                <X size={18} />
              </button>
            </div>

            {requireAmount && (
              <div className="mb-3">
                <label className="gv-label" htmlFor="confirm-amount">
                  Amount ($)
                </label>
                <input
                  id="confirm-amount"
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  className="gv-input"
                  placeholder="0.00"
                />
              </div>
            )}

            {requireReason && (
              <div className="mb-4">
                <label className="gv-label" htmlFor="confirm-reason">
                  Reason (required for audit log)
                </label>
                <textarea
                  id="confirm-reason"
                  name="reason"
                  required
                  rows={3}
                  className="gv-input resize-none"
                  placeholder="Describe why this action is being taken…"
                />
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" className="gv-btn-ghost flex-1" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className={clsx(
                  "flex-1",
                  confirmVariant === "danger" && "gv-btn-danger",
                  confirmVariant === "success" && "gv-btn-success",
                  confirmVariant === "primary" && "gv-btn-primary"
                )}
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : confirmLabel}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ToastStack({
  toasts
}: {
  toasts: Array<{ id: string; type: string; message: string }>;
}) {
  return (
    <div className="fixed bottom-24 left-4 right-4 z-[400] flex flex-col gap-2 md:bottom-6 md:left-auto md:right-6 md:w-96">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className={clsx(
              "rounded-gv-sm border px-4 py-3 text-sm font-medium shadow-gv backdrop-blur-xl",
              t.type === "success" && "border-gv-success/40 bg-gv-success/15 text-gv-success",
              t.type === "error" && "border-gv-danger/40 bg-gv-danger/15 text-gv-danger",
              t.type === "info" && "border-gv-primary/40 bg-gv-primary/15 text-gv-text"
            )}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function PullRefresh({
  refreshing,
  onRefresh,
  children
}: {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      {refreshing && (
        <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-full bg-gv-primary/20 p-2">
          <Loader2 className="animate-spin text-gv-primary" size={18} />
        </div>
      )}
      <div
        onTouchEnd={(e) => {
          const touch = e.changedTouches[0];
          if (window.scrollY <= 0 && touch?.clientY > 80) onRefresh();
        }}
      >
        {children}
      </div>
    </div>
  );
}
