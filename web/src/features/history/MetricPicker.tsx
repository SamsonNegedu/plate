import { Segmented } from "@/components/Segmented";
import { Select } from "@/components/Select";
import { METRICS, type Metric } from "./stats";

interface Props {
  value: Metric;
  onChange: (m: Metric) => void;
}

/** The four people look at most are one tap; the rest sit in a menu beside them, which shows the pick when it is one of those. */
const MAIN: Metric[] = ["kcal", "protein", "carbs", "fat"];
const EXTRA = METRICS.filter((m) => !MAIN.includes(m.key));

export function MetricPicker({ value, onChange }: Props) {
  const extra = !MAIN.includes(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-60">
        <Segmented
          label="Chart"
          value={value}
          options={METRICS.filter((m) => MAIN.includes(m.key)).map((m) => ({
            value: m.key,
            label: m.label,
          }))}
          onChange={onChange}
        />
      </div>
      <Select
        label="More nutrients"
        className="flex-none"
        active={extra}
        value={extra ? value : ""}
        onChange={(e) => onChange(e.target.value as Metric)}
      >
        <option value="" disabled>
          More
        </option>
        {EXTRA.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
