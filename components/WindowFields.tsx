"use client";
export default function WindowFields({
  start,
  end,
  timezone,
  onChange,
}: {
  start: string;
  end: string;
  timezone: string;
  onChange: (key: "start" | "end" | "timezone", value: string) => void;
}) {
  return (
    <>
      <div className="field-pair">
        <label>
          Opens
          <input
            name="start"
            type="datetime-local"
            value={start}
            required
            onChange={(e) => onChange("start", e.target.value)}
          />
        </label>
        <label>
          Closes
          <input
            name="end"
            type="datetime-local"
            value={end}
            required
            onChange={(e) => onChange("end", e.target.value)}
          />
        </label>
      </div>
      <label>
        Timezone
        <input
          name="timezone"
          list="timezones"
          value={timezone}
          required
          onChange={(e) => onChange("timezone", e.target.value)}
        />
        <datalist id="timezones">
          {[
            "America/Denver",
            "America/New_York",
            "America/Chicago",
            "America/Los_Angeles",
            "UTC",
            "Europe/London",
          ].map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </label>
    </>
  );
}
