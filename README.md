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

## Model assets

AR4 MK5 mesh assets are sourced from the official Annin Robotics AR4 ROS Driver:

https://github.com/Annin-Robotics/ar4_ros_driver/tree/main/annin_ar4_description/meshes/ar4_mk5

See `THIRD_PARTY_NOTICES.md` for attribution.
