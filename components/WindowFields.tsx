"use client";
import { useId } from "react";
const commonZones: Record<string, string> = {
  "America/Denver": "Mountain Time · Denver",
  "America/New_York": "Eastern Time · New York",
  "America/Chicago": "Central Time · Chicago",
  "America/Los_Angeles": "Pacific Time · Los Angeles",
  "America/Phoenix": "Arizona · Phoenix",
  "America/Anchorage": "Alaska · Anchorage",
  "Pacific/Honolulu": "Hawaii · Honolulu",
  "Europe/London": "London",
  UTC: "UTC",
};
function DateTimeField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId(),
    [date = "", time = "00:00"] = value.split("T");
  const times = Array.from(
    { length: 96 },
    (_, i) =>
      `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
  );
  if (!times.includes(time)) times.push(time);
  times.sort();
  return (
    <fieldset className="date-time-field">
      <legend>{label}</legend>
      <div className="date-time-inputs">
        <input
          id={id}
          type="date"
          aria-label={`${label} date`}
          required
          value={date}
          onChange={(e) => onChange(`${e.target.value}T${time}`)}
        />
        <select
          aria-label={`${label} time`}
          required
          value={time}
          onChange={(e) => onChange(`${date}T${e.target.value}`)}
        >
          {times.map((t) => {
            const [h, m] = t.split(":").map(Number);
            return (
              <option key={t} value={t}>
                {h % 12 || 12}:{String(m).padStart(2, "0")}{" "}
                {h >= 12 ? "PM" : "AM"}
              </option>
            );
          })}
        </select>
      </div>
      <input type="hidden" name={name} value={value} />
    </fieldset>
  );
}
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
  const zones = [
    ...new Set([
      ...Object.keys(commonZones),
      timezone,
      ...Intl.supportedValuesOf("timeZone"),
    ]),
  ];
  return (
    <div className="window-fields">
      <div className="field-pair">
        <DateTimeField
          label="Opens"
          name="start"
          value={start}
          onChange={(value) => onChange("start", value)}
        />
        <DateTimeField
          label="Closes"
          name="end"
          value={end}
          onChange={(value) => onChange("end", value)}
        />
      </div>
      <label>
        Time zone
        <select
          name="timezone"
          required
          value={timezone}
          onChange={(e) => onChange("timezone", e.target.value)}
        >
          <optgroup label="Common time zones">
            {Object.entries(commonZones).map(([zone, label]) => (
              <option key={zone} value={zone}>
                {label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Other time zones">
            {zones
              .filter((z) => !commonZones[z])
              .map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
          </optgroup>
        </select>
      </label>
    </div>
  );
}
