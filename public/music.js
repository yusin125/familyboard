// 배경음악: 실제 음원 파일 대신 Web Audio API로 D장조 진행(D-A-Bm-G) 위에 피아노
// 아르페지오(기본 흐름) + 따뜻한 패드(은은한 배경) + 홀수 마디마다 얹히는 멜로디 라인을
// 그 자리에서 합성해 무한 루프로 재생한다. 시간이 지날수록 점점 밝아지는 느낌을 주기 위해
// 패드/멜로디의 톤과 존재감을 아주 서서히 끌어올린다.
(function () {
  'use strict';

  const TEMPO = 72; // BPM — 잔잔하게 흐르는 느린 템포
  const SECONDS_PER_BEAT = 60 / TEMPO;
  const STEPS_PER_BEAT = 2; // 8분음표 단위
  const SECONDS_PER_STEP = SECONDS_PER_BEAT / STEPS_PER_BEAT;
  const STEPS_PER_BAR = 8;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_TIME = 0.12;
  const MASTER_VOLUME = 0.16; // 적당히 낮은 기본 볼륨

  // 서서히 곡이 열리는 느낌을 만들기 위한 밝기 램프 길이(마디 수). 이 마디 수를 지나면
  // 패드/멜로디가 가장 밝고 또렷한 상태로 유지된다.
  const BRIGHTEN_BARS = 12;

  // 코드 진행: D장조 D - A - Bm - G, 한 코드당 한 마디(8스텝). 마지막 코드가 끝나면
  // 다시 처음 코드로 돌아가 무한히 반복(loop)된다.
  const CHORDS = [
    { notes: [62, 66, 69, 74] }, // D  : D4 F#4 A4 D5
    { notes: [57, 61, 64, 69] }, // A  : A3 C#4 E4 A4
    { notes: [59, 62, 66, 71] }, // Bm : B3 D4 F#4 B4
    { notes: [55, 59, 62, 67] }  // G  : G3 B3 D4 G4
  ];

  // 피아노 아르페지오 패턴: 코드를 낮은 음부터 부드럽게 펼쳤다가 내려오는 흐름(코드 구성음 인덱스)
  const ARPEGGIO_PATTERN = [0, 1, 2, 3, 2, 1, 0, 1];

  // 멜로디: D장조 펜타토닉을 한 옥타브 위에서 사용(코드가 Bm이어도 자연스럽게 어울린다)
  const MELODY_SCALE = [74, 76, 78, 81, 83]; // D5 E5 F#5 A5 B5
  const MELODY_MOTIFS = [
    [1, 4, 6],
    [0, 3, 5, 6]
  ];

  let ctx = null;
  let masterGain = null;
  let arpeggioBus = null;
  let padBus = null;
  let melodyBus = null;

  let isPlaying = false;
  let schedulerTimer = null;
  let nextNoteTime = 0;
  let currentStep = 0;
  let barsSinceStart = 0;

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function ensureContext() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);

    arpeggioBus = ctx.createGain();
    arpeggioBus.gain.value = 0.9;
    arpeggioBus.connect(masterGain);

    padBus = ctx.createGain();
    padBus.gain.value = 0.8;
    padBus.connect(masterGain);

    melodyBus = ctx.createGain();
    melodyBus.gain.value = 0.9;
    melodyBus.connect(masterGain);
  }

  // 피아노 아르페지오: 코드를 부드럽게 펼쳐 연주하는 기본 흐름 (트라이앵글 + 옅은 배음)
  function playArpeggioNote(freq, time, duration, level, brightness) {
    const body = ctx.createOscillator();
    const shimmer = ctx.createOscillator();
    body.type = 'triangle';
    shimmer.type = 'square';
    body.frequency.value = freq;
    shimmer.frequency.value = freq * 2;

    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.1;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lerp(2200, 3400, brightness);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, time + duration);

    body.connect(filter);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(filter);
    filter.connect(g);
    g.connect(arpeggioBus);

    body.start(time);
    shimmer.start(time);
    body.stop(time + duration + 0.05);
    shimmer.stop(time + duration + 0.05);
  }

  // 따뜻한 패드: 코드음을 길게 늘여 은은하게 배경을 채운다 (사인+트라이앵글, 느린 어택/릴리즈)
  function playPadNote(freq, time, duration, level, brightness) {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.value = freq;
    osc2.frequency.value = freq;
    osc2.detune.value = 6; // 살짝 디튠해 두터운 코러스 느낌

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lerp(900, 2300, brightness);
    filter.Q.value = 0.4;

    const attack = duration * 0.35;
    const release = duration * 0.45;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + attack);
    g.gain.setValueAtTime(level, time + duration - release);
    g.gain.linearRampToValueAtTime(0, time + duration);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(g);
    g.connect(padBus);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + duration + 0.05);
    osc2.stop(time + duration + 0.05);
  }

  // 멜로디 라인: 홀수 마디마다 등장해 곡이 서서히 열리는 느낌을 준다 (맑은 사인 + 옅은 비브라토)
  function playMelodyNote(freq, time, duration, level) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 3;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0004, time + duration);

    osc.connect(g);
    g.connect(melodyBus);

    vibrato.start(time);
    osc.start(time);
    vibrato.stop(time + duration + 0.05);
    osc.stop(time + duration + 0.05);
  }

  function scheduleStep(stepAbsolute, time) {
    const barPos = stepAbsolute % STEPS_PER_BAR;
    const barIndex = Math.floor(stepAbsolute / STEPS_PER_BAR);
    const chord = CHORDS[barIndex % CHORDS.length];
    if (barPos === 0) barsSinceStart = barIndex;
    const brightness = Math.min(1, barsSinceStart / BRIGHTEN_BARS);

    // 피아노 아르페지오: 매 스텝마다 코드를 펼쳐 연주(기본 흐름)
    const arpNoteIdx = ARPEGGIO_PATTERN[barPos % ARPEGGIO_PATTERN.length];
    const arpMidi = chord.notes[arpNoteIdx % chord.notes.length];
    playArpeggioNote(midiToFreq(arpMidi), time, SECONDS_PER_STEP * 1.7, 0.09, brightness);

    // 따뜻한 패드: 마디가 바뀔 때마다 코드 전체를 길게 깔아준다
    if (barPos === 0) {
      const padDuration = SECONDS_PER_STEP * STEPS_PER_BAR * 1.15;
      const padLevel = lerp(0.032, 0.055, brightness);
      chord.notes.forEach((n) => playPadNote(midiToFreq(n), time, padDuration, padLevel, brightness));
    }

    // 멜로디: 홀수 마디(1, 3, 5...)마다 등장해 점점 밝아지는 느낌으로 곡을 열어준다
    const isOddBar = barIndex % 2 === 0; // barIndex는 0부터 시작하므로 짝수 인덱스 = 홀수 번째 마디
    if (isOddBar) {
      const motif = MELODY_MOTIFS[(barIndex / 2) % MELODY_MOTIFS.length];
      const motifPos = motif.indexOf(barPos);
      if (motifPos !== -1) {
        const scaleIdx = (motifPos + Math.floor(barIndex / 2)) % MELODY_SCALE.length;
        const melodyLevel = lerp(0.038, 0.075, brightness);
        playMelodyNote(midiToFreq(MELODY_SCALE[scaleIdx]), time, SECONDS_PER_STEP * 1.4, melodyLevel);
      }
    }
  }

  function scheduler() {
    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_TIME) {
      scheduleStep(currentStep, nextNoteTime);
      nextNoteTime += SECONDS_PER_STEP;
      currentStep++;
    }
    schedulerTimer = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  function start() {
    ensureContext();
    if (!ctx || isPlaying) return;
    if (ctx.state === 'suspended') ctx.resume();
    isPlaying = true;
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(MASTER_VOLUME, now + 1.2);
    currentStep = 0;
    barsSinceStart = 0;
    nextNoteTime = now + 0.1;
    scheduler();
  }

  function stop() {
    if (!isPlaying) return;
    isPlaying = false;
    if (schedulerTimer) { clearTimeout(schedulerTimer); schedulerTimer = null; }
    if (ctx && masterGain) {
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0, now + 0.4);
    }
  }

  function toggle() {
    if (isPlaying) { stop(); return false; }
    start();
    return true;
  }

  window.FB_MUSIC = { start, stop, toggle, isPlaying: () => isPlaying };
})();
