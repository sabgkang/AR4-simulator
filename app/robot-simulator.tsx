'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

type Pose = [number, number, number, number, number, number];

const JOINTS = [
  { name: 'J1', label: 'Base', min: -160, max: 160, accent: '#2563eb' },
  { name: 'J2', label: 'Shoulder', min: -42, max: 90, accent: '#7c3aed' },
  { name: 'J3', label: 'Elbow', min: -89, max: 52, accent: '#0891b2' },
  { name: 'J4', label: 'Wrist roll', min: -180, max: 180, accent: '#059669' },
  { name: 'J5', label: 'Wrist bend', min: -105, max: 105, accent: '#d97706' },
  { name: 'J6', label: 'Tool roll', min: -180, max: 180, accent: '#dc2626' },
] as const;

const PRESETS: Record<string, Pose> = {
  Home: [0, -42, 52, 0, 48, 0],
  Upright: [0, 0, 0, 0, 0, 0],
  Inspect: [-38, -28, 50, 42, 64, -24],
};

const MESH_ROOT = '/meshes/ar4_mk5/';
const LINK_MESHES = [
  ['Link_1_Aluminum.STL', 'Link_1_Motor.STL'],
  ['Link_2_Aluminum.STL', 'Link_2_Motor.STL', 'Link_2_Cover.STL', 'Link_2_Logo.STL'],
  ['Link_3_Aluminum.STL', 'Link_3_Motor.STL'],
  ['Link_4_Aluminum.STL', 'Link_4_Motor.STL', 'Link_4_Cover.STL', 'Link_4_Logo.STL'],
  ['Link_5_Aluminum.STL', 'Link_5_Motor.STL'],
  ['Link_6_Aluminum.STL'],
];

const LINK_MESH_TRANSFORMS = [
  { xyz: [0, 0, 0], rpy: [0, 0, 0] },
  { xyz: [0, 0, -0.00887], rpy: [Math.PI, 0, 0] },
  { xyz: [0, 0, -0.03671], rpy: [0, 0, 0] },
  { xyz: [0, 0, -0.07594], rpy: [0, 0, -Math.PI / 2] },
  { xyz: [0, 0, -0.0275], rpy: [0, 0, 0] },
  { xyz: [0, 0, -0.016], rpy: [0, 0, 0] },
] as const;

const JOINT_FRAMES = [
  { xyz: [0, 0, 0.092], rpy: [Math.PI, 0, 0], axis: [0, 0, 1] },
  { xyz: [0, 0.06415, -0.07778], rpy: [Math.PI / 2, 0, -Math.PI / 2], axis: [0, 0, -1] },
  { xyz: [0, -0.305, 0], rpy: [0, 0, Math.PI], axis: [0, 0, -1] },
  { xyz: [0, 0, 0], rpy: [Math.PI / 2, 0, -Math.PI / 2], axis: [0, 0, -1] },
  { xyz: [0, 0, -0.22294], rpy: [Math.PI, 0, -Math.PI / 2], axis: [1, 0, 0] },
  { xyz: [0, 0, 0.041], rpy: [0, 0, 0], axis: [0, 0, 1] },
] as const;

function materialFor(name: string) {
  let color = 0xb8c0cc, roughness = 0.42, metalness = 0.58;
  if (name.includes('Motor')) { color = 0x20242b; roughness = 0.6; metalness = 0.25; }
  else if (name.includes('Cover')) { color = 0xf4f5f7; roughness = 0.72; metalness = 0.04; }
  else if (name.includes('Logo')) { color = 0x1746e0; roughness = 0.5; metalness = 0.08; }
  else if (name.includes('Enclosure')) { color = 0xe9edf2; roughness = 0.78; metalness = 0.03; }
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function setFrame(object: THREE.Object3D, xyz: readonly number[], rpy: readonly number[]) {
  object.position.set(xyz[0], xyz[1], xyz[2]);
  object.rotation.set(rpy[0], rpy[1], rpy[2], 'XYZ');
}

function JointAngleInput({
  name,
  value,
  min,
  max,
  onChange,
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 10) / 10));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(Math.round(value * 10) / 10));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    onChange(next);
    setDraft(String(Math.round(next * 10) / 10));
  };

  return (
    <span className="angle-input-wrap">
      <input
        className="angle-input"
        aria-label={`${name} angle in degrees`}
        type="number"
        min={min}
        max={max}
        step="0.1"
        value={draft}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          const parsed = Number(nextDraft);
          if (nextDraft !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
        }}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(Math.round(value * 10) / 10));
            event.currentTarget.blur();
          }
        }}
      />
      <small>°</small>
    </span>
  );
}

export default function RobotSimulator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const jointRotors = useRef<THREE.Group[]>([]);
  const axes = useRef<THREE.Vector3[]>([]);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationRef = useRef<number | null>(null);
  const [angles, setAngles] = useState<Pose>(PRESETS.Home);
  const [tcp, setTcp] = useState({ x: 0, y: 0, z: 0 });
  const [loaded, setLoaded] = useState(0);
  const [running, setRunning] = useState(false);

  const updateTcp = useCallback(() => {
    const end = jointRotors.current[5];
    if (!end) return;
    end.updateWorldMatrix(true, true);
    const point = end.localToWorld(new THREE.Vector3(0, 0, 0.055));
    setTcp({ x: point.x * 1000, y: point.y * 1000, z: point.z * 1000 });
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f6f9);
    scene.fog = new THREE.Fog(0xf4f6f9, 1.8, 3.4);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 20);
    camera.position.set(1.05, -1.15, 0.78);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0.31);
    controls.minDistance = 0.48;
    controls.maxDistance = 2.7;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x718096, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(-0.8, -0.9, 1.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -1; key.shadow.camera.right = 1; key.shadow.camera.top = 1; key.shadow.camera.bottom = -1;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc0ff, 1.4);
    fill.position.set(1.4, 0.4, 0.9);
    scene.add(fill);

    const grid = new THREE.GridHelper(2.4, 24, 0xc3cad5, 0xdfe4eb);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.002;
    (grid.material as THREE.Material).opacity = 0.56;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 96), new THREE.ShadowMaterial({ color: 0x627087, opacity: 0.13 }));
    floor.receiveShadow = true;
    scene.add(floor);

    const loader = new STLLoader();
    const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
    const loadMesh = (parent: THREE.Object3D, name: string, transform = { xyz: [0, 0, 0] as const, rpy: [0, 0, 0] as const }) => {
      loader.load(MESH_ROOT + name, (geometry) => {
        geometry.computeVertexNormals();
        const material = materialFor(name);
        const mesh = new THREE.Mesh(geometry, material);
        setFrame(mesh, transform.xyz, transform.rpy);
        mesh.castShadow = true; mesh.receiveShadow = true;
        parent.add(mesh);
        disposables.push(geometry, material);
        setLoaded((value) => value + 1);
      }, undefined, () => setLoaded((value) => value + 1));
    };

    loadMesh(scene, 'Link_Base_Aluminum.STL');
    loadMesh(scene, 'Link_Base_Enclosure.STL');
    loadMesh(scene, 'Link_Base_Motor.STL');

    jointRotors.current = [];
    axes.current = [];
    let parent: THREE.Object3D = scene;
    JOINT_FRAMES.forEach((frame, index) => {
      const fixedFrame = new THREE.Group();
      setFrame(fixedFrame, frame.xyz, frame.rpy);
      parent.add(fixedFrame);
      const rotor = new THREE.Group();
      fixedFrame.add(rotor);
      jointRotors.current.push(rotor);
      axes.current.push(new THREE.Vector3(frame.axis[0], frame.axis[1], frame.axis[2]));
      LINK_MESHES[index].forEach((name) => loadMesh(rotor, name, LINK_MESH_TRANSFORMS[index]));
      parent = rotor;
    });

    let resizeFrame = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    const resize = () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        const target = canvas.parentElement ?? canvas;
        const rect = target.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        if (width === lastWidth && height === lastHeight) return;
        lastWidth = width;
        lastHeight = height;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement ?? canvas);
    resize();
    let frameId = 0;
    const render = () => { controls.update(); renderer.render(scene, camera); frameId = requestAnimationFrame(render); };
    render();

    return () => {
      observer.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(frameId); controls.dispose(); renderer.dispose();
      disposables.forEach((item) => item.dispose());
    };
  }, []);

  useEffect(() => {
    jointRotors.current.forEach((rotor, index) => rotor.quaternion.setFromAxisAngle(axes.current[index], THREE.MathUtils.degToRad(angles[index])));
    updateTcp();
  }, [angles, updateTcp, loaded]);

  const setJoint = (index: number, value: number) => {
    const joint = JOINTS[index];
    const safeValue = Math.min(joint.max, Math.max(joint.min, value));
    setAngles((current) => current.map((angle, i) => i === index ? safeValue : angle) as Pose);
  };

  const moveTo = (target: Pose) => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const safeTarget = target.map((value, index) => Math.min(JOINTS[index].max, Math.max(JOINTS[index].min, value))) as Pose;
    const start = [...angles] as Pose, started = performance.now(), duration = 700;
    setRunning(true);
    const step = (now: number) => {
      const raw = Math.min((now - started) / duration, 1), eased = 1 - Math.pow(1 - raw, 3);
      setAngles(start.map((value, i) => value + (safeTarget[i] - value) * eased) as Pose);
      if (raw < 1) animationRef.current = requestAnimationFrame(step); else setRunning(false);
    };
    animationRef.current = requestAnimationFrame(step);
  };

  const resetView = () => {
    const camera = cameraRef.current, controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.set(1.05, -1.15, 0.78); controls.target.set(0, 0, 0.31); controls.update();
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">AR</div>
        <div className="brand-copy"><strong>AR4 Studio</strong><span>MK5 digital twin</span></div>
        <div className="connection"><i /> Simulation online</div>
        <div className="top-actions"><button onClick={resetView}>Reset view</button><button className="primary" onClick={() => moveTo(PRESETS.Home)}>Home pose</button></div>
      </header>

      <section className="workspace">
        <aside className="rail" aria-label="Simulator navigation">
          <button className="rail-button active" aria-label="Robot view">R</button><button className="rail-button" aria-label="Programs">P</button><button className="rail-button" aria-label="Diagnostics">D</button><span className="rail-spacer" /><button className="rail-button" aria-label="Settings">S</button>
        </aside>

        <section className="viewport-card">
          <div className="viewport-head">
            <div><span className="eyebrow">LIVE MODEL</span><h1>AR4 MK5</h1></div>
            <div className="viewport-tools"><span>{loaded < 18 ? `Loading ${Math.round((loaded / 18) * 100)}%` : 'Model ready'}</span><button onClick={resetView}>Fit</button></div>
          </div>
          <div className="canvas-wrap">
            <canvas ref={canvasRef} aria-label="Interactive 3D model of the AR4 MK5 robot" />
            <div className="orbit-hint">Drag to orbit · Scroll to zoom</div><div className="axis-widget"><b>Z</b><span>Y</span><i>X</i></div>
          </div>
          <div className="telemetry-strip">
            <div><span>X</span><strong>{tcp.x.toFixed(1)}</strong><small>mm</small></div><div><span>Y</span><strong>{tcp.y.toFixed(1)}</strong><small>mm</small></div><div><span>Z</span><strong>{tcp.z.toFixed(1)}</strong><small>mm</small></div><div className="status-cell"><i /><strong>{running ? 'Moving' : 'Holding'}</strong></div>
          </div>
        </section>

        <aside className="control-panel">
          <div className="panel-heading"><div><span className="eyebrow">MANUAL CONTROL</span><h2>Joint positions</h2></div><button className="zero-button" onClick={() => moveTo(PRESETS.Upright)}>Zero all</button></div>
          <div className="joint-list">
            {JOINTS.map((joint, index) => {
              const progress = ((angles[index] - joint.min) / (joint.max - joint.min)) * 100;
              return <div className="joint-control" key={joint.name}>
                <div className="joint-label"><span className="joint-id" style={{ background: joint.accent }}>{joint.name}</span><span><strong>{joint.label}</strong><small>{joint.min}° to {joint.max}°</small></span><JointAngleInput name={joint.name} value={angles[index]} min={joint.min} max={joint.max} onChange={(value) => setJoint(index, value)} /></div>
                <input aria-label={`${joint.name} ${joint.label}`} type="range" min={joint.min} max={joint.max} step="1" value={angles[index]} onChange={(event) => setJoint(index, Number(event.target.value))} style={{ '--range': `${progress}%`, '--accent': joint.accent } as React.CSSProperties} />
              </div>;
            })}
          </div>
          <div className="preset-section"><div className="section-label"><span>Saved poses</span><small>Click to move</small></div><div className="preset-grid">
            {Object.entries(PRESETS).map(([name, pose]) => <button key={name} onClick={() => moveTo(pose)}><span className={`pose-icon pose-${name.toLowerCase()}`} /><strong>{name}</strong><small>{pose.slice(0, 3).join(' · ')}°</small></button>)}
          </div></div>
        </aside>
      </section>
    </main>
  );
}
