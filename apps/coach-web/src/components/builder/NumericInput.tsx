import { useEffect, useState } from "react";

/**
 * A numeric input that keeps its own raw text while typing (so a half-typed
 * value isn't clobbered) and only commits a parsed number — or `undefined`
 * for an empty field — on blur. Never calls `onChange` with `NaN`.
 */
export function NumericInput({
  value,
  onChange,
  placeholder,
  className,
  min = 0,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  placeholder?: string;
  className?: string;
  min?: number;
}) {
  const [raw, setRaw] = useState(value != null ? String(value) : "");

  useEffect(() => {
    setRaw(value != null ? String(value) : "");
  }, [value]);

  return (
    <input
      type="number"
      min={min}
      value={raw}
      placeholder={placeholder}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        if (raw.trim() === "") {
          onChange(undefined);
          return;
        }
        const n = Math.max(min, Number(raw));
        onChange(Number.isNaN(n) ? undefined : n);
        setRaw(Number.isNaN(n) ? "" : String(n));
      }}
      className={className}
    />
  );
}
