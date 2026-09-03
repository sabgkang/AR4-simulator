'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

type Pose = [number, number, number, number, number, number];
type TcpPose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };
type IkTarget = Record<'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz', string>;
type SettingsCategory = 'com' | 'ranges' | 'motors';
type JointRange = { min: number; max: number };
type SerialPortLike = { getInfo: () => { usbVendorId?: number; usbProductId?: number } };

const JOINTS = [
  { name: 'J1', label: 'Base', min: -170, max: 170, accent: '#2563eb' },
  { name: 'J2', label: 'Shoulder', min: -42, max: 90, accent: '#7c3aed' },
  { name: 'J3', label: 'Elbow', min: -89, max: 52, accent: '#0891b2' },
  { name: 'J4', label: 'Wrist roll', min: -165, max: 165, accent: '#059669' },
  { name: 'J5', label: 'Wrist bend', min: -105, max: 105, accent: '#d97706' },
  { name: 'J6', label: 'Tool roll', min: -155, max: 155, accent: '#dc2626' },
] as const;

const DEFAULT_JOINT_RANGES: JointRange[] = JOINTS.map(({ min, max }) => ({ min, max }));
const DEFAULT_MOTOR_SPEEDS: Pose = [56.251, 45, 45, 50.224, 114.364, 112.501];

const JOINT_ZERO_OFFSETS: Pose = [Math.PI / 2, 0, 0, 0, 0, 0];

const PRESETS: Record<string, Pose> = {
  Home: [0, 0, 0, 0, 0, 0],
  Upright: [0, 0, -89, 0, 0, 0],
  Inspect: [0, 45, 20, 0, 0, 0],
};

const MESH_ROOT = '/meshes/ar4_mk5/';
const TOOL_TIP_OFFSET = 0.0;
const TOOL_TIP_MARKER_RADIUS = 0.01;
const TCP_AXIS_LENGTH = 0.05;
const TCP_AXIS_THICKNESS = 0.005;
const TCP_FRAME_ROTATION_Z = -Math.PI / 2;
const BASE_AXIS_LENGTH = 0.1;
const BASE_AXIS_THICKNESS = 0.005;
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
  { xyz: [0, 0, 0.092], rpy: [Math.PI, 0, 0], axis: [0, 0, -1] },
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
  object.rotation.set(rpy[0], rpy[1], rpy[2], 'ZYX');
}

function getTcpWorldQuaternion(end: THREE.Object3D) {
  const tcpRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), TCP_FRAME_ROTATION_Z);
  return end.getWorldQuaternion(new THREE.Quaternion()).multiply(tcpRotation);
}

function rotationVector(from: THREE.Quaternion, to: THREE.Quaternion) {
  const delta = to.clone().multiply(from.clone().invert()).normalize();
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));
  const scale = Math.sqrt(Math.max(0, 1 - delta.w * delta.w));
  if (scale < 1e-8 || angle < 1e-8) return new THREE.Vector3();
  return new THREE.Vector3(delta.x / scale, delta.y / scale, delta.z / scale).multiplyScalar(angle);
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) augmented[column][entry] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= size; entry += 1) augmented[row][entry] -= factor * augmented[column][entry];
    }
  }
  return augmented.map((row) => row[size]);
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
  const formatAngle = (angle: number) => String(Math.round(angle * 100) / 100);
  const [draft, setDraft] = useState(formatAngle(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(formatAngle(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    onChange(next);
    setDraft(formatAngle(next));
  };

  return (
    <span className="angle-input-wrap">
      <input
        className="angle-input"
        aria-label={`${name} angle in degrees`}
        type="number"
        min={min}
        max={max}
        step="0.01"
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
            setDraft(formatAngle(value));
            event.currentTarget.blur();
          }
        }}
      />
      <small>°</small>
    </span>
  );
}

function GearIcon() {
  return <span className="gear-icon" aria-hidden="true">⚙</span>;
}

export default function RobotSimulator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const jointRotors = useRef<THREE.Group[]>([]);
  const axes = useRef<THREE.Vector3[]>([]);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationRef = useRef<number | null>(null);
  const ikInitialized = useRef(false);
  const [angles, setAngles] = useState<Pose>(PRESETS.Home);
  const [tcp, setTcp] = useState<TcpPose>({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  const [ikTarget, setIkTarget] = useState<IkTarget>({ x: '', y: '', z: '', rx: '', ry: '', rz: '' });
  const [ikMessage, setIkMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('com');
  const [jointRanges, setJointRanges] = useState<JointRange[]>(() => DEFAULT_JOINT_RANGES.map((range) => ({ ...range })));
  const [motorSpeeds, setMotorSpeeds] = useState<Pose>(DEFAULT_MOTOR_SPEEDS);
  const [speedPercent, setSpeedPercent] = useState(15);
  const [accelerationPercent, setAccelerationPercent] = useState(10);
  const [decelerationPercent, setDecelerationPercent] = useState(10);
  const [serialPortName, setSerialPortName] = useState('No COM port selected');
  const [serialMessage, setSerialMessage] = useState<string | null>(null);

  const updateTcp = useCallback(() => {
    const end = jointRotors.current[5];
    if (!end) return;
    end.updateWorldMatrix(true, true);
    const point = end.localToWorld(new THREE.Vector3(0, 0, TOOL_TIP_OFFSET));
    const quaternion = getTcpWorldQuaternion(end);
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    setTcp({
      x: point.x * 1000,
      y: point.y * 1000,
      z: point.z * 1000,
      rx: THREE.MathUtils.radToDeg(euler.x),
      ry: THREE.MathUtils.radToDeg(euler.y),
      rz: THREE.MathUtils.radToDeg(euler.z),
    });
  }, []);

  const fillCurrentPose = useCallback(() => {
    setIkTarget({
      x: tcp.x.toFixed(1), y: tcp.y.toFixed(1), z: tcp.z.toFixed(1),
      rx: tcp.rx.toFixed(1), ry: tcp.ry.toFixed(1), rz: tcp.rz.toFixed(1),
    });
    setIkMessage(null);
  }, [tcp]);

  useEffect(() => {
    if (loaded >= 18 && !ikInitialized.current) {
      ikInitialized.current = true;
      fillCurrentPose();
    }
  }, [loaded, fillCurrentPose]);

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
    const baseFrame = new THREE.Group();
    baseFrame.name = 'Base reference frame';
    [
      { direction: new THREE.Vector3(1, 0, 0), color: 0xef233c },
      { direction: new THREE.Vector3(0, 1, 0), color: 0x16a34a },
      { direction: new THREE.Vector3(0, 0, 1), color: 0x2563eb },
    ].forEach(({ direction, color }) => {
      const headLength = 0.022;
      const shaftLength = BASE_AXIS_LENGTH - headLength;
      const material = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
      const shaftGeometry = new THREE.CylinderGeometry(BASE_AXIS_THICKNESS / 2, BASE_AXIS_THICKNESS / 2, shaftLength, 16);
      const headGeometry = new THREE.CylinderGeometry(0, BASE_AXIS_THICKNESS * 1.5, headLength, 20);
      const shaft = new THREE.Mesh(shaftGeometry, material);
      const head = new THREE.Mesh(headGeometry, material);
      shaft.position.y = shaftLength / 2;
      head.position.y = shaftLength + headLength / 2;
      shaft.renderOrder = 20;
      head.renderOrder = 20;
      const arrow = new THREE.Group();
      arrow.add(shaft, head);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      baseFrame.add(arrow);
      disposables.push(shaftGeometry, headGeometry, material);
    });
    scene.add(baseFrame);

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

    const toolTipGeometry = new THREE.SphereGeometry(TOOL_TIP_MARKER_RADIUS, 32, 20);
    const toolTipMaterial = new THREE.MeshStandardMaterial({
      color: 0xe11d48,
      emissive: 0x4a0617,
      emissiveIntensity: 0.35,
      roughness: 0.32,
      metalness: 0.08,
    });
    const tcpFrame = new THREE.Group();
    tcpFrame.name = 'TCP frame';
    tcpFrame.position.set(0, 0, TOOL_TIP_OFFSET);
    tcpFrame.rotation.z = TCP_FRAME_ROTATION_Z;
    const toolTipMarker = new THREE.Mesh(toolTipGeometry, toolTipMaterial);
    toolTipMarker.name = 'Tool tip center';
    toolTipMarker.castShadow = true;
    toolTipMarker.receiveShadow = true;
    tcpFrame.add(toolTipMarker);

    const tcpAxes = [
      { direction: new THREE.Vector3(1, 0, 0), color: 0xef233c },
      { direction: new THREE.Vector3(0, 1, 0), color: 0x16a34a },
      { direction: new THREE.Vector3(0, 0, 1), color: 0x2563eb },
    ];
    tcpAxes.forEach(({ direction, color }) => {
      const headLength = 0.014;
      const shaftLength = TCP_AXIS_LENGTH - headLength;
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.05 });
      const shaftGeometry = new THREE.CylinderGeometry(TCP_AXIS_THICKNESS / 2, TCP_AXIS_THICKNESS / 2, shaftLength, 16);
      const headGeometry = new THREE.CylinderGeometry(0, TCP_AXIS_THICKNESS * 1.4, headLength, 20);
      const shaft = new THREE.Mesh(shaftGeometry, material);
      const head = new THREE.Mesh(headGeometry, material);
      shaft.position.y = shaftLength / 2;
      head.position.y = shaftLength + headLength / 2;
      shaft.castShadow = true;
      head.castShadow = true;
      const arrow = new THREE.Group();
      arrow.add(shaft, head);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      tcpFrame.add(arrow);
      disposables.push(shaftGeometry, headGeometry, material);
    });
    jointRotors.current[5].add(tcpFrame);
    disposables.push(toolTipGeometry, toolTipMaterial);

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
    jointRotors.current.forEach((rotor, index) => rotor.quaternion.setFromAxisAngle(
      axes.current[index],
      THREE.MathUtils.degToRad(angles[index]) + JOINT_ZERO_OFFSETS[index],
    ));
    updateTcp();
  }, [angles, updateTcp, loaded]);

  const setJoint = (index: number, value: number) => {
    const range = jointRanges[index];
    const safeValue = Math.min(range.max, Math.max(range.min, value));
    setAngles((current) => current.map((angle, i) => i === index ? safeValue : angle) as Pose);
  };

  const moveTo = (target: Pose) => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const safeTarget = target.map((value, index) => Math.min(jointRanges[index].max, Math.max(jointRanges[index].min, value))) as Pose;
    const start = [...angles] as Pose, started = performance.now(), duration = 700;
    setRunning(true);
    const step = (now: number) => {
      const raw = Math.min((now - started) / duration, 1), eased = 1 - Math.pow(1 - raw, 3);
      setAngles(start.map((value, i) => value + (safeTarget[i] - value) * eased) as Pose);
      if (raw < 1) animationRef.current = requestAnimationFrame(step); else setRunning(false);
    };
    animationRef.current = requestAnimationFrame(step);
  };

  const solveInverseKinematics = () => {
    const keys: Array<keyof IkTarget> = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
    const values = keys.map((key) => Number(ikTarget[key]));
    if (values.some((value, index) => ikTarget[keys[index]].trim() === '' || !Number.isFinite(value))) {
      setIkMessage({ type: 'error', text: 'Enter a valid number in all six pose fields.' });
      return;
    }
    if (jointRotors.current.length !== 6 || axes.current.length !== 6) {
      setIkMessage({ type: 'error', text: 'The robot model is still loading. Try again in a moment.' });
      return;
    }

    const [x, y, z, rx, ry, rz] = values;
    const targetPosition = new THREE.Vector3(x / 1000, y / 1000, z / 1000);
    const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
      'XYZ',
    ));
    const startingRadians = angles.map(THREE.MathUtils.degToRad) as Pose;
    const minimums = jointRanges.map((range) => THREE.MathUtils.degToRad(range.min));
    const maximums = jointRanges.map((range) => THREE.MathUtils.degToRad(range.max));
    const end = jointRotors.current[5];

    const applyRadians = (jointValues: number[]) => {
      jointRotors.current.forEach((rotor, index) => rotor.quaternion.setFromAxisAngle(
        axes.current[index],
        jointValues[index] + JOINT_ZERO_OFFSETS[index],
      ));
      jointRotors.current[0].updateWorldMatrix(true, true);
    };
    const readEndPose = () => {
      const position = end.localToWorld(new THREE.Vector3(0, 0, TOOL_TIP_OFFSET));
      const quaternion = getTcpWorldQuaternion(end);
      return { position, quaternion };
    };

    const attempt = (seed: number[]) => {
      const joints = seed.map((value, index) => Math.min(maximums[index], Math.max(minimums[index], value)));
      let finalPositionError = Number.POSITIVE_INFINITY;
      let finalOrientationError = Number.POSITIVE_INFINITY;
      for (let iteration = 0; iteration < 120; iteration += 1) {
        applyRadians(joints);
        const current = readEndPose();
        const positionError = targetPosition.clone().sub(current.position);
        const orientationError = rotationVector(current.quaternion, targetQuaternion);
        finalPositionError = positionError.length();
        finalOrientationError = orientationError.length();
        if (finalPositionError < 0.0015 && finalOrientationError < THREE.MathUtils.degToRad(1.5)) {
          return { solved: true, joints, positionError: finalPositionError, orientationError: finalOrientationError };
        }

        const orientationWeight = 0.3;
        const error = [positionError.x, positionError.y, positionError.z, orientationError.x * orientationWeight, orientationError.y * orientationWeight, orientationError.z * orientationWeight];
        const jacobian = Array.from({ length: 6 }, () => Array(6).fill(0));
        const epsilon = 1e-4;
        for (let column = 0; column < 6; column += 1) {
          const perturbed = [...joints];
          perturbed[column] += epsilon;
          applyRadians(perturbed);
          const moved = readEndPose();
          const positionDelta = moved.position.clone().sub(current.position).multiplyScalar(1 / epsilon);
          const orientationDelta = rotationVector(current.quaternion, moved.quaternion).multiplyScalar(orientationWeight / epsilon);
          jacobian[0][column] = positionDelta.x;
          jacobian[1][column] = positionDelta.y;
          jacobian[2][column] = positionDelta.z;
          jacobian[3][column] = orientationDelta.x;
          jacobian[4][column] = orientationDelta.y;
          jacobian[5][column] = orientationDelta.z;
        }
        applyRadians(joints);

        const normal = Array.from({ length: 6 }, () => Array(6).fill(0));
        const right = Array(6).fill(0);
        const damping = 0.025;
        for (let row = 0; row < 6; row += 1) {
          for (let column = 0; column < 6; column += 1) {
            for (let sample = 0; sample < 6; sample += 1) normal[row][column] += jacobian[sample][row] * jacobian[sample][column];
          }
          normal[row][row] += damping * damping;
          for (let sample = 0; sample < 6; sample += 1) right[row] += jacobian[sample][row] * error[sample];
        }
        const delta = solveLinearSystem(normal, right);
        if (!delta || delta.some((value) => !Number.isFinite(value))) break;
        for (let index = 0; index < 6; index += 1) {
          const step = THREE.MathUtils.clamp(delta[index] * 0.85, -0.18, 0.18);
          joints[index] = Math.min(maximums[index], Math.max(minimums[index], joints[index] + step));
        }
      }
      return { solved: false, joints, positionError: finalPositionError, orientationError: finalOrientationError };
    };

    const rawBaseDirection = Math.atan2(y, x) - JOINT_ZERO_OFFSETS[0];
    const normalizedBaseDirection = Math.atan2(Math.sin(rawBaseDirection), Math.cos(rawBaseDirection));
    const baseDirection = THREE.MathUtils.clamp(normalizedBaseDirection, minimums[0], maximums[0]);
    const seeds = [
      startingRadians,
      PRESETS.Home.map(THREE.MathUtils.degToRad),
      PRESETS.Upright.map(THREE.MathUtils.degToRad),
      [baseDirection, THREE.MathUtils.degToRad(20), THREE.MathUtils.degToRad(-20), 0, 0, 0],
    ];
    let best = attempt(seeds[0]);
    for (let index = 1; index < seeds.length && !best.solved; index += 1) {
      const candidate = attempt(seeds[index]);
      const candidateScore = candidate.positionError + candidate.orientationError * 0.15;
      const bestScore = best.positionError + best.orientationError * 0.15;
      if (candidate.solved || candidateScore < bestScore) best = candidate;
    }

    applyRadians(startingRadians);
    if (!best.solved) {
      setIkMessage({ type: 'error', text: 'No IK solution was found within the official MK5 joint limits. Try a closer position or a different orientation.' });
      return;
    }

    const solvedDegrees = best.joints.map((value) => THREE.MathUtils.radToDeg(value)) as Pose;
    setIkMessage({ type: 'success', text: `Solution found · position error ${(best.positionError * 1000).toFixed(2)} mm · orientation error ${THREE.MathUtils.radToDeg(best.orientationError).toFixed(2)}°` });
    moveTo(solvedDegrees);
  };

  const resetView = () => {
    const camera = cameraRef.current, controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.up.set(0, 0, 1);
    camera.position.set(1.05, -1.15, 0.78); controls.target.set(0, 0, 0.31); controls.update();
  };

  const setPlaneView = (plane: 'XY' | 'XZ' | 'YZ') => {
    const camera = cameraRef.current, controls = controlsRef.current;
    if (!camera || !controls) return;
    const distance = Math.max(1.2, camera.position.distanceTo(controls.target));
    controls.target.set(0, 0, 0);
    if (plane === 'XY') {
      camera.up.set(0, 1, 0);
      camera.position.set(0, 0, distance);
    } else if (plane === 'XZ') {
      camera.up.set(0, 0, 1);
      camera.position.set(0, distance, 0);
    } else {
      camera.up.set(0, 0, 1);
      camera.position.set(distance, 0, 0);
    }
    camera.lookAt(controls.target);
    controls.update();
  };

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [settingsOpen]);

  const requestSerialPort = async () => {
    const serial = (navigator as Navigator & { serial?: { requestPort: () => Promise<SerialPortLike> } }).serial;
    if (!serial) {
      setSerialMessage('Web Serial is unavailable. Open AR4 Studio in desktop Chrome or Edge over HTTPS or localhost.');
      return;
    }
    try {
      const port = await serial.requestPort();
      const info = port.getInfo();
      const vendor = info.usbVendorId?.toString(16).toUpperCase().padStart(4, '0');
      const product = info.usbProductId?.toString(16).toUpperCase().padStart(4, '0');
      setSerialPortName(vendor && product ? `Selected port · USB ${vendor}:${product}` : 'Selected serial port');
      setSerialMessage('Port permission granted.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        setSerialMessage('No port selected.');
      } else {
        setSerialMessage('Chrome could not access the selected serial port.');
      }
    }
  };

  const updateJointRange = (index: number, key: keyof JointRange, value: number) => {
    if (!Number.isFinite(value)) return;
    setJointRanges((current) => current.map((range, rangeIndex) => {
      if (rangeIndex !== index) return range;
      if (key === 'min') return { ...range, min: Math.min(value, range.max - 0.1) };
      return { ...range, max: Math.max(value, range.min + 0.1) };
    }));
  };

  const updateMotorSpeed = (index: number, value: number) => {
    if (!Number.isFinite(value)) return;
    setMotorSpeeds((current) => current.map((speed, speedIndex) => speedIndex === index
      ? Math.min(DEFAULT_MOTOR_SPEEDS[index], Math.max(0, value))
      : speed) as Pose);
  };

  const resetJointRanges = () => {
    setJointRanges(DEFAULT_JOINT_RANGES.map((range) => ({ ...range })));
    setAngles((current) => current.map((angle, index) => Math.min(DEFAULT_JOINT_RANGES[index].max, Math.max(DEFAULT_JOINT_RANGES[index].min, angle))) as Pose);
  };

  const resetMotorSettings = () => {
    setMotorSpeeds(DEFAULT_MOTOR_SPEEDS);
    setSpeedPercent(15);
    setAccelerationPercent(10);
    setDecelerationPercent(10);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">AR</div>
        <div className="brand-copy"><strong>AR4 Studio</strong><span>MK5 digital twin</span></div>
        <div className="connection"><i /> Simulation online</div>
        <div className="top-actions">
          <button className="settings-button" type="button" aria-label="Open settings" title="Settings" onClick={() => setSettingsOpen(true)}><GearIcon /></button>
        </div>
      </header>

      <section className="workspace">
        <section className="viewport-card">
          <div className="viewport-head">
            <div><span className="eyebrow">LIVE MODEL</span><h1>AR4 MK5</h1></div>
            <div className="viewport-tools"><span>{loaded < 18 ? `Loading ${Math.round((loaded / 18) * 100)}%` : 'Model ready'}</span><button onClick={resetView}>Fit</button></div>
          </div>
          <div className="canvas-wrap">
            <canvas ref={canvasRef} aria-label="Interactive 3D model of the AR4 MK5 robot" />
            <div className="orbit-hint">Drag to orbit · Scroll to zoom</div>
            <div className="axis-widget" aria-label="Standard plane views">
              <img className="axis-widget-image" src="/base-axis-widget.svg" alt="World axes with clickable XY, XZ, and YZ planes" />
              <button className="axis-plane axis-plane-xy" type="button" title="View XY plane from +Z" aria-label="View XY plane from positive Z" onClick={() => setPlaneView('XY')} />
              <button className="axis-plane axis-plane-xz" type="button" title="View XZ plane from +Y" aria-label="View XZ plane from positive Y" onClick={() => setPlaneView('XZ')} />
              <button className="axis-plane axis-plane-yz" type="button" title="View YZ plane from +X" aria-label="View YZ plane from positive X" onClick={() => setPlaneView('YZ')} />
            </div>
          </div>
          <div className="telemetry-strip">
            <div><span>X</span><strong>{tcp.x.toFixed(1)}</strong><small>mm</small></div>
            <div><span>Y</span><strong>{tcp.y.toFixed(1)}</strong><small>mm</small></div>
            <div><span>Z</span><strong>{tcp.z.toFixed(1)}</strong><small>mm</small></div>
            <div><span>θx</span><strong>{tcp.rx.toFixed(1)}</strong><small>deg</small></div>
            <div><span>θy</span><strong>{tcp.ry.toFixed(1)}</strong><small>deg</small></div>
            <div><span>θz</span><strong>{tcp.rz.toFixed(1)}</strong><small>deg</small></div>
            <div className="status-cell"><i /><strong>{running ? 'Moving' : 'Holding'}</strong></div>
          </div>
        </section>

        <aside className="control-panel">
          <div className="panel-heading"><div><span className="eyebrow">MANUAL CONTROL</span><h2>Joint positions</h2></div><button className="zero-button" onClick={() => moveTo(PRESETS.Home)}>Zero all</button></div>
          <div className="joint-list">
            {JOINTS.map((joint, index) => {
              const range = jointRanges[index];
              const progress = ((angles[index] - range.min) / (range.max - range.min)) * 100;
              return <div className="joint-control" key={joint.name}>
                <div className="joint-label"><span className="joint-id" style={{ background: joint.accent }}>{joint.name}</span><span><strong>{joint.label}</strong><small>{range.min}° to {range.max}°</small></span><JointAngleInput name={joint.name} value={angles[index]} min={range.min} max={range.max} onChange={(value) => setJoint(index, value)} /></div>
                <input aria-label={`${joint.name} ${joint.label}`} type="range" min={range.min} max={range.max} step="1" value={angles[index]} onChange={(event) => setJoint(index, Number(event.target.value))} style={{ '--range': `${progress}%`, '--accent': joint.accent } as React.CSSProperties} />
              </div>;
            })}
          </div>
          <div className="preset-section"><div className="section-label"><span>Saved poses</span><small>Click to move</small></div><div className="preset-grid">
            {Object.entries(PRESETS).map(([name, pose]) => <button key={name} onClick={() => moveTo(pose)}><span className={`pose-icon pose-${name.toLowerCase()}`} /><strong>{name}</strong><small>{pose.slice(0, 3).join(' · ')}°</small></button>)}
          </div></div>
        </aside>

        <aside className="ik-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">CARTESIAN TARGET</span><h2>Inverse kinematics</h2></div>
            <button type="button" className="current-pose-button" onClick={fillCurrentPose}>Use current</button>
          </div>
          <form className="ik-section" onSubmit={(event) => { event.preventDefault(); solveInverseKinematics(); }}>
            <div className="ik-grid">
              {([
                ['x', 'X', 'mm'], ['y', 'Y', 'mm'], ['z', 'Z', 'mm'],
                ['rx', 'θx', 'deg'], ['ry', 'θy', 'deg'], ['rz', 'θz', 'deg'],
              ] as const).map(([key, label, unit]) => <label key={key}>
                <span>{label}<small>{unit}</small></span>
                <input
                  aria-label={`${label} (${unit})`}
                  type="number"
                  step="0.1"
                  value={ikTarget[key]}
                  onChange={(event) => {
                    setIkTarget((current) => ({ ...current, [key]: event.target.value }));
                    setIkMessage(null);
                  }}
                />
              </label>)}
            </div>
            <button className="solve-button" type="submit" disabled={loaded < 18 || running}>Calculate &amp; move</button>
            {ikMessage && <p className={`ik-message ${ikMessage.type}`} role="status" aria-live="polite">{ikMessage.text}</p>}
          </form>
        </aside>
      </section>

      {settingsOpen && <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header className="settings-header">
            <div><span className="eyebrow">AR4 STUDIO</span><h2 id="settings-title">Settings</h2></div>
            <button className="modal-close" type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button>
          </header>
          <div className="settings-layout">
            <nav className="settings-nav" aria-label="Settings categories">
              <button className={settingsCategory === 'com' ? 'active' : ''} onClick={() => setSettingsCategory('com')}><span>COM</span><small>Serial connection</small></button>
              <button className={settingsCategory === 'ranges' ? 'active' : ''} onClick={() => setSettingsCategory('ranges')}><span>Joint ranges</span><small>Motion limits</small></button>
              <button className={settingsCategory === 'motors' ? 'active' : ''} onClick={() => setSettingsCategory('motors')}><span>Motors</span><small>Speed profile</small></button>
            </nav>
            <div className="settings-content">
              {settingsCategory === 'com' && <div className="settings-page">
                <div className="settings-page-title"><div><h3>COM port</h3><p>Select the AR4 Teensy controller.</p></div></div>
                <label className="setting-field serial-field">
                  <span>COM port</span>
                  <button type="button" className="serial-select" onClick={requestSerialPort}><strong>{serialPortName}</strong><i aria-hidden="true">⌄</i></button>
                </label>
                {serialMessage && <p className="settings-note" role="status">{serialMessage}</p>}
              </div>}

              {settingsCategory === 'ranges' && <div className="settings-page">
                <div className="settings-page-title"><div><h3>Joint ranges</h3><p>Set the permitted angular travel for each joint.</p></div><button className="default-button" type="button" onClick={resetJointRanges}>Default</button></div>
                <div className="settings-table range-table">
                  <div className="settings-table-head"><span>Joint</span><span>Minimum</span><span>Maximum</span></div>
                  {JOINTS.map((joint, index) => <div className="settings-table-row" key={joint.name}>
                    <strong><i style={{ background: joint.accent }} />{joint.name}</strong>
                    <label><input aria-label={`${joint.name} minimum range`} type="number" step="0.1" max={jointRanges[index].max} value={jointRanges[index].min} onChange={(event) => updateJointRange(index, 'min', Number(event.target.value))} /><small>deg</small></label>
                    <label><input aria-label={`${joint.name} maximum range`} type="number" step="0.1" min={jointRanges[index].min} value={jointRanges[index].max} onChange={(event) => updateJointRange(index, 'max', Number(event.target.value))} /><small>deg</small></label>
                  </div>)}
                </div>
              </div>}

              {settingsCategory === 'motors' && <div className="settings-page">
                <div className="settings-page-title"><div><h3>Motors</h3><p>Configure joint speed limits and the default motion profile.</p></div><button className="default-button" type="button" onClick={resetMotorSettings}>Default</button></div>
                <div className="settings-table motor-table">
                  <div className="settings-table-head"><span>Motor</span><span>Maximum speed</span></div>
                  {JOINTS.map((joint, index) => <div className="settings-table-row" key={joint.name}>
                    <strong><i style={{ background: joint.accent }} />{joint.name}</strong>
                    <label><input aria-label={`${joint.name} maximum speed`} type="number" min="0" max={DEFAULT_MOTOR_SPEEDS[index]} step="0.001" value={motorSpeeds[index]} onChange={(event) => updateMotorSpeed(index, Number(event.target.value))} /><small>deg/s</small></label>
                  </div>)}
                </div>
                <div className="profile-settings">
                  {([
                    ['Speed Percentage %', speedPercent, setSpeedPercent, 15],
                    ['Acceleration Percentage %', accelerationPercent, setAccelerationPercent, 10],
                    ['Deceleration Percentage %', decelerationPercent, setDecelerationPercent, 10],
                  ] as const).map(([label, value, setter, defaultValue]) => <label className="profile-row" key={label}>
                    <span><strong>{label}</strong><small>Default {defaultValue}% · Maximum 100%</small></span>
                    <span className="percent-input"><input type="number" min="0" max="100" step="1" value={value} onChange={(event) => setter(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /><small>%</small></span>
                  </label>)}
                </div>
              </div>}
            </div>
          </div>
        </section>
      </div>}
    </main>
  );
}
