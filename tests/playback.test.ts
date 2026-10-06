import test from "node:test";
import assert from "node:assert/strict";
import { Playback, type Media } from "../lib/playback";
test("rapid clicks use one audio element and ignore late play completions", async () => {
  const completions: { resolve: () => void; reject: () => void }[] = [],
    states: boolean[] = [];
  let pauses = 0,
    loads = 0;
  const audio: Media = {
    src: "",
    playbackRate: 1,
    currentTime: 0,
    pause: () => {
      pauses++;
    },
    load: () => {
      loads++;
    },
    play: () =>
      new Promise<void>((resolve, reject) =>
        completions.push({
          resolve,
          reject: () => reject(new Error("cancelled")),
        }),
      ),
  };
  const player = new Playback(audio, (value) => states.push(value));
  player.start("/first.mp3");
  player.start("/second.mp3");
  assert.equal(audio.src, "/second.mp3");
  completions[0].resolve();
  await Promise.resolve();
  assert.deepEqual(states, []);
  completions[1].resolve();
  await Promise.resolve();
  assert.deepEqual(states, [true]);
  assert.equal(pauses, 2);
  assert.equal(loads, 2);
  player.speed(1.5);
  assert.equal(audio.playbackRate, 1.5);
  player.stop();
  assert.equal(audio.src, "");
  assert.equal(states.at(-1), false);
});
test("stop fences pending media and failures are visible", async () => {
  let resolve!: () => void;
  const errors: (string | undefined)[] = [];
  const audio: Media = {
    src: "",
    playbackRate: 1,
    currentTime: 0,
    pause() {},
    load() {},
    play: () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  };
  const states: boolean[] = [],
    player = new Playback(audio, (playing, error) => {
      states.push(playing);
      errors.push(error);
    });
  player.start("/one.mp3");
  player.stop();
  resolve();
  await Promise.resolve();
  assert.deepEqual(states, [false]);
  audio.play = () => Promise.reject(new Error("WebKit denied playback"));
  player.start("/two.mp3");
  await new Promise((r) => setImmediate(r));
  assert.match(errors.at(-1) || "", /could not start/);
});
