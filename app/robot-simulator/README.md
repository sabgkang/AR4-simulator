# Robot simulator modules

`robot-simulator.tsx` remains the feature coordinator. It owns cross-cutting state,
motion sequencing, inverse kinematics orchestration, and the public browser command
API. Supporting modules are grouped by responsibility:

- `config.ts`: robot geometry, joint limits, mesh names, and preset poses.
- `types.ts`: shared simulator, plan, motion-command, and UI types.
- `kinematics.ts`: reusable Three.js frame and numeric helpers.
- `use-robot-scene.ts`: Three.js scene creation, STL loading, target markers, and cleanup.
- `plan.ts`: plan chaining, validation, and serialization.
- `settings-file.ts`: versioned settings validation, serialization, and filenames.
- `control-panels.tsx`: joint-angle and Cartesian controls.
- `plan-dialogs.tsx`: target and command editors.
- `settings-modal.tsx`: serial, joint-range, and motor settings UI.
- `icons.tsx` and `joint-angle-input.tsx`: small reusable presentation components.

Keep domain rules in pure `.ts` modules where possible. Components should receive
state and callbacks through props, while the coordinator remains responsible for
operations spanning the scene, motion engine, and plan execution.
