# Boar Lanes — 3D bowling

Third-person bowling game built with Three.js (rendering) and cannon-es (physics).

```sh
npm install
npm run dev
```

## How to play

1. Walk (WASD, mouse to look, Shift to run) to the ball rack and press **E** to pick up a ball.
   Balls differ in weight and coverstock: heavier reactive balls hook more.
2. Walk onto the approach of **lane 3** and press **Space** to step up.
3. Line up: **A/D** moves you across the boards, **W/S** steps forward/back,
   **Q/E** or the mouse adjusts the angle. The footprint shows where your slide ends;
   red means you'll cross the foul line.
4. **Space** starts the power bar, **Space** locks it (above 90% costs accuracy).
5. The spin bar then swings left/right (faster on harder throws). **Space** locks it.
6. The ball returns to the rack after each shot; go fetch it again.

Standard ten-pin rules for one player: strikes, spares, splits, fouls and the tenth-frame bonus balls.

## Saboteurs

The point of the game is ruining the bowler. Saboteurs grab weapons from the **armory** (far right of the hall)
and go after the bowler, hardest while they are lining up or throwing. Gunners and cheese throwers also go for
the rolling ball.

| Key | Spawns |
| --- | --- |
| `1` | **Bullen**: big, slow, hard to knock back |
| `2` | **Lillen**: short and fast |
| `3` | **Jimpan**: tall, skinny, long straight hair |
| `4` | Tombstone rising through the lane |
| `5` | Giant spider dropping onto the lane |
| `0` | Clear everyone and all hazards |

Anyone can use the weapons, including you (**E** to grab or hang back, **click/F** to use, **G** to drop):

- **AK-47**: full auto; bullets knock the bowler around, nudge the rolling ball and topple pins.
- **Baseball bat**: knocks the bowler clean out of their stance.
- **Cheese wedge**: thrown; splats the screen and stays on the lane as an obstacle until the pinsetter sweeps.
- **Confetti cannon**: cone blast; blinds, pushes, and blows the ball off line.

Being hit lowers the bowler's **composure**, shakes the camera and body, makes the aim drift and the power and
spin meters jump. A hit mid-approach ruins the throw. Armed saboteurs standing close make the bowler tremble even
without hitting.

## Multiplayer architecture

The game is single-player for now but is structured so other people can join later:

- Every character is an `Actor` (`src/actors/actor.ts`) with a role: `bowler` or `saboteur`.
- Actors are driven by a `Controller` that produces a plain, serializable `Intent` each tick
  (`src/actors/intent.ts`): `LocalController` (keyboard and mouse), `SaboteurAI`, and `RemoteController`,
  a stub that applies intents received from a network transport.
- The `Arena` (`src/actors/arena.ts`) is the authoritative simulation. It applies intents, moves actors,
  resolves weapon hits and emits typed `GameEvent`s, which the HUD, feed and effects listen to. In a networked
  game it would run on the host and its events would be replicated.

## Code layout

- `src/game.ts`: bowling state machine (free roam → aim → power → spin → throw → roll → settle → pinsetter) and how bowler hits affect the shot
- `src/scoring.ts`: scorecard and pinsetter decisions
- `src/actors/`: actors, controllers (local, AI, remote), arena, events
- `src/characters/`: parameterized humanoid model and animations; archetypes (bowler, Bullen, Lillen, Jimpan)
- `src/weapons/`: weapon specs, models, the armory stand, hit resolution, cheese projectiles
- `src/fx/`: particles, tracers, muzzle flash; synthesized sound effects
- `src/world/ball.ts`: ball specs and the oil/dry lane hook model
- `src/world/pins.ts`: pin geometry, physics bodies and pinsetter animation
- `src/world/hazards.ts`: lane hazards (tombstone, spider)
- `src/world/hall.ts`: lanes, gutters, pit, rack, lighting, static colliders

## Deployment

`main.go` is a small Go server that embeds the Vite build (`dist/`) and serves it on `:8080` (`ADDR` overrides), with `/healthz` for probes. Hashed files under `/assets/` are cached forever, `index.html` is always revalidated.

```sh
npm run build && go run .   # serves the production build on :8080
```

The game is deployed to the [`segel-cluster`](https://github.com/segelfartyg/SegelCluster) Kubernetes cluster with Flux:

- **CI** (`.github/workflows/docker.yml`): every push to `main` builds the `Dockerfile` (Vite build → Go binary → Alpine) and pushes `segelfartyg/boar:latest` to Docker Hub. Needs the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets.
- **Chart** (`chart/`): one `Deployment` and a `Service` on port 8080. No volumes, secrets or external dependencies.
- **SegelCluster side**: a `GitRepository` + `HelmRelease` pulling `chart/` from `main` (`reconcileStrategy: Revision`), and an `HTTPRoute` for `boar.swaren.se`.

To ship a change, `git push` to `main`.
