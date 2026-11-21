import Phaser from "phaser";
import "./style.css";

const TILE = 32;
const SPEED = 200;
const JUMP = 450;
const COYOTE_MS = 100;
const BUFFER_MS = 120;
const TIMED_SPIKE_PERIOD = 2600;
const TIMED_SPIKE_ACTIVE_MS = 1150;


const s = (n: number) => " ".repeat(n);
const W = "#".repeat(25);
const E = "#" + s(23) + "#";
const levelRow = (tiles: Record<number, string>) => {
  const row: string[] = Array(25).fill(" ");
  row[0] = "#";
  row[24] = "#";
  Object.entries(tiles).forEach(([column, tile]) => {
    row[Number(column)] = tile;
  });
  return row.join("");
};

// # solid block, X crumbling block, ^ spike, T timed spike, P player, C checkpoint, B chaser button, K key, D locked door, G goal
const LEVELS: string[][] = [
  // Level 1
  [
    W,
    E,
    "#" + s(19) + "#".repeat(4) + "#",
    "#" + s(17) + "#" + s(6) + "#",
    "#" + s(17) + "#" + s(6) + "#",
    "#" + s(13) + "####" + s(7) + "#",
    "#" + s(13) + "#" + s(10) + "#",
    "#" + s(13) + "#" + s(10) + "#",
    "#" + s(9) + "#####" + s(10) + "#",
    "#" + s(7) + "CB" + s(16) + "#",
    "#" + s(5) + "####X" + s(14) + "#",
    "#" + s(5) + "#" + s(6) + "######" + s(7) + "#",
    "#" + s(5) + "#" + s(6) + "#" + s(12) + "#",
    "#P" + s(3) + "##" + s(6) + "#" + s(12) + "#",
    "#" + s(4) + "#" + s(13) + "G" + s(6) + "#",
    "#" + s(4) + "#" + s(5) + "^^" + s(1) + "^^" + s(3) + "####" + s(1) + "#",
    "#" + s(1) + "^^" + "T" + s(1) + "^^^" + s(1) + "#####" + "^^^" + s(4) + "^" + "#",
    W,
  ],
  // Level 2
  [
    W,
    ...Array(9).fill(E),
    "#" + s(18) + "^" + s(2) + "G" + s(1) + "#",
    "#" + s(14) + "#".repeat(10),
    E,
    "#" + s(6) + "C" + s(3) + "#X#" + s(10) + "#",
    "#" + s(6) + "##" + s(15) + "#",
    "#" + s(2) + "##" + s(19) + "#",
    "#P" + s(4) + "^^^^T^^^^^^T^^^^^^" + "#",
    W,
  ],
  // Level 3: collect the key to open the tall gate
  [
    W,
    E,
    E,
    E,
    E,
    E,
    E,
    E,
    E,
    levelRow({ 18: "D" }),
    levelRow({ 18: "D" }),
    levelRow({ 18: "D" }),
    levelRow({ 18: "D" }),
    levelRow({ 12: "K", 18: "D" }),
    levelRow({ 11: "#", 12: "#", 13: "#", 18: "D" }),
    levelRow({ 8: "X", 9: "#", 10: "#", 18: "D" }),
    levelRow({ 1: "P", 2: "C", 4: "^", 5: "^", 14: "T", 16: "^", 17: "^", 18: "D", 22: "G" }),
    W,
  ],
  // Level 4: timed spike gauntlet with crumbling safe spots
  [
    W,
    ...Array(15).fill(E),
    levelRow({
      1: "P",
      3: "^",
      4: "T",
      5: "^",
      7: "X",
      9: "^",
      10: "T",
      11: "^",
      12: "C",
      14: "X",
      16: "^",
      17: "T",
      18: "^",
      19: "X",
      22: "G",
    }),
    W,
  ],
  // Level 5: climb to the key, unlock the gate, then clear the final timed spikes
  [
    W,
    ...Array(8).fill(E),
    levelRow({ 18: "D" }),
    ...Array(3).fill(levelRow({ 18: "D" })),
    levelRow({ 12: "K", 18: "D" }),
    levelRow({ 11: "#", 12: "#", 13: "#", 15: "X", 16: "#", 18: "D" }),
    levelRow({ 9: "#", 10: "#", 14: "#", 15: "#", 16: "#", 17: "#", 18: "D" }),
    levelRow({
      1: "P",
      3: "C",
      5: "^",
      6: "T",
      7: "^",
      8: "X",
      12: "T",
      14: "^",
      15: "T",
      16: "^",
      18: "D",
      21: "T",
      22: "G",
    }),
    W,
  ],
];

const SPIKES: Record<string, { angle: number; box: [number, number, number, number] }> = {
  "^": { angle: 0, box: [8, 16, 16, 16] },
  ">": { angle: 90, box: [0, 8, 16, 16] },
  v: { angle: 180, box: [8, 0, 16, 16] },
  "<": { angle: 270, box: [16, 8, 16, 16] },
};

type TimedSpike = {
  box: Phaser.Geom.Rectangle;
  image: Phaser.GameObjects.Image;
  phaseOffset: number;
  active: boolean;
};

type CrumblePlatform = {
  tile: Phaser.Physics.Arcade.Image;
  triggeredAt: number | null;
};

type PatrolEnemy = {
  image: Phaser.GameObjects.Image;
  left: number;
  right: number;
  speed: number;
  direction: number;
};

class GameScene extends Phaser.Scene {
  private levelIndex = 0;
  private deaths = 0;
  private won = false;
  private muted = false;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private backgroundMusic: Phaser.Sound.BaseSound | null = null;
  private jumpscareVideo: HTMLVideoElement | null = null;
  private jumpscareStartTimer: Phaser.Time.TimerEvent | null = null;
  private jumpscareActive = false;
  private lightingOverlay: Phaser.GameObjects.Rectangle | null = null;
  private fakeOutImage: Phaser.GameObjects.Image | null = null;
  private fakeOutCount = 0;
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private spikeBoxes: Phaser.Geom.Rectangle[] = [];
  private timedSpikes: TimedSpike[] = [];
  private crumblePlatforms: CrumblePlatform[] = [];
  private patrolEnemies: PatrolEnemy[] = [];
  private goalBox: Phaser.Geom.Rectangle | null = null;
  private checkpointBox: Phaser.Geom.Rectangle | null = null;
  private checkpointPosition: Phaser.Math.Vector2 | null = null;
  private checkpointSprite: Phaser.GameObjects.Image | null = null;
  private checkpointActive = false;
  private chaserButtonBox: Phaser.Geom.Rectangle | null = null;
  private chaserButtonPosition: Phaser.Math.Vector2 | null = null;
  private chaserButtonSprite: Phaser.GameObjects.Image | null = null;
  private yomSprite: Phaser.GameObjects.Image | null = null;
  private yomActive = false;
  private keyBox: Phaser.Geom.Rectangle | null = null;
  private keySprite: Phaser.GameObjects.Image | null = null;
  private lockedDoorTiles: Phaser.Physics.Arcade.Image[] = [];
  private requiresKey = false;
  private hasKey = false;
  private spawn = new Phaser.Math.Vector2();
  private hud!: Phaser.GameObjects.Text;
  private lastGrounded = -1e9;
  private lastJumpPress = -1e9;
  private jumpsUsed = 0;
  private touchLeft = false;
  private touchRight = false;
  private touchJumpHeld = false;
  private touchJumpPressed = false;
  private touchControlsCreated = false;
  private touchControlObjects: Phaser.GameObjects.GameObject[] = [];
  private readonly handleViewportResize = () => {
    requestAnimationFrame(() => this.createTouchControls());
  };

  constructor() {
    super("game");
  }

  init(data: { level?: number; deaths?: number }) {
    this.levelIndex = data.level ?? 0;
    this.deaths = data.deaths ?? 0;
    if (this.levelIndex === 0) this.fakeOutCount = 0;
  }

  preload() {
    this.load.audio("backgroundMusic", "/gameboy1.mp3");
    this.load.image("fakeOut", "/jumpscare.jpg");
    this.load.image("yom", "/yom.jpg");
  }

  private startAudio() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.28;
      this.masterGain.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }

    if (!this.backgroundMusic) {
      this.backgroundMusic = this.sound.add("backgroundMusic", { loop: true, volume: 0.12 });
      this.sound.setMute(this.muted);
    }
    if (!this.backgroundMusic.isPlaying) {
      this.backgroundMusic.play();
    }
  }

  private playCheckpointJumpscare() {
    if (this.jumpscareActive) return;

    this.jumpscareActive = true;
    this.player.setVelocity(0, 0);
    this.physics.world.pause();
    this.sound.setMute(true);
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
    }
    this.cameras.main.fadeOut(180, 0, 0, 0);
    this.jumpscareStartTimer = this.time.delayedCall(240, () => {
      if (this.jumpscareActive) this.startCheckpointJumpscareVideo();
    });
  }

  private startCheckpointJumpscareVideo() {
    const video = document.createElement("video");
    video.src = "/jumpscare.mp4";
    video.preload = "auto";
    video.playsInline = true;
    video.muted = this.muted;
    video.volume = 1;
    video.playbackRate = 1.5;
    video.setAttribute("playsinline", "");
    video.setAttribute("aria-label", "Jumpscare video");
    Object.assign(video.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      objectFit: "cover",
      background: "#000",
      zIndex: "10000",
    });
    this.jumpscareVideo = video;
    document.body.appendChild(video);
    video.addEventListener(
      "ended",
      () => this.finishCheckpointJumpscare(),
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        if (this.jumpscareVideo !== video) return;
        console.error("Unable to load /jumpscare.mp4:", video.error?.message ?? "unknown media error");
        this.finishCheckpointJumpscare();
      },
      { once: true },
    );
    video.load();
    void video.play().catch((error: unknown) => {
      console.error("Unable to play /jumpscare.mp4:", error);
      this.finishCheckpointJumpscare();
    });
  }

  private finishCheckpointJumpscare() {
    if (!this.jumpscareActive) return;

    this.jumpscareStartTimer?.remove(false);
    this.jumpscareStartTimer = null;
    const video = this.jumpscareVideo;
    this.jumpscareVideo = null;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    }

    this.jumpscareActive = false;
    this.physics.world.resume();
    this.sound.setMute(this.muted);
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : 0.28,
        this.audioContext.currentTime,
        0.03,
      );
    }
    this.cameras.main.fadeIn(180, 0, 0, 0);
  }

  private scheduleLightingFlicker() {
    this.time.delayedCall(Phaser.Math.Between(5000, 13000), () => {
      const overlay = this.lightingOverlay;
      if (!overlay || this.jumpscareActive || this.won) return;

      const blackout = Phaser.Math.Between(0, 3) === 0;
      this.tweens.add({
        targets: overlay,
        alpha: blackout ? 0.96 : 0.62,
        duration: blackout ? 25 : 40,
        hold: blackout ? 280 : 35,
        yoyo: true,
        repeat: blackout ? 0 : Phaser.Math.Between(1, 3),
        repeatDelay: 45,
        onComplete: () => {
          overlay.setAlpha(0);
          if (!this.jumpscareActive && !this.won) this.scheduleLightingFlicker();
        },
      });
    });
  }

  private scheduleFakeOut() {
    if (this.fakeOutCount >= 2) return;

    this.time.delayedCall(Phaser.Math.Between(7000, 16000), () => {
      if (this.jumpscareActive || this.won || this.fakeOutCount >= 2) return;
      if (Phaser.Math.Between(0, 1) === 0) return;

      this.fakeOutCount++;
      const image = this.fakeOutImage;
      if (!image) return;
      image.setVisible(true).setAlpha(0.95);
      this.cameras.main.shake(100, 0.008);
      this.playTone(150, 0.12, 0.24, "sawtooth", 55);
      this.time.delayedCall(90, () => image.setVisible(false).setAlpha(0));
    });
  }

  private toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : 0.28,
        this.audioContext.currentTime,
        0.03,
      );
    }
    this.sound.setMute(this.muted);
    if (this.jumpscareVideo) this.jumpscareVideo.muted = this.muted;
    this.updateHud();
  }

  private playTone(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
    endFrequency?: number,
  ) {
    if (!this.audioContext || !this.masterGain || this.muted) return;

    const now = this.audioContext.currentTime;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    }

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  private playDeathSound() {
    this.playTone(420, 0.65, 0.7, "sawtooth", 55);
  }

  private playWinSound() {
    [523, 659, 784, 1046].forEach((note, index) => {
      this.time.delayedCall(index * 120, () => this.playTone(note, 0.28, 0.16, "triangle"));
    });
  }

  private makeTextures() {
    if (this.textures.exists("block")) return;
    const g = this.add.graphics();

    g.fillStyle(0x26384a).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x334b60).fillRect(2, 2, TILE - 4, TILE - 4);
    g.fillStyle(0x1c2d3b).fillRect(2, TILE - 5, TILE - 4, 3);
    g.lineStyle(1, 0x41596a).strokeRect(2, 2, TILE - 4, TILE - 4);
    g.generateTexture("block", TILE, TILE);
    g.clear();

    g.fillStyle(0x26384a).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0xeaf9ff).fillRect(0, 0, TILE, 5);
    g.lineStyle(2, 0x74c8ef);
    g.beginPath();
    g.moveTo(0, 8);
    for (let x = 0; x <= TILE; x += 8) {
      g.lineTo(x + 4, x % 16 === 0 ? 12 : 7);
    }
    g.strokePath();
    g.generateTexture("blockTop", TILE, TILE);
    g.clear();

    g.fillStyle(0x293746).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x8c7360).fillRect(0, 0, TILE, 5);
    g.lineStyle(2, 0xd4b68f);
    g.beginPath();
    g.moveTo(5, 6);
    g.lineTo(13, 14);
    g.lineTo(9, 21);
    g.moveTo(24, 6);
    g.lineTo(18, 12);
    g.lineTo(23, 18);
    g.strokePath();
    g.generateTexture("crumble", TILE, TILE);
    g.clear();

    g.fillStyle(0xf6fbff).fillTriangle(0, TILE, TILE / 2, 1, TILE, TILE);
    g.fillStyle(0xb9d9ed).fillTriangle(TILE / 2, 1, TILE, TILE, TILE / 2, TILE);
    g.generateTexture("spike", TILE, TILE);
    g.clear();

    g.fillStyle(0x10151c).fillRect(3, 8, 18, 20);
    g.fillStyle(0xdcebf3).fillRect(5, 10, 14, 12);
    g.fillStyle(0x10151c).fillRect(7, 12, 10, 8);
    g.fillStyle(0x63b8dc).fillRect(9, 14, 3, 3);
    g.fillStyle(0x63b8dc).fillRect(14, 14, 3, 3);
    g.fillStyle(0x26384a).fillRect(5, 22, 4, 6);
    g.fillStyle(0x26384a).fillRect(15, 22, 4, 6);
    g.generateTexture("player", 24, 28);
    g.clear();

    g.lineStyle(3, 0xc9f1ff).strokeRect(5, 3, 22, 26);
    g.lineStyle(2, 0x63b8dc);
    g.strokeRect(9, 7, 14, 18);
    g.strokeRect(12, 10, 8, 12);
    g.generateTexture("goal", TILE, TILE);
    g.clear();

    g.fillStyle(0xdcebf3).fillRect(8, 4, 3, 26);
    g.fillStyle(0x63b8dc).fillTriangle(11, 5, 28, 11, 11, 18);
    g.lineStyle(2, 0xdcebf3).strokeCircle(10, 5, 4);
    g.generateTexture("checkpoint", TILE, TILE);
    g.clear();

    g.fillStyle(0x253241).fillRect(4, 17, 24, 12);
    g.fillStyle(0x9caebb).fillRect(7, 13, 18, 8);
    g.fillStyle(0xed554c).fillCircle(16, 13, 6);
    g.generateTexture("chaserButton", TILE, TILE);
    g.clear();

    g.fillStyle(0xec594e).fillCircle(16, 16, 12);
    g.fillStyle(0xffddd4).fillCircle(12, 13, 3);
    g.fillStyle(0xffddd4).fillCircle(20, 13, 3);
    g.fillStyle(0x283241).fillCircle(12, 13, 1.5);
    g.fillStyle(0x283241).fillCircle(20, 13, 1.5);
    g.fillStyle(0x8e3238).fillRect(11, 20, 10, 3);
    g.generateTexture("enemy", TILE, TILE);
    g.clear();

    g.fillStyle(0xd8aa3b).fillRect(12, 14, 17, 4);
    g.fillStyle(0xffdf74).fillCircle(9, 16, 7);
    g.fillStyle(0x273342).fillCircle(9, 16, 3);
    g.fillStyle(0xd8aa3b).fillRect(22, 18, 4, 6);
    g.fillStyle(0xd8aa3b).fillRect(27, 18, 3, 4);
    g.generateTexture("key", TILE, TILE);
    g.clear();

    g.fillStyle(0x593b3d).fillRect(2, 0, 28, TILE);
    g.fillStyle(0x9f7753).fillRect(5, 2, 22, 28);
    g.lineStyle(2, 0xf0cd75).strokeRect(6, 3, 20, 26);
    g.fillStyle(0x523c3b).fillCircle(21, 15, 2);
    g.fillStyle(0x523c3b).fillRect(20, 15, 2, 7);
    g.generateTexture("lockedDoor", TILE, TILE);
    g.destroy();
  }

  private drawBackground(worldW: number, worldH: number) {
    const bg = this.add.graphics().setDepth(-10);

    bg.fillStyle(0x172942).fillRect(0, 0, worldW, worldH);
    bg.fillStyle(0x263b55).fillRect(0, 0, worldW, 230);
    bg.fillStyle(0x36536b).fillRect(0, 230, worldW, 160);
    bg.fillStyle(0x1b3044).fillRect(0, 390, worldW, 186);

    bg.fillStyle(0x607b91);
    for (let i = 0; i < 6; i++) {
      const x = i * 190 - 80;
      bg.fillTriangle(x, 390, x + 130, 270, x + 260, 390);
      bg.fillStyle(0x728ba0);
      bg.fillTriangle(x + 65, 335, x + 130, 270, x + 195, 335);
      bg.fillStyle(0x607b91);
    }

    bg.fillStyle(0xaed4e6);
    for (let i = 0; i < 55; i++) {
      const x = (i * 73 + 19) % worldW;
      const y = (i * 47 + 31) % worldH;
      bg.fillCircle(x, y, i % 5 === 0 ? 2 : 1);
    }

    bg.fillStyle(0x88a4ba);
    for (let i = 0; i < 5; i++) {
      const x = i * 210 + ((i % 2) * 55);
      const y = 70 + (i % 3) * 28;
      bg.fillEllipse(x, y, 82, 20);
      bg.fillEllipse(x + 24, y - 8, 42, 18);
      bg.fillEllipse(x - 28, y - 4, 34, 14);
    }

    for (let i = 0; i < 9; i++) {
      const x = i * 110 - 40;
      bg.fillStyle(0x1a2e40).fillTriangle(x, worldH, x + 48, 430, x + 96, worldH);
      bg.fillStyle(0x315369).fillTriangle(x + 48, 430, x + 96, worldH, x + 48, worldH);
      bg.fillStyle(0xbfd9df).fillTriangle(x + 48, 430, x + 67, 472, x + 58, 472);

      bg.fillStyle(0x24475d);
      bg.fillTriangle(x - 20, worldH, x + 12, 405, x + 44, worldH);
      bg.fillStyle(0x668297);
      bg.fillTriangle(x - 20, worldH, x + 12, 405, x + 12, worldH);
    }

    for (let i = 0; i < 18; i++) {
      const x = (i * 51 + 12) % worldW;
      const y = (i * 37 + 140) % 380;
      bg.fillStyle(0x9fc0d2).fillCircle(x, y, i % 4 === 0 ? 2 : 1);
    }
  }

  private addPatrolEnemy(x: number, y: number, left: number, right: number, speed: number) {
    const image = this.add.image(x, y, "enemy").setDepth(3);
    this.patrolEnemies.push({ image, left, right, speed, direction: 1 });
  }

  private updateCrumblePlatforms(time: number, body: Phaser.Physics.Arcade.Body) {
    for (let i = this.crumblePlatforms.length - 1; i >= 0; i--) {
      const platform = this.crumblePlatforms[i];
      const left = platform.tile.x - TILE / 2;
      const top = platform.tile.y - TILE / 2;
      const standingOnPlatform =
        body.blocked.down &&
        body.bottom >= top - 3 &&
        body.bottom <= top + 5 &&
        body.right > left &&
        body.x < left + TILE;

      if (platform.triggeredAt === null && standingOnPlatform) {
        platform.triggeredAt = time;
        platform.tile.setTint(0xffc078);
      }

      if (platform.triggeredAt === null) continue;
      const elapsed = time - platform.triggeredAt;
      if (elapsed >= 850) {
        platform.tile.destroy();
        this.crumblePlatforms.splice(i, 1);
      } else if (elapsed >= 450) {
        platform.tile.setAlpha(Math.floor(elapsed / 90) % 2 === 0 ? 0.35 : 1);
      }
    }
  }

  private updateTimedSpikes(time: number, playerBox: Phaser.Geom.Rectangle): boolean {
    for (const spike of this.timedSpikes) {
      const phase = (time + spike.phaseOffset) % TIMED_SPIKE_PERIOD;
      const active = phase < TIMED_SPIKE_ACTIVE_MS;
      const warning = phase >= TIMED_SPIKE_ACTIVE_MS && phase < TIMED_SPIKE_ACTIVE_MS + 600;

      spike.image.setAlpha(active ? 1 : warning ? 0.72 : 0.25);
      spike.image.setTint(active ? 0xff5d55 : warning ? 0xffd166 : 0x9caebb);

      if (active && Phaser.Geom.Intersects.RectangleToRectangle(playerBox, spike.box)) {
        this.respawn(true);
        return true;
      }
    }
    return false;
  }

  private updatePatrolEnemies(delta: number, playerBox: Phaser.Geom.Rectangle): boolean {
    for (const enemy of this.patrolEnemies) {
      enemy.image.x += enemy.direction * enemy.speed * (delta / 1000);
      if (enemy.image.x >= enemy.right) {
        enemy.image.x = enemy.right;
        enemy.direction = -1;
      } else if (enemy.image.x <= enemy.left) {
        enemy.image.x = enemy.left;
        enemy.direction = 1;
      }
      enemy.image.setFlipX(enemy.direction < 0);

      const enemyBox = new Phaser.Geom.Rectangle(enemy.image.x - 12, enemy.image.y - 12, 24, 24);
      if (Phaser.Geom.Intersects.RectangleToRectangle(playerBox, enemyBox)) {
        this.respawn(true);
        return true;
      }
    }
    return false;
  }

  private activateYom() {
    if (this.yomActive || !this.chaserButtonPosition) return;

    this.yomActive = true;
    this.chaserButtonSprite?.setTint(0x858585);
    this.yomSprite = this.add
      .image(this.chaserButtonPosition.x - 112, this.chaserButtonPosition.y, "yom")
      .setDisplaySize(46, 46)
      .setDepth(4);
    this.playTone(130, 0.2, 0.28, "sawtooth", 45);
  }

  private updateYom(delta: number, playerBox: Phaser.Geom.Rectangle): boolean {
    const yom = this.yomSprite;
    if (!this.yomActive || !yom) return false;

    if (this.goalBox && Phaser.Geom.Intersects.RectangleToRectangle(playerBox, this.goalBox)) {
      this.yomActive = false;
      yom.destroy();
      this.yomSprite = null;
      return false;
    }

    const dx = this.player.x - yom.x;
    const dy = this.player.y - yom.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      const step = Math.min(170 * (delta / 1000), distance);
      yom.x += (dx / distance) * step;
      yom.y += (dy / distance) * step;
    }

    const yomBox = new Phaser.Geom.Rectangle(yom.x - 16, yom.y - 16, 32, 32);
    if (Phaser.Geom.Intersects.RectangleToRectangle(playerBox, yomBox)) {
      this.respawn(true);
      return true;
    }
    return false;
  }

  create() {
    this.makeTextures();
    this.won = false;
    this.spikeBoxes = [];
    this.timedSpikes = [];
    this.crumblePlatforms = [];
    this.patrolEnemies = [];
    this.goalBox = null;
    this.checkpointBox = null;
    this.checkpointPosition = null;
    this.checkpointSprite = null;
    this.checkpointActive = false;
    this.chaserButtonBox = null;
    this.chaserButtonPosition = null;
    this.chaserButtonSprite = null;
    this.yomSprite = null;
    this.yomActive = false;
    this.lightingOverlay = null;
    this.fakeOutImage = null;
    this.keyBox = null;
    this.keySprite = null;
    this.lockedDoorTiles = [];
    this.hasKey = false;
    this.lastGrounded = -1e9;
    this.lastJumpPress = -1e9;
    this.jumpsUsed = 0;
    this.touchLeft = false;
    this.touchRight = false;
    this.touchJumpHeld = false;
    this.touchJumpPressed = false;
    this.touchControlsCreated = false;
    this.touchControlObjects = [];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.finishCheckpointJumpscare());

    this.input.once("pointerdown", () => this.startAudio());
    this.input.keyboard!.once("keydown", () => this.startAudio());

    const rows = LEVELS[this.levelIndex];
    this.requiresKey = rows.some((row) => row.includes("D"));
    const worldW = Math.max(...rows.map((r) => r.length)) * TILE;
    const worldH = rows.length * TILE;
    this.drawBackground(worldW, worldH);
    this.cameras.main.setBackgroundColor("#172942");
    this.physics.world.setBounds(0, 0, worldW, worldH);

    const solids = this.physics.add.staticGroup();

    rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        const x = c * TILE;
        const y = r * TILE;
        if (ch === "#" || ch === "X") {
          const above = rows[r - 1]?.[c];
          const texture = ch === "X" ? "crumble" : above === "#" ? "block" : "blockTop";
          const tile = solids.create(x + TILE / 2, y + TILE / 2, texture);
          if (ch === "X") this.crumblePlatforms.push({ tile, triggeredAt: null });
        } else if (ch === "D") {
          this.lockedDoorTiles.push(solids.create(x + TILE / 2, y + TILE / 2, "lockedDoor"));
        } else if (ch === "K") {
          this.keySprite = this.add.image(x + TILE / 2, y + TILE / 2, "key");
          this.keyBox = new Phaser.Geom.Rectangle(x + 4, y + 4, TILE - 8, TILE - 8);
        } else if (ch === "T") {
          const image = this.add
            .image(x + TILE / 2, y + TILE / 2, "spike")
            .setAlpha(0.25)
            .setTint(0x9caebb);
          const [bx, by, bw, bh] = SPIKES["^"].box;
          this.timedSpikes.push({
            box: new Phaser.Geom.Rectangle(x + bx, y + by, bw, bh),
            image,
            phaseOffset: this.timedSpikes.length * 850,
            active: false,
          });
        } else if (SPIKES[ch]) {
          const sp = SPIKES[ch];
          this.add.image(x + TILE / 2, y + TILE / 2, "spike").setAngle(sp.angle);
          const [bx, by, bw, bh] = sp.box;
          this.spikeBoxes.push(new Phaser.Geom.Rectangle(x + bx, y + by, bw, bh));
        } else if (ch === "P") {
          this.spawn.set(x + TILE / 2, y + TILE - 14);
        } else if (ch === "C") {
          this.checkpointSprite = this.add.image(x + TILE / 2, y + TILE / 2, "checkpoint");
          this.checkpointPosition = new Phaser.Math.Vector2(x + TILE / 2, y + TILE - 14);
          this.checkpointBox = new Phaser.Geom.Rectangle(x + 4, y + 4, TILE - 8, TILE - 8);
        } else if (ch === "B") {
          this.chaserButtonSprite = this.add
            .image(x + TILE / 2, y + TILE / 2, "chaserButton")
            .setDepth(4);
          this.chaserButtonPosition = new Phaser.Math.Vector2(x + TILE / 2, y + TILE / 2);
          this.chaserButtonBox = new Phaser.Geom.Rectangle(x + 8, y + 8, TILE - 16, TILE - 16);
          this.add
            .text(x + TILE / 2, y - 2, "TOUCH", {
              fontFamily: "monospace",
              fontSize: "8px",
              color: "#ffb2a8",
              backgroundColor: "#10151c",
            })
            .setOrigin(0.5)
            .setDepth(4);
        } else if (ch === "G") {
          this.add.image(x + TILE / 2, y + TILE / 2, "goal");
          this.goalBox = new Phaser.Geom.Rectangle(x + 4, y + 2, 24, 28);
        }
      });
    });

    if (this.levelIndex === 0) {
      this.addPatrolEnemy(12 * TILE, 8 * TILE - 12, 10 * TILE + 16, 14 * TILE + 16, 90);
    } else if (this.levelIndex === 1) {
      this.addPatrolEnemy(19 * TILE, 11 * TILE - 12, 16 * TILE + 16, 23 * TILE + 16, 110);
    } else if (this.levelIndex === 2) {
      this.addPatrolEnemy(9 * TILE, 15 * TILE - 12, 8 * TILE + 16, 10 * TILE + 16, 105);
    } else if (this.levelIndex === 3) {
      this.addPatrolEnemy(8 * TILE, 15 * TILE - 12, 7 * TILE + 16, 10 * TILE + 16, 125);
      this.addPatrolEnemy(17 * TILE, 15 * TILE - 12, 16 * TILE + 16, 20 * TILE + 16, 140);
    } else {
      this.addPatrolEnemy(11 * TILE, 14 * TILE - 12, 9 * TILE + 16, 13 * TILE + 16, 120);
      this.addPatrolEnemy(16 * TILE, 14 * TILE - 12, 14 * TILE + 16, 18 * TILE + 16, 145);
    }

    this.player = this.physics.add.sprite(this.spawn.x, this.spawn.y, "player");
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, solids);
    this.lightingOverlay = this.add
      .rectangle(400, 288, 800, 576, 0x000000, 0)
      .setScrollFactor(0)
      .setDepth(8);
    this.fakeOutImage = this.add
      .image(400, 288, "fakeOut")
      .setDisplaySize(800, 436)
      .setScrollFactor(0)
      .setDepth(30)
      .setVisible(false)
      .setAlpha(0);
    this.scheduleLightingFlicker();
    this.scheduleFakeOut();

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys({ w: "W", a: "A", d: "D", r: "R", space: "SPACE" }) as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.keys.m = kb.addKey("M");

    this.add
      .rectangle(400, 24, 780, 42, 0x102031, 0.82)
      .setDepth(9)
      .setStrokeStyle(2, 0x78bcd8, 0.9);
    this.add
      .rectangle(400, 24, 760, 24, 0x1a3a51, 0.35)
      .setDepth(9);

    this.hud = this.add
      .text(16, 10, "", { fontFamily: "monospace", fontSize: "14px", color: "#ffffff" })
      .setDepth(10);
    this.updateHud();
    this.scale.off("resize", this.createTouchControls, this);
    this.scale.on("resize", this.createTouchControls, this);
    window.removeEventListener("resize", this.handleViewportResize);
    window.addEventListener("resize", this.handleViewportResize);
    this.createTouchControls();
  }

  private createTouchControls() {
    const hasTouch =
      window.matchMedia("(pointer: coarse)").matches ||
      window.innerWidth <= 900 ||
      this.sys.game.canvas.clientWidth <= 900;
    if (!hasTouch) {
      this.removeTouchControls();
      return;
    }
    if (this.touchControlsCreated) return;
    this.touchControlsCreated = true;

    const makeButton = (
      x: number,
      y: number,
      radius: number,
      label: string,
      onPress: () => void,
      onRelease: () => void = () => {},
    ) => {
      const button = this.add
        .circle(x, y, radius, 0x102031, 0.72)
        .setScrollFactor(0)
        .setDepth(20)
        .setStrokeStyle(2, 0x9bdcf2, 0.9)
        .setInteractive();
      const labelObject = this.add
        .text(x, y, label, {
          fontFamily: "monospace",
          fontSize: radius > 34 ? "18px" : "13px",
          color: "#ffffff",
          align: "center",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(21);
      this.touchControlObjects.push(button, labelObject);

      button.on("pointerdown", () => {
        this.startAudio();
        button.setFillStyle(0x247ba0, 0.9);
        onPress();
      });
      const release = () => {
        button.setFillStyle(0x102031, 0.72);
        onRelease();
      };
      button.on("pointerup", release);
      button.on("pointerupoutside", release);
    };

    makeButton(72, 496, 38, "<", () => (this.touchLeft = true), () => (this.touchLeft = false));
    makeButton(164, 496, 38, ">", () => (this.touchRight = true), () => (this.touchRight = false));
    makeButton(716, 496, 46, "JUMP", () => {
      this.touchJumpHeld = true;
      this.touchJumpPressed = true;
    }, () => (this.touchJumpHeld = false));
    makeButton(612, 496, 30, "RESET", () => {
      if (this.won) this.scene.restart({ level: 0, deaths: 0 });
      else this.respawn(false);
    });
    makeButton(756, 38, 22, "M", () => this.toggleMute());
  }

  private removeTouchControls() {
    this.touchControlObjects.forEach((control) => control.destroy());
    this.touchControlObjects = [];
    this.touchControlsCreated = false;
    this.touchLeft = false;
    this.touchRight = false;
    this.touchJumpHeld = false;
    this.touchJumpPressed = false;
  }

  private updateHud() {
    const keyStatus = this.requiresKey ? `   Key: ${this.hasKey ? "YES" : "NO"}` : "";
    this.hud.setText(
      `Level ${this.levelIndex + 1}/${LEVELS.length}   Deaths: ${this.deaths}   Checkpoint: ${this.checkpointActive ? "ON" : "--"}${keyStatus}   R = reset   M = ${this.muted ? "sound off" : "mute"}`,
    );
  }

  private respawn(countDeath: boolean) {
    this.playDeathSound();
    if (countDeath) {
      this.deaths++;
      this.updateHud();
      this.cameras.main.shake(100, 0.01);
    }
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.reset(this.spawn.x, this.spawn.y - 4);
    this.jumpsUsed = 0;
    this.lastGrounded = -1e9;
    this.lastJumpPress = -1e9;
  }

  update(time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.m)) {
      this.toggleMute();
    }

    if (this.jumpscareActive) return;

    if (this.won) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.r)) this.scene.restart({ level: 0, deaths: 0 });
      return;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Horizontal movement
    const left = this.cursors.left.isDown || this.keys.a.isDown || this.touchLeft;
    const right = this.cursors.right.isDown || this.keys.d.isDown || this.touchRight;
    if (left) this.player.setVelocityX(-SPEED);
    else if (right) this.player.setVelocityX(SPEED);
    else this.player.setVelocityX(0);

    // Jump: coyote time + jump buffering + variable height
    const jumpHeld =
      this.cursors.up.isDown || this.keys.w.isDown || this.keys.space.isDown || this.touchJumpHeld;
    const jumpPressed =
      this.touchJumpPressed ||
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.keys.w) ||
      Phaser.Input.Keyboard.JustDown(this.keys.space);
    this.touchJumpPressed = false;

    if (body.blocked.down) {
      this.lastGrounded = time;
      this.jumpsUsed = 0;
    }
    if (jumpPressed) this.lastJumpPress = time;

    const canGroundJump = this.jumpsUsed === 0 && time - this.lastGrounded <= COYOTE_MS;
    const canDoubleJump = this.jumpsUsed === 1;
    if (
      time - this.lastJumpPress <= BUFFER_MS &&
      (canGroundJump || canDoubleJump)
    ) {
      this.player.setVelocityY(-JUMP);
      this.jumpsUsed++;
      this.lastJumpPress = -1e9;
      this.lastGrounded = -1e9;
    }
    // Release jump early = fall faster = shorter jump
    body.setGravityY(!jumpHeld && body.velocity.y < 0 ? 1500 : 0);

    // Manual respawn
    if (Phaser.Input.Keyboard.JustDown(this.keys.r)) this.respawn(false);

    // Spikes
    const playerBox = new Phaser.Geom.Rectangle(body.x, body.y, body.width, body.height);
    if (this.updateTimedSpikes(time, playerBox)) return;

    for (const box of this.spikeBoxes) {
      if (Phaser.Geom.Intersects.RectangleToRectangle(playerBox, box)) {
        this.respawn(true);
        return;
      }
    }

    if (this.updatePatrolEnemies(delta, playerBox)) return;
    if (this.chaserButtonBox && !this.yomActive &&
      Phaser.Geom.Intersects.RectangleToRectangle(playerBox, this.chaserButtonBox)) {
      this.activateYom();
    }
    if (this.updateYom(delta, playerBox)) return;
    this.updateCrumblePlatforms(time, body);

    if (
      !this.checkpointActive &&
      this.checkpointBox &&
      this.checkpointPosition &&
      Phaser.Geom.Intersects.RectangleToRectangle(playerBox, this.checkpointBox)
    ) {
      this.checkpointActive = true;
      this.spawn.copy(this.checkpointPosition);
      this.checkpointSprite?.setTint(0x72ffb5);
      this.updateHud();
      this.playCheckpointJumpscare();
    }

    if (
      this.keyBox &&
      Phaser.Geom.Intersects.RectangleToRectangle(playerBox, this.keyBox)
    ) {
      this.hasKey = true;
      this.keyBox = null;
      this.keySprite?.destroy();
      this.keySprite = null;
      this.lockedDoorTiles.forEach((tile) => tile.destroy());
      this.lockedDoorTiles = [];
      this.playTone(880, 0.18, 0.3, "sine");
      this.updateHud();
    }

    // Goal
    if (
      this.goalBox &&
      (!this.requiresKey || this.hasKey) &&
      Phaser.Geom.Intersects.RectangleToRectangle(playerBox, this.goalBox)
    ) {
      if (this.levelIndex + 1 < LEVELS.length) {
        this.scene.restart({ level: this.levelIndex + 1, deaths: this.deaths });
      } else {
        this.won = true;
        this.playWinSound();
        this.player.setVelocity(0, 0);
        this.add
          .text(400, 288, `YOU WIN!\nDeaths: ${this.deaths}\nPress R to play again`, {
            fontFamily: "monospace",
            fontSize: "32px",
            color: "#ffffff",
            align: "center",
          })
          .setOrigin(0.5)
          .setDepth(20);
      }
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 800,
  height: 576,
  physics: { default: "arcade", arcade: { gravity: { x: 0, y: 1000 }, debug: false } },
  input: { activePointers: 3 },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: GameScene,
});