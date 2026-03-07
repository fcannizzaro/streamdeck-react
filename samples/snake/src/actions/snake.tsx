import { useState, useRef, useCallback } from "react";
import {
  defineAction,
  useTouchBar,
  useTouchBarTap,
  useTouchBarDialRotate,
  useTouchBarDialDown,
  useTick,
} from "@fcannizzaro/streamdeck-react";

// ── Snake Game for Stream Deck+ Touch Strip ─────────────────────────
// 800×100 pixel touch strip rendered as an 80×10 grid (10px cells).
//
// Dial 0 (column 0): Steer — CW = turn right, CCW = turn left
// Dial 1 (column 1): Speed — CW = faster, CCW = slower
// Dial 2 (column 2): Pause / Resume (press)
// Dial 3 (column 3): Restart (press)
// Touch tap: Steer toward the tapped position

// ── Constants ───────────────────────────────────────────────────────

const CELL = 10;
const COLS = 80; // 800 / 10
const ROWS = 10; // 100 / 10

const BG_COLOR = "#1a1a2e";
const HEAD_COLOR = "#00ff88";
const BODY_COLOR = "#00aa55";
const FOOD_COLOR = "#ff3366";
const TEXT_COLOR = "#ffffff";

const MIN_SPEED = 80; // fastest (ms per move)
const MAX_SPEED = 500; // slowest
const DEFAULT_SPEED = 200;
const SPEED_STEP = 20; // per dial tick

const INITIAL_LENGTH = 3;

const DIAL_HINTS = [
  { label: "STEER", desc: "Rotate" },
  { label: "SPEED", desc: "Rotate" },
  { label: "START", desc: "Press" },
  { label: "RESTART", desc: "Press" },
] as const;

const DIAL_HINTS_PAUSED = [
  { label: "STEER", desc: "Rotate" },
  { label: "SPEED", desc: "Rotate" },
  { label: "RESUME", desc: "Press" },
  { label: "RESTART", desc: "Press" },
] as const;

// ── Types ───────────────────────────────────────────────────────────

type Point = { x: number; y: number };
type Direction = "up" | "down" | "left" | "right";
type GameState = "idle" | "playing" | "paused" | "gameover";

// ── Helpers ─────────────────────────────────────────────────────────

const TURN_ORDER: Direction[] = ["up", "right", "down", "left"];

const OPPOSITES: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

const DELTAS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function pointKey(p: Point): string {
  return `${p.x},${p.y}`;
}

function randomFood(snake: Point[]): Point {
  const occupied = new Set(snake.map(pointKey));
  let p: Point;
  do {
    p = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
    };
  } while (occupied.has(pointKey(p)));
  return p;
}

function createInitialSnake(): Point[] {
  const midX = Math.floor(COLS / 2);
  const midY = Math.floor(ROWS / 2);
  return Array.from({ length: INITIAL_LENGTH }, (_, i) => ({
    x: midX - i,
    y: midY,
  }));
}

// ── Component ───────────────────────────────────────────────────────

function SnakeTouchBar() {
  const { width, height, fps, segmentWidth } = useTouchBar();

  // ── State (render-driving) ────────────────────────────────────────
  const [snake, setSnake] = useState<Point[]>(createInitialSnake);
  const [food, setFood] = useState<Point>(() => randomFood(snake));
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<GameState>("idle");
  const [speed, setSpeed] = useState(DEFAULT_SPEED);

  // ── Refs (mutable, accessed imperatively in tick) ───────────────
  const snakeRef = useRef(snake);
  const foodRef = useRef(food);
  const scoreRef = useRef(score);
  const dirRef = useRef<Direction>("right");
  const nextDirRef = useRef<Direction>("right");
  const accumRef = useRef(0);
  const gameStateRef = useRef(gameState);

  // Keep refs in sync with state
  snakeRef.current = snake;
  foodRef.current = food;
  scoreRef.current = score;
  gameStateRef.current = gameState;

  // ── Reset ───────────────────────────────────────────────────────
  const resetGame = useCallback(() => {
    const fresh = createInitialSnake();
    const newFood = randomFood(fresh);
    snakeRef.current = fresh;
    foodRef.current = newFood;
    scoreRef.current = 0;
    dirRef.current = "right";
    nextDirRef.current = "right";
    accumRef.current = 0;
    gameStateRef.current = "idle";
    setSnake(fresh);
    setFood(newFood);
    setScore(0);
    setGameState("idle");
    setSpeed(DEFAULT_SPEED);
  }, []);

  // ── Game Loop ───────────────────────────────────────────────────
  useTick((delta) => {
    if (gameStateRef.current !== "playing") return;

    accumRef.current += delta;

    // Process one move per speed interval (while-loop for catch-up)
    let moved = false;
    while (accumRef.current >= speed) {
      accumRef.current -= speed;

      // Apply queued direction (reject 180° reversal)
      const queued = nextDirRef.current;
      if (queued !== OPPOSITES[dirRef.current]) {
        dirRef.current = queued;
      }

      const d = DELTAS[dirRef.current];
      const prev = snakeRef.current;
      const head = prev[0]!;
      const newHead: Point = {
        x: (head.x + d.x + COLS) % COLS,
        y: (head.y + d.y + ROWS) % ROWS,
      };

      // Self-collision: check against all segments except the tail
      // (the tail vacates its cell when the snake moves without eating)
      const body = prev.slice(0, -1);
      if (body.some((seg) => seg.x === newHead.x && seg.y === newHead.y)) {
        gameStateRef.current = "gameover";
        setGameState("gameover");
        return;
      }

      // Check food
      const ate =
        newHead.x === foodRef.current.x && newHead.y === foodRef.current.y;

      if (ate) {
        const grown = [newHead, ...prev];
        snakeRef.current = grown;
        scoreRef.current += 1;
        const newFood = randomFood(grown);
        foodRef.current = newFood;
      } else {
        snakeRef.current = [newHead, ...prev.slice(0, -1)];
      }

      moved = true;
    }

    // Flush to React state once per tick (single render)
    if (moved) {
      setSnake(snakeRef.current);
      setFood(foodRef.current);
      setScore(scoreRef.current);
    }
  }, fps);

  // ── Dial Rotate: Steer (col 0) / Speed (col 1) ─────────────────
  useTouchBarDialRotate(({ column, ticks }) => {
    if (column === 0) {
      // Steer: CW (ticks > 0) = turn right relative to heading
      if (gameStateRef.current !== "playing") return;
      const currentIdx = TURN_ORDER.indexOf(dirRef.current);
      const offset = ticks > 0 ? 1 : -1;
      const newDir = TURN_ORDER[(currentIdx + offset + 4) % 4]!;
      nextDirRef.current = newDir;
    } else if (column === 1) {
      // Speed: CW = faster (decrease interval), CCW = slower
      setSpeed((s) => Math.max(MIN_SPEED, Math.min(MAX_SPEED, s - ticks * SPEED_STEP)));
    }
  });

  // ── Dial Press: Pause/Start (col 2) / Restart (col 3) ───────────
  useTouchBarDialDown(({ column }) => {
    if (column === 2) {
      setGameState((gs) => {
        if (gs === "idle") return "playing";
        if (gs === "playing") return "paused";
        if (gs === "paused") return "playing";
        return gs;
      });
    } else if (column === 3) {
      resetGame();
    }
  });

  // ── Touch Tap: Steer toward tapped position ────────────────────
  useTouchBarTap(({ tapPos }) => {
    if (gameStateRef.current !== "playing") return;

    const [tapX, tapY] = tapPos;
    const head = snakeRef.current[0]!;
    const tapCol = Math.floor(tapX / CELL);
    const tapRow = Math.floor(tapY / CELL);

    const dx = tapCol - head.x;
    const dy = tapRow - head.y;

    let newDir: Direction;
    if (Math.abs(dx) >= Math.abs(dy)) {
      newDir = dx > 0 ? "right" : "left";
    } else {
      newDir = dy > 0 ? "down" : "up";
    }

    // Prevent 180° reversal
    if (newDir !== OPPOSITES[dirRef.current]) {
      nextDirRef.current = newDir;
    }
  });

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        background: BG_COLOR,
      }}
    >
      {/* Snake segments */}
      {snake.map((seg, i) => (
        <div
          key={`s-${i}`}
          style={{
            position: "absolute",
            left: seg.x * CELL,
            top: seg.y * CELL,
            width: CELL,
            height: CELL,
            background: i === 0 ? HEAD_COLOR : BODY_COLOR,
          }}
        />
      ))}

      {/* Food */}
      <div
        style={{
          position: "absolute",
          left: food.x * CELL,
          top: food.y * CELL,
          width: CELL,
          height: CELL,
          background: FOOD_COLOR,
        }}
      />

      {/* Score */}
      <div
        style={{
          position: "absolute",
          right: 8,
          top: 4,
          color: TEXT_COLOR,
          fontSize: 14,
          fontFamily: "Inter",
          opacity: 0.7,
        }}
      >
        {score}
      </div>

      {/* Dial hints overlay — shown when idle or paused */}
      {(gameState === "idle" || gameState === "paused") && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height,
            background: "rgba(0,0,0,0.6)",
          }}
        >
          {(gameState === "idle" ? DIAL_HINTS : DIAL_HINTS_PAUSED).map(
            (hint, i) => (
              <div
                key={`hint-${i}`}
                style={{
                  position: "absolute",
                  left: i * segmentWidth,
                  top: 0,
                  width: segmentWidth,
                  height,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    color: TEXT_COLOR,
                    fontSize: 18,
                    fontFamily: "Inter",
                    textAlign: "center",
                  }}
                >
                  {hint.label}
                </div>
                <div
                  style={{
                    color: TEXT_COLOR,
                    fontSize: 12,
                    fontFamily: "Inter",
                    opacity: 0.5,
                    textAlign: "center",
                    marginTop: 4,
                  }}
                >
                  {hint.desc}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {/* Game Over overlay */}
      {gameState === "gameover" && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
          }}
        >
          <div
            style={{
              background: FOOD_COLOR,
              color: TEXT_COLOR,
              fontSize: 20,
              fontFamily: "Inter",
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: 6,
            }}
          >
            GAME OVER
          </div>
          <div
            style={{
              color: TEXT_COLOR,
              fontSize: 14,
              fontFamily: "Inter",
              marginTop: 8,
              opacity: 0.7,
            }}
          >
            Score: {score}
          </div>

          {/* Arrow pointing to the Restart dial (column 3) */}
          <div
            style={{
              position: "absolute",
              left: 3 * segmentWidth,
              top: 0,
              width: segmentWidth,
              height,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                color: TEXT_COLOR,
                fontSize: 18,
                fontFamily: "Inter",
                opacity: 0.8,
              }}
            >
              RESTART
            </div>
            <div
              style={{
                color: TEXT_COLOR,
                fontSize: 30,
                fontFamily: "Inter",
                marginTop: 2,
              }}
            >
              ↓
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Action Definition ───────────────────────────────────────────────
// One action placed in all encoder slots — all share the same touchbar.

export const snakeTouchbarAction = defineAction({
  uuid: "com.example.snake.touchbar",
  touchBar: SnakeTouchBar,
  touchBarFPS: 30,
});
