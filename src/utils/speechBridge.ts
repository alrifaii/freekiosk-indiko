/**
 * window.speechSynthesis for pages in FreeKiosk's WebView, spoken by FreeKiosk itself
 * (NativeModules.FreeKioskSpeech → SpeechHub): built-in offline voices and the voices of
 * every Android speech engine (Samsung, Google, ...), all at once.
 *
 * Chrome's own speechSynthesis on Android only knows Android's default engine, picks it once
 * per app start, and leaves out engines that report languages without a country (the
 * sherpa-onnx engine). AsTeRICS Grid then saw no offline voice at all.
 *
 * The script is injected twice: before the page's own scripts where Android allows it, and
 * again after load (a no-op when already there). When it comes late, it takes over the
 * onvoiceschanged handler the page set on Chrome's object, so the page still learns about
 * the voices. Events follow the Web Speech API: start, end, error ("interrupted" for the
 * spoken utterance on cancel(), "canceled" for queued ones), voiceschanged.
 *
 * Messages to the app: FK_SPEECH_SPEAK {id, text, voiceURI, lang, rate, pitch, volume},
 * FK_SPEECH_CANCEL, FK_SPEECH_VOICES. From the app: window.__fkSpeech.event({type, id,
 * error}) and window.__fkSpeech.voices([...]).
 *
 * Keep this plain ES2017 without backticks or "${": it is embedded in a template string.
 */
export const SPEECH_BRIDGE_JS = String.raw`
(function () {
  // FK-SPEECH-BRIDGE-START
  if (window.__fkSpeech) return;
  var RN = window.ReactNativeWebView;
  if (!RN || typeof RN.postMessage !== 'function') return;
  if (typeof EventTarget !== 'function') return;
  function post(m) { try { RN.postMessage(JSON.stringify(m)); } catch (e) {} }

  var prev = null;
  try { prev = window.speechSynthesis || null; } catch (e) {}
  var prevVoicesChanged = null;
  try { if (prev && typeof prev.onvoiceschanged === 'function') prevVoicesChanged = prev.onvoiceschanged; } catch (e) {}
  try { if (prev && typeof prev.cancel === 'function') prev.cancel(); } catch (e) {}

  var voices = [], byUri = {}, loaded = false;
  var queue = [], current = null, seq = 0, paused = false, lastAsk = 0;

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }

  function makeEvent(type, u, extra) {
    var ev;
    try { ev = new Event(type); } catch (e) { ev = document.createEvent('Event'); ev.initEvent(type, false, false); }
    var props = { utterance: u, charIndex: 0, charLength: 0, elapsedTime: 0, name: '' };
    if (extra) for (var k in extra) props[k] = extra[k];
    for (var p in props) { try { Object.defineProperty(ev, p, { value: props[p], enumerable: true }); } catch (e) {} }
    return ev;
  }

  function fire(target, type, extra) {
    var ev = makeEvent(type, target instanceof Utterance ? target : null, extra);
    try { target.dispatchEvent(ev); } catch (e) {}
    var h = target['on' + type];
    if (typeof h === 'function') {
      try { h.call(target, ev); } catch (e) { setTimeout(function () { throw e; }); }
    }
  }

  class Utterance extends EventTarget {
    constructor(text) {
      super();
      this.text = text == null ? '' : String(text);
      this.lang = '';
      this.voice = null;
      this.volume = 1;
      this.rate = 1;
      this.pitch = 1;
      this.onstart = null; this.onend = null; this.onerror = null; this.onpause = null;
      this.onresume = null; this.onmark = null; this.onboundary = null;
    }
  }

  function Voice(v) {
    this.voiceURI = String(v.voiceURI || v.name || '');
    this.name = String(v.name || v.voiceURI || '');
    this.lang = String(v.lang || '');
    this.localService = v.localService !== false;
    this.default = !!v.default;
  }

  function askVoices(force) {
    var now = Date.now();
    if (!force && now - lastAsk < 800) return;
    lastAsk = now;
    post({ type: 'FK_SPEECH_VOICES' });
  }

  function setVoices(list) {
    if (!Array.isArray(list)) return;
    var nextList = [], map = {};
    list.forEach(function (v) {
      if (!v || !v.voiceURI) return;
      var o = byUri[v.voiceURI];
      if (!o || o.name !== v.name || o.lang !== v.lang || o.default !== !!v.default) o = new Voice(v);
      nextList.push(o);
      map[o.voiceURI] = o;
    });
    var changed = !loaded || nextList.length !== voices.length || nextList.some(function (v, i) { return v !== voices[i]; });
    voices = nextList;
    byUri = map;
    loaded = true;
    if (changed) fire(synth, 'voiceschanged');
  }

  function arm(c, ms, error) {
    clearTimeout(c.timer);
    c.timer = setTimeout(function () {
      if (current !== c) return;
      current = null;
      fire(c.u, 'error', { error: error });
      next();
    }, ms);
  }

  function next() {
    if (current || paused) return;
    var u = queue.shift();
    if (!u) return;
    var id = 'w' + (++seq) + '-' + Date.now().toString(36);
    var text = u.text == null ? '' : String(u.text);
    var voice = u.voice && u.voice.voiceURI ? String(u.voice.voiceURI) : '';
    var lang = u.lang || (u.voice && u.voice.lang) || (document.documentElement && document.documentElement.lang) || navigator.language || '';
    current = { u: u, id: id, started: false, timer: 0 };
    // A first sentence with a voice that still has to load can take a few seconds
    arm(current, 20000, 'synthesis-unavailable');
    post({ type: 'FK_SPEECH_SPEAK', id: id, text: text.slice(0, 4000), voiceURI: voice, lang: String(lang),
      rate: num(u.rate, 1), pitch: num(u.pitch, 1), volume: num(u.volume, 1) });
  }

  function onEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'voices') { askVoices(true); return; }
    var c = current;
    if (!c || c.id !== ev.id) return;
    if (ev.type === 'start') {
      if (c.started) return;
      c.started = true;
      // Safety net for a lost "end": generous, by text length
      arm(c, Math.max(30000, String(c.u.text || '').length * 400), 'synthesis-failed');
      fire(c.u, 'start');
    } else if (ev.type === 'end') {
      clearTimeout(c.timer);
      current = null;
      if (!c.started) fire(c.u, 'start');
      fire(c.u, 'end');
      next();
    } else if (ev.type === 'error') {
      clearTimeout(c.timer);
      current = null;
      fire(c.u, 'error', { error: ev.error || 'synthesis-failed' });
      next();
    }
  }

  class Synth extends EventTarget {
    constructor() {
      super();
      this.onvoiceschanged = prevVoicesChanged;
    }
    get speaking() { return !!current; }
    get pending() { return queue.length > 0; }
    get paused() { return paused; }
    getVoices() {
      if (!loaded) askVoices(false);
      return voices.slice();
    }
    speak(u) {
      if (!u || typeof u !== 'object') throw new TypeError("Failed to execute 'speak' on 'SpeechSynthesis': parameter 1 is not of type 'SpeechSynthesisUtterance'.");
      queue.push(u);
      if (!current && !paused) next();
    }
    cancel() {
      var c = current, q = queue;
      queue = [];
      current = null;
      if (c) {
        clearTimeout(c.timer);
        post({ type: 'FK_SPEECH_CANCEL' });
        fire(c.u, 'error', { error: 'interrupted' });
      }
      q.forEach(function (u) { fire(u, 'error', { error: 'canceled' }); });
    }
    // Android speech cannot pause in the middle: pause() holds the queue after the current utterance
    pause() { if (!paused) { paused = true; if (current) fire(current.u, 'pause'); } }
    resume() {
      if (!paused) return;
      paused = false;
      if (current) fire(current.u, 'resume');
      else next();
    }
  }

  var synth = new Synth();
  try {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, enumerable: true, get: function () { return synth; } });
  } catch (e) {}
  if (window.speechSynthesis !== synth) return;
  try { window.SpeechSynthesisUtterance = Utterance; } catch (e) {}
  try { window.SpeechSynthesisVoice = Voice; } catch (e) {}
  window.__fkSpeech = { event: onEvent, voices: setVoices, version: 1 };
  askVoices(true);
  // FK-SPEECH-BRIDGE-END
})();
`;
