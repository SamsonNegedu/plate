import { useState } from "react";
import { Field } from "@/components/Field";
import { type WhenChoice, localInput, whenPresets } from "./when";

const chip =
  "min-h-12 rounded-pill border border-line bg-surface px-3.5 text-meta text-ink-2 aria-pressed:border-ink aria-pressed:text-ink";

/** When it happened: quick chips for the common answers, and the full date and time behind "Other". */
export function WhenField({
  value,
  onChange,
  error,
  initial = "now",
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  initial?: WhenChoice;
}) {
  const [choice, setChoice] = useState<WhenChoice>(initial);
  const [presets] = useState(() => whenPresets(new Date()));
  return (
    <div className="grid gap-2">
      <p className="text-meta font-medium text-ink-2" id="when-label">
        When
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="when-label">
        {presets.map((p) => (
          <button
            key={p.choice}
            type="button"
            className={chip}
            aria-pressed={choice === p.choice}
            onClick={() => {
              setChoice(p.choice);
              onChange(localInput(p.at));
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={chip}
          aria-pressed={choice === "other"}
          onClick={() => setChoice("other")}
        >
          Other
        </button>
      </div>
      {choice === "other" || error ? (
        <Field
          label="Date and time"
          type="datetime-local"
          value={value}
          error={error}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}
