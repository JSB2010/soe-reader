export type Media = Pick<
  HTMLAudioElement,
  "src" | "pause" | "load" | "play" | "playbackRate" | "currentTime"
> &
  Partial<
    Pick<
      HTMLAudioElement,
      "duration" | "addEventListener" | "removeEventListener"
    >
  >;
// One media element, immediate user-gesture play, and a generation fence for late promises.
export class Playback {
  private generation = 0;
  private sourceGeneration = 0;
  private pendingSeek?: () => void;
  constructor(
    private media: Media,
    private onState: (playing: boolean, error?: string) => void,
  ) {}
  start(url: string, seconds = 0, autoplay = true) {
    const generation = ++this.generation;
    ++this.sourceGeneration;
    this.clearSeek();
    this.media.pause();
    this.media.src = url;
    this.media.load();
    if (seconds > 0) this.seek(seconds);
    if (!autoplay) {
      this.onState(false);
      return;
    }
    // load() aborts the previous media request. No delayed callback can start an old clip.
    this.media
      .play()
      .then(() => {
        if (generation === this.generation) this.onState(true);
      })
      .catch(() => {
        if (generation === this.generation)
          this.onState(
            false,
            "Audio could not start. Press Play to try again.",
          );
      });
  }
  pause() {
    ++this.generation;
    this.media.pause();
    this.onState(false);
  }
  resume() {
    const generation = ++this.generation;
    this.media
      .play()
      .then(() => {
        if (generation === this.generation) this.onState(true);
      })
      .catch(() => {
        if (generation === this.generation)
          this.onState(
            false,
            "Audio could not resume. Try clicking the text again.",
          );
      });
  }
  stop() {
    ++this.sourceGeneration;
    this.clearSeek();
    this.pause();
    this.media.src = "";
    this.media.load();
  }
  speed(value: number) {
    this.media.playbackRate = value;
  }
  private clearSeek() {
    if (this.pendingSeek)
      this.media.removeEventListener?.("loadedmetadata", this.pendingSeek);
    this.pendingSeek = undefined;
  }
  seek(seconds: number) {
    this.clearSeek();
    const generation = this.sourceGeneration;
    const apply = () => {
      if (generation !== this.sourceGeneration) return;
      const duration = this.media.duration;
      this.media.currentTime = Math.max(
        0,
        Number.isFinite(duration)
          ? Math.min(seconds, Math.max(0, duration! - 0.01))
          : seconds,
      );
      this.clearSeek();
    };
    if (Number.isFinite(this.media.duration)) apply();
    else {
      this.pendingSeek = apply;
      this.media.addEventListener?.("loadedmetadata", apply, { once: true });
    }
  }
}
