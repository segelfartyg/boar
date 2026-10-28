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

## Code layout

- `src/game.ts` — state machine (free roam → aim → power → spin → throw → roll → settle → pinsetter)
- `src/scoring.ts` — scorecard and pinsetter decisions
- `src/world/ball.ts` — ball specs and the oil/dry lane hook model
- `src/world/pins.ts` — pin geometry, physics bodies and pinsetter animation
- `src/world/hall.ts` — lanes, gutters, pit, rack, lighting, static colliders
- `src/player.ts` — procedural bowler model and animations

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
