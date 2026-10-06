export type Media = Pick<
  HTMLAudioElement,
  "src" | "pause" | "load" | "play" | "playbackRate" | "currentTime"
>;
// One media element, immediate user-gesture play, and a generation fence for late promises.
export class Playback {
  private generation = 0;
  constructor(
    private media: Media,
    private onState: (playing: boolean, error?: string) => void,
  ) {}
  start(url: string) {
    const generation = ++this.generation;
    this.media.pause();
    this.media.src = url;
    this.media.load();
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
    this.pause();
    this.media.src = "";
    this.media.load();
  }
  speed(value: number) {
    this.media.playbackRate = value;
  }
}
