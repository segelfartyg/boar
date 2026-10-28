import * as CANNON from 'cannon-es';

export const materials = {
  lane: new CANNON.Material('lane'),
  ball: new CANNON.Material('ball'),
  pin: new CANNON.Material('pin'),
  wall: new CANNON.Material('wall'),
};

export function createWorld(): CANNON.World {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  (world.solver as CANNON.GSSolver).iterations = 14;
  world.defaultContactMaterial.friction = 0.2;

  const { lane, ball, pin, wall } = materials;
  const contact = (a: CANNON.Material, b: CANNON.Material, friction: number, restitution: number) =>
    world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));

  // The ball's motion along the lane (skid, hook, roll) is driven by the
  // game's own lane model, so lane friction on the ball is essentially zero.
  contact(ball, lane, 0.0, 0.05);
  contact(ball, pin, 0.06, 0.55);
  contact(ball, wall, 0.05, 0.3);
  contact(pin, lane, 0.28, 0.25);
  contact(pin, pin, 0.18, 0.5);
  contact(pin, wall, 0.2, 0.55);
  return world;
}
