import { DEFAULT_TRACK, findTrack, makeMusic, TRACKS } from "./audio.js";
import { getElement } from "./dom.js";

type Phase = "work" | "break";
type TimerState = "idle" | "running" | "paused";
interface FocusSession {
  start: number | null;
  end: number;
  seconds: number;
  complete: boolean;
}

function isFocusSession(value: unknown): value is FocusSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  return (
    (session.start === null ||
      (typeof session.start === "number" && Number.isFinite(session.start))) &&
    typeof session.end === "number" &&
    Number.isFinite(session.end) &&
    typeof session.seconds === "number" &&
    Number.isFinite(session.seconds) &&
    session.seconds >= 0 &&
    typeof session.complete === "boolean"
  );
}

const elements = {
  start: getElement("start", HTMLButtonElement),
  pause: getElement("pause", HTMLButtonElement),
  stop: getElement("stop", HTMLButtonElement),
  clear: getElement("clear", HTMLButtonElement),
  volume: getElement("volume", HTMLInputElement),
  track: getElement("track", HTMLSelectElement),
  progress: getElement("progress", SVGCircleElement),
  "storage-message": getElement("storage-message", HTMLElement),
  announcement: getElement("announcement", HTMLElement),
  timer: getElement("timer", HTMLElement),
  mode: getElement("mode", HTMLElement),
  cycle: getElement("cycle", HTMLElement),
  status: getElement("status", HTMLElement),
  "sound-label": getElement("sound-label", HTMLElement),
  "today-count": getElement("today-count", HTMLElement),
  "today-minutes": getElement("today-minutes", HTMLElement),
  "total-count": getElement("total-count", HTMLElement),
  "history-list": getElement("history-list", HTMLElement),
  "start-label": getElement("start-label", HTMLElement),
};
const $ = <K extends keyof typeof elements>(id: K): (typeof elements)[K] =>
  elements[id];
const WORK = 25 * 60,
  BREAK = 5 * 60,
  KEY = "still.sessions.v1",
  TRACK_KEY = "still.track.v1";
let phase: Phase = "work";
let state: TimerState = "idle";
let remaining = WORK,
  deadline = 0,
  round = 1;
let startedAt: number | null = null;
let sessions: FocusSession[] = [];
let trackId = DEFAULT_TRACK.id;
try {
  // Read the track first: a corrupt session list must not cost the preference.
  const storedTrack = localStorage.getItem(TRACK_KEY);
  if (storedTrack) trackId = findTrack(storedTrack).id;
  const saved: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
  if (Array.isArray(saved)) sessions = saved.filter(isFocusSession);
} catch {
  $("storage-message").textContent =
    "Local history is unavailable in this browser. The timer still works.";
}
let context: AudioContext | undefined;
let gain: GainNode | undefined;
/** The playing loop, with its own gain so tracks can be swapped without a click. */
let voice: { node: AudioBufferSourceNode; fade: GainNode } | null = null;
/** Rendering a loop is not free, so keep each one for as long as the context lives. */
const buffers = new Map<string, AudioBuffer>();
let audioFailed = false;
const AUDIO_ERROR_MESSAGE =
  "Audio could not start. The timer still works. Pause and resume to try again.";
function reportAudioFailure(): void {
  audioFailed = true;
  $("storage-message").textContent = AUDIO_ERROR_MESSAGE;
}
function silence() {
  if (voice) {
    voice.node.stop();
    voice.node.disconnect();
    voice.fade.disconnect();
    voice = null;
  }
}
function playMusic() {
  if (
    state !== "running" ||
    phase !== "work" ||
    !context ||
    !gain ||
    audioFailed ||
    voice
  )
    return;
  let fade: GainNode | undefined;
  let node: AudioBufferSourceNode | undefined;
  try {
    let buffer = buffers.get(trackId);
    if (!buffer) {
      buffer = makeMusic(context, findTrack(trackId));
      buffers.set(trackId, buffer);
    }
    fade = context.createGain();
    fade.gain.value = 0;
    fade.gain.setTargetAtTime(1, context.currentTime, 0.08);
    fade.connect(gain);
    node = context.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.connect(fade);
    node.start();
    voice = { node, fade };
  } catch {
    node?.disconnect();
    fade?.disconnect();
    reportAudioFailure();
  }
}
function selectTrack(id: string): void {
  const chosen = findTrack(id);
  if (chosen.id === trackId) return;
  trackId = chosen.id;
  $("track").value = trackId;
  try {
    localStorage.setItem(TRACK_KEY, trackId);
  } catch {
    // A track that cannot be remembered still plays for this session.
  }
  if (voice && context) {
    // Fade the old loop out under the new one rather than cutting mid-phrase.
    const previous = voice;
    voice = null;
    previous.fade.gain.setTargetAtTime(0, context.currentTime, 0.06);
    previous.node.stop(context.currentTime + 0.4);
    previous.node.onended = () => {
      previous.node.disconnect();
      previous.fade.disconnect();
    };
  }
  playMusic();
  $("announcement").textContent = `Music set to ${chosen.name}.`;
  render();
}
function record(end: number, complete: boolean, seconds = WORK): void {
  sessions.unshift({
    start: startedAt,
    end,
    seconds: Math.round(seconds),
    complete,
  });
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    $("storage-message").textContent =
      "History could not be saved. Browser storage may be full or disabled.";
  }
  renderHistory();
}
function tick() {
  if (state === "running") {
    const now = Date.now();
    while (now >= deadline) {
      const boundary = deadline;
      if (phase === "work") {
        record(boundary, true);
        phase = "break";
        silence();
      } else {
        phase = "work";
        round++;
        startedAt = boundary;
      }
      deadline = boundary + (phase === "work" ? WORK : BREAK) * 1000;
      $("announcement").textContent =
        phase === "work"
          ? "Focus time. Music is playing."
          : "Break time. Five minutes of silence.";
    }
    remaining = Math.max(0, (deadline - now) / 1000);
    if (phase === "work") playMusic();
    else silence();
  }
  render();
}
function render() {
  const seconds = Math.ceil(remaining),
    display = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  $("timer").textContent = display;
  $("timer").setAttribute(
    "aria-label",
    `${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds remaining`,
  );
  document.title =
    state === "idle"
      ? "Still — Pomodoro"
      : `${display} · ${phase === "work" ? "Focus" : "Break"} — Still`;
  $("mode").textContent = phase === "work" ? "● FOCUS TIME" : "● TAKE A BREATH";
  $("cycle").textContent = `ROUND ${String(round).padStart(2, "0")}`;
  $("status").textContent =
    state === "paused"
      ? "On pause. Take your time."
      : phase === "break"
        ? "Step away. Enjoy the quiet."
        : state === "running"
          ? "Just you and the next small thing."
          : "Make room for good work.";
  $("progress").style.strokeDashoffset = String(
    860.8 * (1 - remaining / (phase === "work" ? WORK : BREAK)),
  );
  $("start").disabled = state === "running";
  $("start-label").textContent = state === "paused" ? "Resume" : "Start focus";
  $("pause").disabled = state !== "running";
  $("stop").disabled = state === "idle";
  const track = findTrack(trackId);
  $("sound-label").textContent =
    phase === "break"
      ? "♫   Break time · music is silent"
      : state === "running"
        ? audioFailed
          ? "♫   Audio unavailable · timer running"
          : `♫   ${track.name} · playing`
        : `♫   ${track.name} · ${track.mood}`;
  document.body.classList.toggle("break", phase === "break");
}
$("start").addEventListener("click", () => {
  if (state === "running") return;
  audioFailed = false;
  if ($("storage-message").textContent === AUDIO_ERROR_MESSAGE) {
    $("storage-message").textContent = "";
  }
  try {
    if (!context || context.state === "closed") {
      const AudioContextClass =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable.");
      context = new AudioContextClass();
      gain = undefined;
      buffers.clear();
    }
    if (!gain) {
      const newGain = context.createGain();
      newGain.gain.value = Number($("volume").value) / 100;
      newGain.connect(context.destination);
      gain = newGain;
    }
    void context.resume().catch(() => {
      silence();
      reportAudioFailure();
      render();
    });
  } catch {
    reportAudioFailure();
  }
  if (state === "idle") startedAt = Date.now();
  state = "running";
  deadline = Date.now() + remaining * 1000;
  playMusic();
  tick();
});
$("pause").addEventListener("click", () => {
  if (state !== "running") return;
  tick();
  state = "paused";
  silence();
  render();
});
$("stop").addEventListener("click", () => {
  if (state === "idle") return;
  tick();
  if (phase === "work" && WORK - remaining >= 1)
    record(Date.now(), false, WORK - remaining);
  state = "idle";
  phase = "work";
  remaining = WORK;
  round = 1;
  startedAt = null;
  silence();
  render();
});
$("track").replaceChildren(
  ...TRACKS.map((choice) =>
    Object.assign(document.createElement("option"), {
      value: choice.id,
      textContent: choice.name,
    }),
  ),
);
$("track").value = trackId;
$("track").addEventListener("change", () => {
  selectTrack($("track").value);
});
$("volume").addEventListener("input", () => {
  if (gain && context)
    gain.gain.setTargetAtTime(
      Number($("volume").value) / 100,
      context.currentTime,
      0.03,
    );
});
$("clear").addEventListener("click", () => {
  if (!sessions.length || !confirm("Clear your saved focus history?")) return;
  try {
    localStorage.removeItem(KEY);
    sessions = [];
    renderHistory();
  } catch {
    $("storage-message").textContent =
      "History could not be cleared from browser storage.";
  }
});
function renderHistory() {
  const today = new Date().toDateString(),
    todays = sessions.filter((s) => new Date(s.end).toDateString() === today);
  $("today-count").textContent = String(
    todays.filter((s) => s.complete).length,
  );
  $("today-minutes").replaceChildren(
    document.createTextNode(
      String(Math.floor(todays.reduce((n, s) => n + s.seconds, 0) / 60)),
    ),
    Object.assign(document.createElement("span"), { textContent: " min" }),
  );
  $("total-count").textContent = String(
    sessions.filter((s) => s.complete).length,
  );
  $("history-list").replaceChildren();
  if (!sessions.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "A fresh page. Your focus sessions will appear here.";
    $("history-list").append(p);
  }
  sessions.slice(0, 20).forEach((s) => {
    const row = document.createElement("div");
    row.className = "session";
    const name = document.createElement("span"),
      date = document.createElement("small"),
      length = document.createElement("b");
    name.textContent = s.complete ? "✓  Focus completed" : "◌  Focus stopped";
    date.textContent = new Date(s.end).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    length.textContent = `${Math.floor(s.seconds / 60)}m ${s.seconds % 60}s`;
    row.append(name, date, length);
    $("history-list").append(row);
  });
  $("clear").disabled = sessions.length === 0;
}
document.addEventListener("visibilitychange", tick);
window.addEventListener("pageshow", tick);
setInterval(tick, 250);
renderHistory();
render();
