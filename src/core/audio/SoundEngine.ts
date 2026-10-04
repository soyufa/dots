export class SoundEngine {
  private static instance: SoundEngine | null = null;
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isDrawingSoundActive: boolean = false;
  private drawingNoiseNode: AudioBufferSourceNode | null = null;
  private drawingGainNode: GainNode | null = null;
  private stopTimeoutId: number | null = null;

  // 펜타토닉 음계 주파수 테이블 (C5 ~ D6)
  private readonly scaleFrequencies: number[] = [
    523.25, // C5
    587.33, // D5
    659.25, // E5
    783.99, // G5
    880.00, // A5
    1046.50, // C6
    1174.66, // D6
    1318.51  // E6
  ];

  private constructor() {
    // 사용자 제스처 시 게으른 초기화
  }

  static getInstance(): SoundEngine {
    if (!this.instance) {
      this.instance = new SoundEngine();
    }
    return this.instance;
  }

  private initContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  unlock(): void {
    this.initContext();
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopDrawingSound();
    }
    return this.isMuted;
  }

  getMuted(): boolean {
    return this.isMuted;
  }

  /**
   * 점 연결 성공 시 재생되는 영롱한 펜타토닉 톤
   * @param colorIndex 점 쌍 색상 인덱스 (0, 1, 2, ...)
   */
  playConnectTone(colorIndex: number): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    const freq = this.scaleFrequencies[colorIndex % this.scaleFrequencies.length];
    const now = ctx.currentTime;

    // 메인 오실레이터 (사인파 벨 사운드)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, now);

    // 하모닉 배음 오실레이터 (삼각파로 따뜻한 질감 추가)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2, now);

    // ADSR Envelope
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.35, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc1.connect(gain1);
    osc2.connect(gain2);

    gain1.connect(ctx.destination);
    gain2.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);

    osc1.stop(now + 0.65);
    osc2.stop(now + 0.65);
  }

  /**
   * 충돌 또는 교차 발생 시 차단(Rebound) 버저음
   */
  playCollisionBuzzer(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.16);
  }

  /**
   * 점/선 삭제(Tap to Erase or Undo) 팝 사운드
   */
  playErasePop(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  /**
   * 드로잉 중 사각거리는 연필 질감 노이즈 재생
   */
  startDrawingSound(): void {
    if (this.stopTimeoutId !== null) {
      clearTimeout(this.stopTimeoutId);
      this.stopTimeoutId = null;
    }

    if (this.isMuted || this.isDrawingSoundActive) return;
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      this.isDrawingSoundActive = true;
      const bufferSize = ctx.sampleRate * 1; // 1초 루프 버퍼
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.drawingNoiseNode = ctx.createBufferSource();
      this.drawingNoiseNode.buffer = noiseBuffer;
      this.drawingNoiseNode.loop = true;

      // 밴드패스/하이패스 필터로 부드러운 연필 질감 형성
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1600;
      filter.Q.value = 1.2;

      this.drawingGainNode = ctx.createGain();
      this.drawingGainNode.gain.setValueAtTime(0.04, ctx.currentTime);

      this.drawingNoiseNode.connect(filter);
      filter.connect(this.drawingGainNode);
      this.drawingGainNode.connect(ctx.destination);

      this.drawingNoiseNode.start();
    } catch {
      this.isDrawingSoundActive = false;
    }
  }

  stopDrawingSound(): void {
    if (!this.isDrawingSoundActive) return;
    this.isDrawingSoundActive = false;

    if (this.stopTimeoutId !== null) {
      clearTimeout(this.stopTimeoutId);
      this.stopTimeoutId = null;
    }

    if (this.drawingGainNode && this.ctx) {
      try {
        this.drawingGainNode.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
      } catch {}
    }

    this.stopTimeoutId = window.setTimeout(() => {
      if (this.drawingNoiseNode) {
        try {
          this.drawingNoiseNode.stop();
          this.drawingNoiseNode.disconnect();
        } catch {}
        this.drawingNoiseNode = null;
      }
      this.drawingGainNode = null;
      this.stopTimeoutId = null;
    }, 60);
  }

  /**
   * 스테이지 클리어 팡파르 (C5 -> E5 -> G5 -> C6 아르페지오 및 화음)
   */
  playStageClearFanfare(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    const chords = [523.25, 659.25, 783.99, 1046.50]; // C, E, G, High C
    const now = ctx.currentTime;

    chords.forEach((freq, idx) => {
      const delay = idx * 0.09;
      const noteTime = now + delay;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0, noteTime);
      gain.gain.linearRampToValueAtTime(0.3, noteTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 1.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 1.3);
    });
  }
}
