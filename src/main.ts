import { Game } from './game';

const game = new Game(document.getElementById('app')!);
// Handy for poking at the game from the dev console.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
