# AR4 Studio — Single HTML Version

AR4 Studio is a portable browser simulator for the Annin Robotics AR4 MK5. The complete application is contained in [`index.html`](./index.html).

## Open the app

1. Copy or download `index.html`.
2. Open it in a current desktop browser such as Chrome, Edge, or Firefox.

No installation, package manager, build step, local service, or internet connection is required.

## Features

- Orbit, pan, and zoom around the 3D workspace.
- Control joints J1–J6 individually.
- Save, load, and animate robot poses.
- Display live tool-center-point coordinates.
- Import STL and STEP models into the workspace.
- Save and restore complete scenes as JSON files.
- Detect collisions with the ground and imported objects.
- Run joint, Cartesian, and linear-motion commands.

Imported models are included in exported scene files, so a saved scene remains portable with the standalone app.

## Browser notes

The simulator works when `index.html` is opened directly from the local filesystem. Optional serial-device access depends on browser support and may require Chrome or Edge running the page from a secure website or local web address. All offline simulation features remain available without serial access.

## Command interface

Browser integrations can send commands through `window.ar4Simulator.executeCommand()`:

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
```

The entry point accepts either an object or a JSON string and returns a promise. Supported motion commands include `move_joints`, `move_j`, and `move_l`. Position responses include J1–J9 joint values and the Cartesian pose `[X, Y, Z, Theta_x, Theta_y, Theta_z]`.

## Collision detection

Motion commands, plans, inverse kinematics, and manual joint changes are checked against the ground plane and visible imported models. A blocked movement reports the robot link and obstacle involved. Collision detection and collision-box display can be controlled independently in the viewport.

## Model attribution

AR4 MK5 mesh data is sourced from the official [Annin Robotics AR4 ROS Driver](https://github.com/Annin-Robotics/ar4_ros_driver/tree/main/annin_ar4_description/meshes/ar4_mk5).

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for attribution and license information.
