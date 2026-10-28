/** Keyboard + mouse state, with per-frame "just pressed" tracking. */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  /** Primary action: left click while the pointer is locked. */
  clicked = false;
  rightClicked = false;
  /** Left mouse button is held down (for automatic fire). */
  mouseHeld = false;

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseHeld = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    element.addEventListener('mousedown', (e) => {
      if (!this.locked) {
        this.lock();
        return;
      }
      if (e.button === 0) {
        this.clicked = true;
        this.mouseHeld = true;
      }
      if (e.button === 2) this.rightClicked = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseHeld = false;
    });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked() {
    return document.pointerLockElement === this.element;
  }

  lock() {
    this.element.requestPointerLock()?.catch?.(() => {});
  }

  isDown(...codes: string[]) {
    return codes.some((c) => this.down.has(c));
  }

  pressed(...codes: string[]) {
    return codes.some((c) => this.pressedThisFrame.has(c));
  }

  /** Space or left click. */
  get action() {
    return this.pressed('Space', 'Enter') || this.clicked;
  }

  get cancel() {
    return this.pressed('Escape', 'KeyX', 'Backspace') || this.rightClicked;
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.clicked = false;
    this.rightClicked = false;
  }
}
