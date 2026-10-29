import { useEffect, useState } from "react";
import {
  EMAIL_INVITES_ENABLED,
  useCreateClient,
  useInviteClient,
  useSetClientPassword,
} from "../../queries/useManageClient";

/** No 0/O/1/l/I: the coach reads this out or texts it, and the client types it by hand. */
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="admin-card w-full max-w-md p-6">
        <h2 className="font-display text-xl text-[var(--ink)]">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]";

function PasswordField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]" htmlFor="client-password">
        Password
      </label>
      <div className="flex gap-2">
        <input
          id="client-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <button
          type="button"
          onClick={() => onChange(generatePassword())}
          className="admin-secondary flex-none px-3 py-2 text-xs"
        >
          Generate
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--ink-50)]">
        <span>At least 8 characters. Share it with the client yourself.</span>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
          className="font-medium text-[var(--blue-deep)] disabled:opacity-40"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** "Add client": either set a password now (works in the live app) or email an invite link. */
export function AddClientDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"password" | "email">("password");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [created, setCreated] = useState<{ email: string; password: string | null } | null>(null);

  const create = useCreateClient();
  const invite = useInviteClient();
  const pending = create.isPending || invite.isPending;
  const error = (mode === "password" ? create.error : invite.error)?.message;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (mode === "password") {
      create.mutate(
        { email, display_name: name, password },
        { onSuccess: () => setCreated({ email: email.trim().toLowerCase(), password }) }
      );
    } else {
      invite.mutate(
        { email, display_name: name },
        { onSuccess: () => setCreated({ email: email.trim().toLowerCase(), password: null }) }
      );
    }
  }

  if (created) {
    return (
      <Modal title="Client added" onClose={onClose}>
        {created.password ? (
          <div className="mt-3 space-y-3 text-sm text-[var(--ink-70)]">
            <p>
              Give {created.email} this password. It is not shown again, though you can set a new one from their
              page.
            </p>
            <p className="rounded-lg bg-[var(--cream)] px-3 py-2 font-mono text-[var(--ink)] select-all">
              {created.password}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--ink-70)]">We emailed an invite link to {created.email}.</p>
        )}
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="admin-primary px-4 py-2 text-sm">
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add client" onClose={onClose}>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div role="radiogroup" aria-label="How they get access" className="flex gap-2 text-sm">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "password"}
            onClick={() => setMode("password")}
            className={`flex-1 rounded-lg border px-3 py-2 ${
              mode === "password" ? "border-[var(--blue-deep)] font-medium text-[var(--ink)]" : "border-[var(--ink-08)] text-[var(--ink-50)]"
            }`}
          >
            Set a password
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "email"}
            disabled={!EMAIL_INVITES_ENABLED}
            title={EMAIL_INVITES_ENABLED ? undefined : "Needs the next client app release."}
            onClick={() => setMode("email")}
            className={`flex-1 rounded-lg border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40 ${
              mode === "email" ? "border-[var(--blue-deep)] font-medium text-[var(--ink)]" : "border-[var(--ink-08)] text-[var(--ink-50)]"
            }`}
          >
            Email invite
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]" htmlFor="client-name">
            Name
          </label>
          <input id="client-name" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]" htmlFor="client-email">
            Email
          </label>
          <input
            id="client-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        {mode === "password" && <PasswordField value={password} onChange={setPassword} />}

        {error && <p className="text-sm text-[var(--bad)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="admin-secondary px-4 py-2 text-sm">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="admin-primary px-4 py-2 text-sm disabled:opacity-40">
            {pending ? "Adding…" : mode === "password" ? "Add client" : "Send invite"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Sets a new password for an existing client (forgotten password, or no email access). */
export function SetPasswordDialog({
  clientId,
  clientName,
  onClose,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const [password, setPassword] = useState(() => generatePassword());
  const setClientPassword = useSetClientPassword(clientId);

  if (setClientPassword.isSuccess) {
    return (
      <Modal title="Password updated" onClose={onClose}>
        <div className="mt-3 space-y-3 text-sm text-[var(--ink-70)]">
          <p>Give {clientName} this password. It is not shown again.</p>
          <p className="rounded-lg bg-[var(--cream)] px-3 py-2 font-mono text-[var(--ink)] select-all">{password}</p>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="admin-primary px-4 py-2 text-sm">
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Set password for ${clientName}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!setClientPassword.isPending) setClientPassword.mutate(password);
        }}
        className="mt-4 space-y-4"
      >
        <PasswordField value={password} onChange={setPassword} />
        {setClientPassword.error && <p className="text-sm text-[var(--bad)]">{setClientPassword.error.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="admin-secondary px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={setClientPassword.isPending}
            className="admin-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            {setClientPassword.isPending ? "Saving…" : "Set password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
