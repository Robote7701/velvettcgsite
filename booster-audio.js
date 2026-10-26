(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VelvetAudio = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const PREFERENCE_KEY = 'velvet-audio-muted';

  function create(options = {}) {
    const host = options.host || (typeof window === 'object' ? window : {});
    const storage = options.storage;
    let muted = false, context = null, master = null, noise = null, resuming = null, generation = 0;
    const voices = new Set();
    try { muted = storage?.getItem(PREFERENCE_KEY) === '1'; } catch {}

    function ensureContext() {
      if (context) return context;
      const Constructor = host.AudioContext || host.webkitAudioContext;
      if (!Constructor) return null;
      context = new Constructor();
      master = context.createGain();
      master.gain.value = .22;
      master.connect(context.destination);
      return context;
    }

    function ready() {
      try {
        const audio = ensureContext();
        if (!audio) return Promise.resolve(false);
        if (audio.state === 'running') return Promise.resolve(true);
        if (!resuming) {
          resuming = Promise.resolve(audio.resume()).then(() => audio.state === 'running', () => false)
            .finally(() => { resuming = null; });
        }
        return resuming;
      } catch { return Promise.resolve(false); }
    }

    function silence() {
      if (!context) return;
      const now = context.currentTime;
      for (const voice of voices) {
        try {
          voice.output.gain.cancelScheduledValues(now);
          voice.output.gain.setValueAtTime(voice.output.gain.value, now);
          voice.output.gain.linearRampToValueAtTime(0, now + .02);
          for (const source of voice.sources) source.stop(now + .03);
        } catch {}
      }
      voices.clear();
    }

    function stop() { generation++; silence(); }

    function voice() {
      const output = context.createGain();
      output.connect(master);
      const item = { output, nodes: [output], sources: new Set() };
      voices.add(item);
      return item;
    }

    function track(item, source, nodes) {
      item.sources.add(source);
      item.nodes.push(source, ...nodes);
      source.onended = () => {
        item.sources.delete(source);
        if (item.sources.size) return;
        voices.delete(item);
        for (const node of item.nodes) { try { node.disconnect(); } catch {} }
      };
    }

    function tone(item, frequency, at, duration, level = .14) {
      const oscillator = context.createOscillator(), envelope = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(level, at + .012);
      envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
      oscillator.connect(envelope); envelope.connect(item.output);
      track(item, oscillator, [envelope]);
      oscillator.start(at); oscillator.stop(at + duration + .02);
    }

    function tear(item, at) {
      if (!noise) {
        noise = context.createBuffer(1, Math.ceil(context.sampleRate * .24), context.sampleRate);
        const samples = noise.getChannelData(0);
        // A private deterministic noise sequence never touches the draw RNG.
        let seed = 9471;
        for (let i = 0; i < samples.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          samples[i] = seed / 2147483648 - 1;
        }
      }
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
      source.buffer = noise;
      filter.type = 'bandpass'; filter.Q.value = .7;
      filter.frequency.setValueAtTime(3000, at);
      filter.frequency.exponentialRampToValueAtTime(750, at + .2);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(.45, at + .025);
      envelope.gain.exponentialRampToValueAtTime(.0001, at + .23);
      source.connect(filter); filter.connect(envelope); envelope.connect(item.output);
      track(item, source, [filter, envelope]);
      source.start(at); source.stop(at + .24);
    }

    function render(kind, fast) {
      const item = voice(), at = context.currentTime + .01;
      try {
        if (kind === 'open') {
          tone(item, 196, at, .28, .11);
          tear(item, at + (fast ? .015 : .63));
        } else {
          const melodies = { common: [440], rare: [523.25, 659.25], epic: [523.25, 659.25, 783.99], gold: [523.25, 659.25, 783.99, 1046.5], summary: [659.25, 523.25], preview: [659.25] };
          const notes = melodies[kind] || melodies.common;
          notes.forEach((frequency, index) => tone(item, frequency, at + index * .075, kind === 'gold' ? .9 : .46, kind === 'summary' ? .08 : .14));
          if (kind === 'gold') tone(item, 2093, at + .27, .8, .04);
        }
      } catch { silence(); }
    }

    function play(kind, options = {}) {
      stop();
      if (muted || host.document?.hidden) return;
      const token = generation;
      ready().then(available => {
        if (available && !muted && !host.document?.hidden && token === generation) render(kind, options.fast === true);
      }).catch(() => {});
    }

    return {
      get muted() { return muted; },
      unlock() { if (!muted) return ready(); return Promise.resolve(false); },
      play,
      stop,
      setMuted(value) {
        muted = Boolean(value);
        stop();
        try { storage?.setItem(PREFERENCE_KEY, muted ? '1' : '0'); } catch {}
      }
    };
  }
  return { create, PREFERENCE_KEY };
});
