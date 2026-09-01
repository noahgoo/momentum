import { useEffect, useState } from "react";
import { formatDuration, parseDuration } from "../../lib/workoutFormat";

/**
 * Free-text duration entry accepting "45" (seconds), "1:30" (mm:ss), or
 * "1:05:00" (hh:mm:ss). Keeps the raw string while typing and only commits
 * a parsed value on blur — never NaN.
 */
export function DurationInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const [raw, setRaw] = useState(value != null ? formatDuration(value) : "");

  useEffect(() => {
    setRaw(value != null ? formatDuration(value) : "");
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={raw}
      placeholder={placeholder}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        const parsed = parseDuration(raw);
        onChange(parsed);
        setRaw(parsed != null ? formatDuration(parsed) : "");
      }}
      className={className}
    />
  );
}
