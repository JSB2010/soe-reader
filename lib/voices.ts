export type Voice = {
  id: string;
  name: string;
  gender: "Female" | "Male" | "";
  family: string;
  description: string;
  sample?: string;
};
// Curated from Google's voices.list catalog. Samples use only synthetic text.
const definitions = [
  [
    "Neural2-F",
    "Natural female",
    "Female",
    "Neural2",
    "Natural speech · recommended for assessments",
  ],
  [
    "Neural2-D",
    "Natural male",
    "Male",
    "Neural2",
    "Natural speech · recommended for assessments",
  ],
  [
    "Neural2-H",
    "Natural female, alternative",
    "Female",
    "Neural2",
    "Natural speech · an alternative female voice",
  ],
  [
    "Neural2-J",
    "Natural male, alternative",
    "Male",
    "Neural2",
    "Natural speech · an alternative male voice",
  ],
  [
    "Chirp3-HD-Aoede",
    "Aoede",
    "Female",
    "Chirp 3 HD",
    "Expressive HD · natural intonation and premium quality",
  ],
  [
    "Chirp3-HD-Charon",
    "Charon",
    "Male",
    "Chirp 3 HD",
    "Expressive HD · natural intonation and premium quality",
  ],
  [
    "Chirp3-HD-Kore",
    "Kore",
    "Female",
    "Chirp 3 HD",
    "Expressive HD · natural intonation and premium quality",
  ],
  [
    "Chirp3-HD-Puck",
    "Puck",
    "Male",
    "Chirp 3 HD",
    "Expressive HD · natural intonation and premium quality",
  ],
  [
    "Wavenet-F",
    "Smooth female",
    "Female",
    "WaveNet",
    "Smooth speech · economical neural voice",
  ],
  [
    "Wavenet-D",
    "Smooth male",
    "Male",
    "WaveNet",
    "Smooth speech · economical neural voice",
  ],
  [
    "Studio-O",
    "Narration female",
    "Female",
    "Studio",
    "Studio narration · highest processing cost",
  ],
  [
    "Studio-Q",
    "Narration male",
    "Male",
    "Studio",
    "Studio narration · highest processing cost",
  ],
  [
    "Standard-C",
    "Classic female",
    "Female",
    "Standard",
    "Standard speech · economical",
  ],
  [
    "Standard-D",
    "Classic male",
    "Male",
    "Standard",
    "Standard speech · economical",
  ],
] as const;
export const VOICES: Voice[] = definitions.map(
  ([suffix, name, gender, family, description]) => ({
    id: `en-US-${suffix}`,
    name,
    gender,
    family,
    description,
    sample: `/voices/en-US-${suffix}.mp3`,
  }),
);
export const DEFAULT_VOICES = VOICES.map((v) => v.id);
export function voiceInfo(id: string): Voice {
  return (
    VOICES.find((v) => v.id === id) || {
      id,
      name: id.replace(/^[a-z]{2}-[A-Z]{2}-/, "").replaceAll("-", " "),
      gender: "",
      family: "Configured voices",
      description: "Additional voice configured by your administrator",
    }
  );
}
export function voiceLabel(id: string) {
  const voice = voiceInfo(id);
  return `${voice.name}${voice.gender && !voice.name.toLowerCase().includes(voice.gender.toLowerCase()) ? ` · ${voice.gender}` : ""}`;
}
