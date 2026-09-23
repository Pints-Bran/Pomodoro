import {
  DEFAULT_CHOICE,
  DEFAULT_TRACK,
  findChoice,
  findTrack,
  makeMusic,
  pickTrack,
  SHUFFLE,
  TRACKS,
  type TrackChoice,
} from "./audio.js";
import { getElement } from "./dom.js";
import { askToNotify, notify } from "./notify.js";

type Phase = "work" | "break";
type TimerState = "idle" | "running" | "paused";
interface FocusSession {
  start: number | null;
  end: number;
  seconds: number;
  complete: boolean;
  /** Ended by Skip rather than by the clock or by Stop. */
  skipped?: boolean;
}
/** Just enough of the clock to pick the same session back up after a reload. */
interface TimerSnapshot {
  phase: Phase;
  state: "running" | "paused";
  deadline: number;
  remaining: number;
  round: number;
  startedAt: number | null;
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
    typeof session.complete === "boolean" &&
    (session.skipped === undefined || typeof session.skipped === "boolean")
  );
}

function isTimerSnapshot(value: unknown): value is TimerSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    (snapshot.phase === "work" || snapshot.phase === "break") &&
    (snapshot.state === "running" || snapshot.state === "paused") &&
    typeof snapshot.deadline === "number" &&
    Number.isFinite(snapshot.deadline) &&
    typeof snapshot.remaining === "number" &&
    Number.isFinite(snapshot.remaining) &&
    snapshot.remaining >= 0 &&
    typeof snapshot.round === "number" &&
    Number.isInteger(snapshot.round) &&
    snapshot.round >= 1 &&
    (snapshot.startedAt === null ||
      (typeof snapshot.startedAt === "number" &&
        Number.isFinite(snapshot.startedAt)))
  );
}

const elements = {
  app: getElement("app", HTMLElement),
  start: getElement("start", HTMLButtonElement),
  pause: getElement("pause", HTMLButtonElement),
  skip: getElement("skip", HTMLButtonElement),
  stop: getElement("stop", HTMLButtonElement),
  clear: getElement("clear", HTMLButtonElement),
  "break-overlay": getElement("break-overlay", HTMLElement),
  "break-skip": getElement("break-skip", HTMLButtonElement),
  "break-stop": getElement("break-stop", HTMLButtonElement),
  volume: getElement("volume", HTMLInputElement),
  track: getElement("track", HTMLSelectElement),
  progress: getElement("progress", SVGCircleElement),
  "storage-message": getElement("storage-message", HTMLElement),
  announcement: getElement("announcement", HTMLElement),
  timer: getElement("timer", HTMLElement),
  mode: getElement("mode", HTMLElement),
  cycle: getElement("cycle", HTMLElement),
  status: getElement("status", HTMLElement),
  "break-timer": getElement("break-timer", HTMLElement),
  "break-status": getElement("break-status", HTMLElement),
  "sound-label": getElement("sound-label", HTMLElement),
  "today-count": getElement("today-count", HTMLElement),
  "today-minutes": getElement("today-minutes", HTMLElement),
  "total-count": getElement("total-count", HTMLElement),
  "history-list": getElement("history-list", HTMLElement),
  "start-label": getElement("start-label", HTMLElement),
  "skip-label": getElement("skip-label", HTMLElement),
};
const $ = <K extends keyof typeof elements>(id: K): (typeof elements)[K] =>
  elements[id];
const WORK = 25 * 60,
  BREAK = 5 * 60,
  KEY = "still.sessions.v1",
  TRACK_KEY = "still.track.v1",
  TIMER_KEY = "still.timer.v1";
/** Beyond this far past a saved deadline the app was closed, not reloaded. */
const RESUME_GRACE = 30 * 60 * 1000;
/** How long a shuffled loop holds before the next one fades in, in seconds. */
const SHUFFLE_EVERY = 5 * 60;
/**
 * A hidden tab's interval is throttled to roughly a minute, so a live boundary
 * lands well inside this. Older than that and the app slept through the break;
 * announcing it then is noise, not a nudge.
 */
const NOTIFY_GRACE = 90 * 1000;
const BREAK_OVER_TITLE = "Break's over";
const BREAK_OVER_BODY = "Minimise this and start the next 25.";
let phase: Phase = "work";
let state: TimerState = "idle";
let remaining = WORK,
  deadline = 0,
  round = 1;
let startedAt: number | null = null;
let sessions: FocusSession[] = [];
/** What the menu holds. `trackId` is what is actually sounding right now. */
let choice: TrackChoice = DEFAULT_CHOICE;
let trackId: string = DEFAULT_TRACK.id;
/** When the shuffled loop is next due to change. 0 means "as soon as it runs". */
let shuffleAt = 0;
try {
  // Read the track first: a corrupt session list must not cost the preference.
  const storedTrack = localStorage.getItem(TRACK_KEY);
  if (storedTrack) choice = findChoice(storedTrack);
  const saved: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
  if (Array.isArray(saved)) sessions = saved.filter(isFocusSession);
} catch {
  $("storage-message").textContent =
    "Local history is unavailable in this browser. The timer still works.";
}
trackId = choice === SHUFFLE ? pickTrack().id : choice;
let context: AudioContext | undefined;
let gain: GainNode | undefined;
/** The playing loop, with its own gain so tracks can be swapped without a click. */
let voice: { node: AudioBufferSourceNode; fade: GainNode } | null = null;
/** Rendering a loop is not free, so keep each one for as long as the context lives. */
const buffers = new Map<string, AudioBuffer>();
let audioFailed = false;
/** A restored run counts down straight away, but sound needs a real gesture. */
let needsGesture = false;
/** Boundaries found while restoring belong to a past visit, not to this moment. */
let restoring = false;
/** Edge-triggers the overlay's focus handoff; render() runs four times a second. */
let overlayOpen = false;
const AUDIO_ERROR_MESSAGE =
  "Audio could not start. The timer still works. Pause and resume to try again.";
const duration = (): number => (phase === "work" ? WORK : BREAK);
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
function ensureAudio(): void {
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
/** Put a different loop on air without a gap, whoever asked for the change. */
function crossfadeTo(id: string): void {
  trackId = id;
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
}
function selectTrack(value: string): void {
  const chosen = findChoice(value);
  if (chosen === choice) return;
  choice = chosen;
  $("track").value = choice;
  try {
    localStorage.setItem(TRACK_KEY, choice);
  } catch {
    // A track that cannot be remembered still plays for this session.
  }
  const next = choice === SHUFFLE ? pickTrack(trackId) : findTrack(choice);
  shuffleAt = Date.now() + SHUFFLE_EVERY * 1000;
  crossfadeTo(next.id);
  $("announcement").textContent =
    choice === SHUFFLE
      ? `Shuffling. Now playing ${next.name}.`
      : `Music set to ${next.name}.`;
  render();
}
/** On shuffle, move to another loop so nothing plays long enough to nag. */
function shuffleMusic(now: number): void {
  if (
    choice !== SHUFFLE ||
    phase !== "work" ||
    audioFailed ||
    needsGesture ||
    now < shuffleAt
  )
    return;
  shuffleAt = now + SHUFFLE_EVERY * 1000;
  const next = pickTrack(trackId);
  if (next.id === trackId) return;
  crossfadeTo(next.id);
  $("announcement").textContent = `Now playing ${next.name}.`;
}
function saveTimer(): void {
  try {
    if (state === "idle") {
      localStorage.removeItem(TIMER_KEY);
      return;
    }
    const snapshot: TimerSnapshot = {
      phase,
      state,
      deadline,
      remaining,
      round,
      startedAt,
    };
    localStorage.setItem(TIMER_KEY, JSON.stringify(snapshot));
  } catch {
    // A clock that cannot be remembered still runs for this visit.
  }
}
function resetTimer(): void {
  state = "idle";
  phase = "work";
  remaining = WORK;
  deadline = 0;
  round = 1;
  startedAt = null;
  shuffleAt = 0;
  silence();
  saveTimer();
}
/** Restore the clock a previous visit left behind, so a reload costs nothing. */
function restoreTimer(): void {
  let stored: unknown = null;
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isTimerSnapshot(stored)) return;
  phase = stored.phase;
  round = stored.round;
  startedAt = stored.startedAt;
  if (stored.state === "paused") {
    state = "paused";
    remaining = Math.min(stored.remaining, duration());
    $("announcement").textContent = "Picked up where you left off, on pause.";
    return;
  }
  if (Date.now() - stored.deadline > RESUME_GRACE) {
    // Away long enough that the clock would invent focus nobody sat through.
    resetTimer();
    return;
  }
  state = "running";
  deadline = stored.deadline;
  remaining = Math.max(0, (deadline - Date.now()) / 1000);
  needsGesture = true;
  window.addEventListener("pointerdown", resumeAudio);
  window.addEventListener("keydown", resumeAudio);
  $("announcement").textContent =
    "Picked up where you left off. Interact once to bring the music back.";
  restoring = true;
  tick();
  restoring = false;
}
function resumeAudio(): void {
  window.removeEventListener("pointerdown", resumeAudio);
  window.removeEventListener("keydown", resumeAudio);
  if (!needsGesture) return;
  needsGesture = false;
  ensureAudio();
  playMusic();
  render();
}
function record(
  end: number,
  complete: boolean,
  seconds = WORK,
  skipped = false,
): void {
  sessions.unshift({
    start: startedAt,
    end,
    seconds: Math.round(seconds),
    complete,
    skipped,
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
    let crossed = false;
    /** The last break→work boundary this pass settled, 0 for none. */
    let breakEnded = 0;
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
        // Every session opens on a different loop when shuffling.
        shuffleAt = 0;
        breakEnded = boundary;
      }
      deadline = boundary + duration() * 1000;
      crossed = true;
      $("announcement").textContent =
        phase === "work"
          ? "Focus time. Music is playing."
          : "Break time. Five minutes of silence.";
    }
    remaining = Math.max(0, (deadline - now) / 1000);
    if (phase === "work") {
      shuffleMusic(now);
      playMusic();
    } else silence();
    // The phase outlives this page, so a boundary has to reach storage.
    if (crossed) saveTimer();
    // At most one per pass, however many boundaries the loop just settled, and
    // never for one it only found because the page reloaded on top of it.
    if (
      breakEnded &&
      !restoring &&
      document.hidden &&
      now - breakEnded < NOTIFY_GRACE
    )
      notify(BREAK_OVER_TITLE, BREAK_OVER_BODY);
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
  $("cycle").textContent = `SESSION ${String(round).padStart(2, "0")}`;
  const statusText =
    state === "paused"
      ? "On pause. Take your time."
      : phase === "break"
        ? "Step away. Enjoy the quiet."
        : state === "running"
          ? "Just you and the next small thing."
          : "Make room for good work.";
  $("status").textContent = statusText;
  $("progress").style.strokeDashoffset = String(
    860.8 * (1 - remaining / duration()),
  );
  $("start").disabled = state === "running";
  $("start-label").textContent = state === "paused" ? "Resume" : "Start focus";
  $("pause").disabled = state !== "running";
  $("skip").disabled = state === "idle";
  $("skip-label").textContent =
    phase === "work" ? "Skip session" : "Skip break";
  $("stop").disabled = state === "idle";
  const track = findTrack(trackId);
  const name = choice === SHUFFLE ? `Shuffle · ${track.name}` : track.name;
  $("sound-label").textContent =
    phase === "break"
      ? "♫   Break time · music is silent"
      : state === "running"
        ? audioFailed
          ? "♫   Audio unavailable · timer running"
          : needsGesture
            ? `♫   ${name} · tap anywhere to bring the music back`
            : `♫   ${name} · playing`
        : `♫   ${name} · ${choice === SHUFFLE ? "a new loop every few minutes" : track.mood}`;
  // The same string both clocks show: the overlay cannot drift from #timer.
  $("break-timer").textContent = display;
  $("break-status").textContent = statusText;
  const onBreak = phase === "break" && state !== "idle";
  if (onBreak !== overlayOpen) {
    overlayOpen = onBreak;
    $("break-overlay").hidden = !onBreak;
    // A rest view that covers the page should leave the tab order too, and
    // nothing behind it is worth a scrollbar.
    $("app").inert = onBreak;
    document.body.style.overflow = onBreak ? "hidden" : "";
    if (onBreak) $("break-overlay").focus({ preventScroll: true });
    else {
      const back = $("start").disabled ? $("skip") : $("start");
      if (!back.disabled) back.focus({ preventScroll: true });
    }
  }
  document.body.classList.toggle("break", phase === "break");
}
$("start").addEventListener("click", () => {
  if (state === "running") return;
  audioFailed = false;
  if ($("storage-message").textContent === AUDIO_ERROR_MESSAGE) {
    $("storage-message").textContent = "";
  }
  ensureAudio();
  askToNotify();
  if (startedAt === null) startedAt = Date.now();
  if (shuffleAt === 0) shuffleAt = Date.now() + SHUFFLE_EVERY * 1000;
  state = "running";
  deadline = Date.now() + remaining * 1000;
  playMusic();
  saveTimer();
  tick();
});
$("pause").addEventListener("click", () => {
  if (state !== "running") return;
  tick();
  state = "paused";
  silence();
  saveTimer();
  render();
});
// Named, because the overlay's own buttons drive the same two actions.
function skipPhase(): void {
  if (state === "idle") return;
  // Settle a boundary the clock may have just passed before moving on.
  tick();
  const now = Date.now();
  if (phase === "work") {
    const spent = WORK - remaining;
    if (spent >= 1) record(now, false, spent, true);
    phase = "break";
    startedAt = null;
    silence();
  } else {
    phase = "work";
    round++;
    startedAt = state === "running" ? now : null;
    shuffleAt = 0;
  }
  remaining = duration();
  deadline = now + remaining * 1000;
  shuffleMusic(now);
  if (state === "running") playMusic();
  $("announcement").textContent =
    phase === "work"
      ? `Skipped the break. Session ${round} is ready.`
      : "Session skipped. Break time.";
  saveTimer();
  render();
}
function stopTimer(): void {
  if (state === "idle") return;
  tick();
  if (phase === "work" && WORK - remaining >= 1)
    record(Date.now(), false, WORK - remaining);
  resetTimer();
  render();
}
$("skip").addEventListener("click", skipPhase);
$("break-skip").addEventListener("click", skipPhase);
$("stop").addEventListener("click", stopTimer);
$("break-stop").addEventListener("click", stopTimer);
$("track").replaceChildren(
  Object.assign(document.createElement("option"), {
    value: SHUFFLE,
    textContent: "Shuffle",
  }),
  ...TRACKS.map((option) =>
    Object.assign(document.createElement("option"), {
      value: option.id,
      textContent: option.name,
    }),
  ),
);
$("track").value = choice;
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
    name.textContent = s.complete
      ? "✓  Focus completed"
      : s.skipped
        ? "⏭  Focus skipped"
        : "◌  Focus stopped";
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
restoreTimer();
render();
