"use client";
import { useEffect, useRef, useState } from "react";
import { voiceInfo, voiceLabel } from "@/lib/voices";
export default function VoicePicker({ voices }: { voices: string[] }) {
  const [selected, setSelected] = useState(voices[0]),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null),
    generation = useRef(0);
  useEffect(() => {
    const media = new Audio();
    audio.current = media;
    media.onended = () => {
      if (media.ended) setPlaying(false);
    };
    return () => {
      ++generation.current;
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
  }, []);
  const info = voiceInfo(selected);
  const families = [...new Set(voices.map((id) => voiceInfo(id).family))];
  return (
    <div className="voice-picker">
      <label>
        Speech voice
        <select
          name="voice"
          value={selected}
          onChange={(e) => {
            ++generation.current;
            audio.current?.pause();
            audio.current?.removeAttribute("src");
            audio.current?.load();
            setPlaying(false);
            setError("");
            setSelected(e.target.value);
          }}
        >
          {families.map((family) => (
            <optgroup
              label={family === "Neural2" ? "Natural · recommended" : family}
              key={family}
            >
              {voices
                .filter((id) => voiceInfo(id).family === family)
                .map((id) => (
                  <option key={id} value={id}>
                    {voiceLabel(id)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="voice-description">
        <small>
          {info.description}
          {info.gender ? " · US English" : ""}
        </small>
        {info.sample && (
          <button
            type="button"
            onClick={async () => {
              const current = ++generation.current;
              const media = audio.current;
              if (!media || !info.sample) return;
              if (playing) {
                media.pause();
                setPlaying(false);
                return;
              }
              media.src = info.sample;
              try {
                await media.play();
                if (current === generation.current) setPlaying(true);
              } catch {
                if (current === generation.current)
                  setError("The sample couldn't play. Try again.");
              }
            }}
          >
            {playing ? "Stop sample" : "Listen"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="small danger">
          {error}
        </p>
      )}
    </div>
  );
}
