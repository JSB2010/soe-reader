import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AssessmentPlayback,
  type PlayerMedia,
  type PlayerState,
} from "../lib/assessment-playback";
import { mp3Duration } from "../lib/mp3";
import { locateTime, timeline } from "../lib/timeline";
import type { Segment } from "../lib/model";
class FakeAudio extends EventTarget {
  src = "";
  currentTime = 0;
  duration = NaN;
  ended = false;
  playbackRate = 1;
  plays = 0;
  pause() {}
  load() {
    this.currentTime = 0;
    this.duration = NaN;
    this.ended = false;
  }
  play() {
    this.plays++;
    return Promise.resolve();
  }
  metadata(duration = 10) {
    this.duration = duration;
    this.dispatchEvent(new Event("loadedmetadata"));
  }
  finish() {
    this.currentTime = this.duration;
    this.ended = true;
    this.dispatchEvent(new Event("ended"));
  }
}
const segments: Segment[] = [0, 1, 2].map((i) => ({
  id: String(i),
  page: i === 2 ? 2 : 1,
  text: "A synthetic passage.",
  rects: [],
  itemIndices: [],
  audio: `${i}.mp3`,
  durationSeconds: 10,
}));
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const media = new FakeAudio();
  let state!: PlayerState;
  const player = new AssessmentPlayback(
    media as PlayerMedia,
    segments,
    (s) => s.audio,
    (value) => (state = value),
  );
  return { media, player, state: () => state };
}
test("whole-document playback advances, pauses/resumes, and stop resets/fences continuation", async () => {
  const { media, player, state } = fixture();
  player.play();
  media.metadata();
  await tick();
  assert.equal(media.src, "0.mp3");
  assert.equal(state().playing, true);
  media.finish();
  media.metadata();
  await tick();
  assert.equal(media.src, "1.mp3");
  assert.equal(state().index, 1);
  player.pause();
  assert.equal(state().playing, false);
  const plays = media.plays;
  media.finish();
  assert.equal(media.plays, plays);
  media.ended = false;
  player.play();
  await tick();
  assert.equal(media.src, "1.mp3");
  player.stop();
  media.finish();
  assert.equal(state().index, null);
  assert.equal(state().elapsed, 0);
  assert.equal(media.src, "");
  player.play();
  await tick();
  assert.equal(media.src, "0.mp3");
  player.dispose();
});
test("passage clicks do not auto-advance; a new Play starts at the beginning", async () => {
  const { media, player, state } = fixture();
  player.select(2);
  media.metadata();
  await tick();
  media.finish();
  assert.equal(state().index, 2);
  assert.equal(state().playing, false);
  assert.equal(media.src, "2.mp3");
  player.play();
  await tick();
  assert.equal(media.src, "0.mp3");
  player.dispose();
});
test("global seeking loads the correct passage without starting paused audio, and skip crosses clips", async () => {
  const { media, player, state } = fixture();
  player.seek(15);
  assert.equal(media.src, "1.mp3");
  assert.equal(media.plays, 0);
  media.metadata();
  assert.equal(media.currentTime, 5);
  player.play();
  await tick();
  assert.equal(state().playing, true);
  player.speed(1.5);
  player.skip(10);
  media.metadata();
  await tick();
  assert.equal(media.src, "2.mp3");
  assert.equal(media.currentTime, 5);
  assert.equal(media.playbackRate, 1.5);
  player.pause();
  player.seek(3);
  media.metadata();
  assert.equal(media.src, "0.mp3");
  assert.equal(media.currentTime, 3);
  assert.equal(state().playing, false);
  player.dispose();
});
test("rapid passage changes and a stop cancel deferred metadata seeks", async () => {
  const { media, player, state } = fixture();
  player.seek(17);
  player.select(0);
  media.metadata();
  await tick();
  assert.equal(media.src, "0.mp3");
  assert.equal(media.currentTime, 0);
  player.seek(25);
  player.stop();
  media.metadata();
  await tick();
  assert.equal(state().index, null);
  assert.equal(media.currentTime, 0);
  player.dispose();
});
test("timeline boundaries, old manifests, and invalid seeks remain bounded", () => {
  assert.deepEqual(locateTime(10, [10, 10, 10]), { index: 1, seconds: 0 });
  assert.equal(locateTime(100, [10, 10]).index, 1);
  assert.equal(locateTime(-20, [10]).seconds, 0);
  assert.equal(locateTime(NaN, [10]).seconds, 0);
  const old = segments.map(({ durationSeconds, ...s }) => s);
  assert.equal(timeline(old).estimated, true);
  assert.equal(timeline(segments).total, 30);
  assert.equal(timeline(segments).estimated, false);
});
test("MP3 duration reads actual bundled speech and rejects non-audio bytes", async () => {
  const data = await readFile("public/voices/en-US-Neural2-F.mp3");
  const duration = mp3Duration(data);
  assert.ok(duration && duration > 5 && duration < 20);
  assert.equal(mp3Duration(Buffer.from("not audio")), undefined);
});

test("Play before metadata arrives preserves the chosen seek position", async () => {
  const { media, player, state } = fixture();
  player.seek(17);
  player.play();
  media.metadata();
  await tick();
  assert.equal(media.src, "1.mp3");
  assert.equal(media.currentTime, 7);
  assert.equal(state().playing, true);
  player.dispose();
});
