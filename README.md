# AR4 Studio

Interactive browser simulator for the Annin Robotics AR4 MK5. The UI provides orbit/zoom controls, individual J1–J6 joint controls, animated saved poses, and live tool-center-point coordinates.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production build

```bash
npm run build
npm start
```

The robot frames, joint axes, and mesh offsets follow the official `annin_ar4_description` ROS 2 package.

## Simulator command API

The browser exposes an asynchronous command entry point for integrations. A transport such as WebSocket or serial can call the same API later without changing the motion engine.

```js
await window.ar4Simulator.executeCommand({ cmd: 'hello' });

await window.ar4Simulator.executeCommand({ cmd: 'get_position' });

await window.ar4Simulator.executeCommand({
  cmd: 'move_joints',
  j: [0, 0, 0, 0, 90, 0, 0, 0, 0],
  spd_type: 'percent',
  spd: 15,
  acc: 10,
  dec: 10,
  ramp: 50,
});

await window.ar4Simulator.executeCommand({
  cmd: 'move_j',
  pose: [315, 0, 450, 0, 135, 0],
  spd_type: 'percent',
  spd: 15,
  acc: 10,
  dec: 10,
  w: 'A',
});

await window.ar4Simulator.executeCommand({
  cmd: 'move_l',
  pose: [315, 0, 450, 0, 135, 0],
  ext: [0, 0, 0],
  spd_type: 'percent',
  spd: 12,
  acc: 10,
  dec: 10,
  rounding: 0,
  w: 'A',
});
```

The entry point accepts either an object or a JSON string. `hello` identifies the simulator. `get_position` returns J1–J9 in `j` and `[X, Y, Z, Theta_x, Theta_y, Theta_z]` in `pose`. `move_j` solves the Cartesian target and then performs a synchronized joint move. `move_l` plans one-unit Cartesian waypoints, solves each point continuously, and synchronizes J7–J9 with the path. `w` supports the Teensy wrist modes `F`, `N`, and `A`. `ramp` is optional: joint moves default to `10`, while `move_l` defaults to the firmware value `80`. Linear rounding above zero requires command-queue lookahead and is rejected until queued blending is implemented. `calibrate` is intentionally unavailable because it is a physical limit-switch homing operation. The returned promise resolves with a command response after the simulated movement finishes, or an `error` response if the command is invalid.

## Model assets

AR4 MK5 mesh assets are sourced from the official Annin Robotics AR4 ROS Driver:

https://github.com/Annin-Robotics/ar4_ros_driver/tree/main/annin_ar4_description/meshes/ar4_mk5

See `THIRD_PARTY_NOTICES.md` for attribution.
