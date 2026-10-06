import { Playback, type Media } from "./playback";
import { timeline, locateTime } from "./timeline";
import type { Segment } from "./model";
export type PlayerMedia = Media &
  Pick<
    HTMLAudioElement,
    "duration" | "ended" | "addEventListener" | "removeEventListener"
  >;
export type PlayerState = {
  index: number | null;
  playing: boolean;
  elapsed: number;
  total: number;
  estimated: boolean;
  error?: string;
};
// One media element for passage and document playback; stop/pause fence every continuation.
export class AssessmentPlayback {
  private transport: Playback;
  private index: number | null = null;
  private continuous = false;
  private paused = false;
  private playing = false;
  private intended = false;
  private rate = 1;
  private measured = new Map<number, number>();
  constructor(
    private media: PlayerMedia,
    private segments: Segment[],
    private url: (s: Segment) => string,
    private changed: (state: PlayerState) => void,
  ) {
    this.transport = new Playback(media, (playing, error) => {
      this.playing = playing;
      if (error) {
        this.paused = true;
        this.intended = false;
      }
      this.emit(error);
    });
    media.addEventListener("ended", this.ended);
    media.addEventListener("timeupdate", this.updated);
    media.addEventListener("loadedmetadata", this.metadata);
    media.addEventListener("error", this.failed);
    this.emit();
  }
  private emit(error?: string) {
    const t = timeline(this.segments, this.measured);
    this.changed({
      index: this.index,
      playing: this.playing,
      elapsed:
        this.index === null
          ? 0
          : Math.min(
              t.total,
              t.offsets[this.index] + (this.media.currentTime || 0),
            ),
      total: t.total,
      estimated: t.estimated,
      error,
    });
  }
  private updated = () => this.emit();
  private metadata = () => {
    if (
      this.index !== null &&
      Number.isFinite(this.media.duration) &&
      this.media.duration > 0
    )
      this.measured.set(this.index, this.media.duration);
    this.emit();
  };
  private failed = () => {
    if (this.index === null) return;
    this.intended = false;
    this.playing = false;
    this.paused = true;
    this.emit("Audio is unavailable. Press Play to try again.");
  };
  private ended = () => {
    if (this.index === null || !this.media.ended || !this.intended) return;
    this.playing = false;
    if (this.continuous && this.index + 1 < this.segments.length)
      this.start(this.index + 1, true);
    else {
      this.intended = false;
      this.paused = false;
      this.emit();
    }
  };
  private start(
    index: number,
    continuous: boolean,
    seconds = 0,
    autoplay = true,
  ) {
    if (!this.segments[index]) return;
    this.index = index;
    this.continuous = continuous;
    this.paused = !autoplay;
    this.intended = autoplay;
    this.playing = false;
    this.transport.start(this.url(this.segments[index]), seconds, autoplay);
    this.transport.speed(this.rate);
    this.emit();
  }
  select(index: number) {
    this.start(index, false);
  }
  play() {
    if (this.paused && this.index !== null) {
      this.continuous = true;
      this.intended = true;
      this.paused = false;
      this.transport.resume();
    } else this.start(0, true);
  }
  pause() {
    this.intended = false;
    this.paused = this.index !== null;
    this.transport.pause();
  }
  stop() {
    this.intended = false;
    this.continuous = false;
    this.paused = false;
    this.index = null;
    this.transport.stop();
    this.emit();
  }
  next(direction: number) {
    this.start(
      Math.max(
        0,
        Math.min(
          this.segments.length - 1,
          (this.index ?? (direction > 0 ? -1 : 1)) + direction,
        ),
      ),
      this.continuous,
    );
  }
  seek(position: number) {
    const { index, seconds } = locateTime(
      position,
      timeline(this.segments, this.measured).durations,
    );
    const playing = this.intended;
    if (index === this.index) {
      if (!playing) this.paused = true;
      this.continuous = true;
      this.transport.seek(seconds);
      this.emit();
    } else this.start(index, true, seconds, playing);
  }
  skip(seconds: number) {
    const t = timeline(this.segments, this.measured);
    this.seek(
      (this.index === null
        ? 0
        : t.offsets[this.index] + this.media.currentTime) + seconds,
    );
  }
  speed(value: number) {
    this.rate = value;
    this.transport.speed(value);
  }
  dispose() {
    this.stop();
    this.media.removeEventListener("ended", this.ended);
    this.media.removeEventListener("timeupdate", this.updated);
    this.media.removeEventListener("loadedmetadata", this.metadata);
    this.media.removeEventListener("error", this.failed);
  }
}
