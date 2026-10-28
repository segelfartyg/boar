import type { WeaponId } from '../weapons/specs';

/** Everything that happens in the arena that others may want to react to (UI, audio, network replication). */
export type GameEvent =
  | { type: 'spawn'; actorId: string }
  | { type: 'despawn'; actorId: string }
  | { type: 'pickup'; actorId: string; weapon: WeaponId }
  | { type: 'drop'; actorId: string; weapon: WeaponId }
  | { type: 'hit'; attackerId: string | null; targetId: string; weapon: WeaponId | 'hazard'; damage: number; disrupt: number }
  | { type: 'knockout'; actorId: string; byId: string | null }
  | { type: 'ballHit'; attackerId: string; weapon: WeaponId }
  | { type: 'hazard'; kind: string };

type Handler = (e: GameEvent) => void;

export class EventBus {
  private handlers: Handler[] = [];

  on(h: Handler) {
    this.handlers.push(h);
  }

  emit(e: GameEvent) {
    for (const h of this.handlers) h(e);
  }
}
