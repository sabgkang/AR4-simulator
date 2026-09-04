'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { createJointMotion, DEFAULT_MAX_SPEEDS, type JointValues } from './teensy-motion';
import { buildLinearWaypoints, createLinearMotionSequence, type CartesianPose, type ExternalAxes, type LinearJointWaypoint } from './teensy-linear-motion';
import { createPositionResponse, HELLO_RESPONSE, type TcpValues } from './simulator-protocol';

type Pose = [number, number, number, number, number, number];
type TcpPose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };
type IkTarget = Record<'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz', string>;
type SettingsCategory = 'com' | 'ranges' | 'motors';
type JointRange = { min: number; max: number };
type SerialPortLike = { getInfo: () => { usbVendorId?: number; usbProductId?: number } };
type MoveJointsCommand = { cmd: 'move_joints'; j: number[]; spd_type?: string; spd?: number; acc?: number; dec?: number; ramp?: number };
type MoveJCommand = { cmd: 'move_j'; pose: number[]; spd_type?: string; spd?: number; acc?: number; dec?: number; ramp?: number; w?: string };
type MoveLCommand = { cmd: 'move_l'; pose: number[]; ext?: number[]; spd_type?: string; spd?: number; acc?: number; dec?: number; ramp?: number; rounding?: number; w?: string };
type MotionCommand = MoveJointsCommand | MoveJCommand | MoveLCommand;
type TestCommandName = MotionCommand['cmd'] | 'hello' | 'get_position';
type PanelKey = 'plan' | 'angles' | 'cartesian';
type RobotPositionResponse = ReturnType<typeof createPositionResponse>;
type CommandResponse = typeof HELLO_RESPONSE | RobotPositionResponse | { msg: 'error'; data: string };

declare global {
  interface Window {
    ar4Simulator?: { executeCommand: (command: unknown) => Promise<CommandResponse> };
  }
}

const JOINTS = [
  { name: 'J1', label: 'Base', min: -170, max: 170, accent: '#2563eb' },
  { name: 'J2', label: 'Shoulder', min: -42, max: 90, accent: '#7c3aed' },
  { name: 'J3', label: 'Elbow', min: -89, max: 52, accent: '#0891b2' },
  { name: 'J4', label: 'Wrist roll', min: -165, max: 165, accent: '#059669' },
  { name: 'J5', label: 'Wrist bend', min: -105, max: 105, accent: '#d97706' },
  { name: 'J6', label: 'Tool roll', min: -155, max: 155, accent: '#dc2626' },
] as const;

const DEFAULT_JOINT_RANGES: JointRange[] = JOINTS.map(({ min, max }) => ({ min, max }));
const DEFAULT_MOTOR_SPEEDS: Pose = DEFAULT_MAX_SPEEDS.slice(0, 6) as Pose;

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

function angularDifferenceDegrees(value: number, reference: number) {
  return ((value - reference + 540) % 360) - 180;
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

function ViewIcon() {
  return <svg className="view-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.75" /></svg>;
}

export default function RobotSimulator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const jointRotors = useRef<THREE.Group[]>([]);
  const axes = useRef<THREE.Vector3[]>([]);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationRef = useRef<number | null>(null);
  const anglesRef = useRef<Pose>(PRESETS.Home);
  const tcpRef = useRef<TcpPose>({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  const externalAxesRef = useRef<[number, number, number]>([0, 0, 0]);
  const runningRef = useRef(false);
  const ikInitialized = useRef(false);
  const [angles, setAngles] = useState<Pose>(PRESETS.Home);
  const [tcp, setTcp] = useState<TcpPose>({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  const [ikTarget, setIkTarget] = useState<IkTarget>({ x: '', y: '', z: '', rx: '', ry: '', rz: '' });
  const [ikMessage, setIkMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [running, setRunning] = useState(false);
  const [activeTestCommand, setActiveTestCommand] = useState<TestCommandName | null>(null);
  const [commandOutput, setCommandOutput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('com');
  const [jointRanges, setJointRanges] = useState<JointRange[]>(() => DEFAULT_JOINT_RANGES.map((range) => ({ ...range })));
  const [motorSpeeds, setMotorSpeeds] = useState<Pose>(DEFAULT_MOTOR_SPEEDS);
  const [speedPercent, setSpeedPercent] = useState(15);
  const [accelerationPercent, setAccelerationPercent] = useState(10);
  const [decelerationPercent, setDecelerationPercent] = useState(10);
  const [serialPortName, setSerialPortName] = useState('No COM port selected');
  const [serialMessage, setSerialMessage] = useState<string | null>(null);
  const [visiblePanels, setVisiblePanels] = useState<Record<PanelKey, boolean>>({ plan: true, angles: true, cartesian: true });

  const setPanelVisible = (panel: PanelKey, visible: boolean) => {
    setVisiblePanels((current) => ({ ...current, [panel]: visible }));
  };
  const visiblePanelCount = Object.values(visiblePanels).filter(Boolean).length;

  const updateTcp = useCallback(() => {
    const end = jointRotors.current[5];
    if (!end) return;
    end.updateWorldMatrix(true, true);
    const point = end.localToWorld(new THREE.Vector3(0, 0, TOOL_TIP_OFFSET));
    const quaternion = getTcpWorldQuaternion(end);
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    const nextTcp = {
      x: point.x * 1000,
      y: point.y * 1000,
      z: point.z * 1000,
      rx: THREE.MathUtils.radToDeg(euler.x),
      ry: THREE.MathUtils.radToDeg(euler.y),
      rz: THREE.MathUtils.radToDeg(euler.z),
    };
    tcpRef.current = nextTcp;
    setTcp(nextTcp);
  }, []);

  const getPoseForJoints = useCallback((jointValues: Pose) => {
    if (jointRotors.current.length !== 6 || axes.current.length !== 6) {
      throw new Error('The robot model is still loading. Try again in a moment.');
    }
    const displayedJoints = [...anglesRef.current] as Pose;
    const applyJoints = (values: Pose) => {
      jointRotors.current.forEach((rotor, index) => rotor.quaternion.setFromAxisAngle(
        axes.current[index],
        THREE.MathUtils.degToRad(values[index]) + JOINT_ZERO_OFFSETS[index],
      ));
      jointRotors.current[0].updateWorldMatrix(true, true);
    };
    try {
      applyJoints(jointValues);
      const end = jointRotors.current[5];
      const point = end.localToWorld(new THREE.Vector3(0, 0, TOOL_TIP_OFFSET));
      const euler = new THREE.Euler().setFromQuaternion(getTcpWorldQuaternion(end), 'XYZ');
      return [
        point.x * 1000,
        point.y * 1000,
        point.z * 1000,
        THREE.MathUtils.radToDeg(euler.x),
        THREE.MathUtils.radToDeg(euler.y),
        THREE.MathUtils.radToDeg(euler.z),
      ] as Pose;
    } finally {
      applyJoints(displayedJoints);
    }
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
    anglesRef.current = angles;
    jointRotors.current.forEach((rotor, index) => rotor.quaternion.setFromAxisAngle(
      axes.current[index],
      THREE.MathUtils.degToRad(angles[index]) + JOINT_ZERO_OFFSETS[index],
    ));
    updateTcp();
  }, [angles, updateTcp, loaded]);

  const setJoint = (index: number, value: number) => {
    if (runningRef.current) return;
    const range = jointRanges[index];
    const safeValue = Math.min(range.max, Math.max(range.min, value));
    setAngles((current) => current.map((angle, i) => i === index ? safeValue : angle) as Pose);
  };

  const moveTo = (target: Pose) => {
    if (runningRef.current) return;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const safeTarget = target.map((value, index) => Math.min(jointRanges[index].max, Math.max(jointRanges[index].min, value))) as Pose;
    const start = [...angles] as Pose, started = performance.now(), duration = 700;
    runningRef.current = true;
    setRunning(true);
    const step = (now: number) => {
      const raw = Math.min((now - started) / duration, 1), eased = 1 - Math.pow(1 - raw, 3);
      setAngles(start.map((value, i) => value + (safeTarget[i] - value) * eased) as Pose);
      if (raw < 1) animationRef.current = requestAnimationFrame(step); else {
        runningRef.current = false;
        setRunning(false);
      }
    };
    animationRef.current = requestAnimationFrame(step);
  };

  const solvePose = useCallback((values: Pose, wristConfiguration = 'A', referenceJoints: Pose = anglesRef.current, preferContinuation = false) => {
    if (jointRotors.current.length !== 6 || axes.current.length !== 6) {
      throw new Error('The robot model is still loading. Try again in a moment.');
    }

    const [x, y, z, rx, ry, rz] = values;
    const targetPosition = new THREE.Vector3(x / 1000, y / 1000, z / 1000);
    const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
      'XYZ',
    ));
    const startingDegrees = [...referenceJoints] as Pose;
    const startingRadians = startingDegrees.map(THREE.MathUtils.degToRad) as Pose;
    const displayedRadians = anglesRef.current.map(THREE.MathUtils.degToRad) as Pose;
    const positionTolerance = preferContinuation ? 0.00015 : 0.0015;
    const orientationTolerance = THREE.MathUtils.degToRad(preferContinuation ? 0.15 : 1.5);
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
        if (finalPositionError < positionTolerance && finalOrientationError < orientationTolerance) {
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
    const fallbackSeeds = [
      PRESETS.Home.map(THREE.MathUtils.degToRad),
      PRESETS.Upright.map(THREE.MathUtils.degToRad),
      [baseDirection, THREE.MathUtils.degToRad(20), THREE.MathUtils.degToRad(-20), 0, 0, 0],
    ];
    const wristSeeds = [-90, -45, 45, 90].map((j5) => {
      const seed = [...startingRadians];
      seed[4] = THREE.MathUtils.degToRad(j5);
      return seed;
    });

    try {
      const wrist = wristConfiguration.trim().toUpperCase().charAt(0) || 'A';
      const currentWristSign = Math.abs(startingDegrees[4]) > 0.5 ? Math.sign(startingDegrees[4]) : 1;
      const desiredWristSign = wrist === 'F' ? 1 : wrist === 'N' ? -1 : currentWristSign;
      const evaluateCandidate = (candidate: ReturnType<typeof attempt>) => {
        const degrees = candidate.joints.map(THREE.MathUtils.radToDeg) as Pose;
        const absoluteJ5 = Math.abs(degrees[4]);
        const wristSign = absoluteJ5 > 0.5 ? Math.sign(degrees[4]) : 0;
        let cost = degrees.reduce((total, value, joint) => total + Math.abs(angularDifferenceDegrees(value, startingDegrees[joint])), 0);
        if (wrist === 'F' || wrist === 'N') {
          if (absoluteJ5 > 2 && wristSign !== desiredWristSign) return null;
          if (absoluteJ5 <= 2 && wristSign !== 0 && wristSign !== desiredWristSign) cost += 200;
        } else if (wrist === 'A') {
          if (absoluteJ5 > 2 && wristSign !== 0 && wristSign !== desiredWristSign) cost += 20;
        } else if (absoluteJ5 > 2 && wristSign !== 0 && wristSign !== desiredWristSign) {
          return null;
        }
        if (absoluteJ5 <= 2) {
          cost += 5 * Math.abs(angularDifferenceDegrees(degrees[3] + degrees[5], startingDegrees[3] + startingDegrees[5]));
        }
        return { candidate, degrees, cost };
      };

      const continuation = attempt(startingRadians);
      const continued = continuation.solved ? evaluateCandidate(continuation) : null;
      if (preferContinuation && continued) {
        return {
          joints: continued.degrees,
          positionError: continuation.positionError,
          orientationError: continuation.orientationError,
        };
      }

      const attempts = [continuation, ...[...fallbackSeeds, ...wristSeeds].map(attempt)];
      const solved = attempts.filter((candidate) => candidate.solved).filter((candidate, index, candidates) => {
        const degrees = candidate.joints.map(THREE.MathUtils.radToDeg);
        return candidates.findIndex((other) => other.joints.every((value, joint) =>
          Math.abs(angularDifferenceDegrees(THREE.MathUtils.radToDeg(value), degrees[joint])) < 0.2,
        )) === index;
      });
      if (solved.length === 0) {
        throw new Error('No IK solution was found within the configured joint limits. Try a closer position or a different orientation.');
      }

      const candidates = solved.map(evaluateCandidate).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

      const fallback = solved.map((candidate) => ({
        candidate,
        degrees: candidate.joints.map(THREE.MathUtils.radToDeg) as Pose,
        cost: candidate.joints.reduce((total, value, joint) =>
          total + Math.abs(angularDifferenceDegrees(THREE.MathUtils.radToDeg(value), startingDegrees[joint])), 0),
      }));
      const best = (candidates.length > 0 ? candidates : fallback).reduce((selected, candidate) =>
        candidate.cost < selected.cost ? candidate : selected,
      );
      return {
        joints: best.degrees,
        positionError: best.candidate.positionError,
        orientationError: best.candidate.orientationError,
      };
    } finally {
      applyRadians(displayedRadians);
    }
  }, [jointRanges]);

  const solveInverseKinematics = () => {
    const keys: Array<keyof IkTarget> = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
    const values = keys.map((key) => Number(ikTarget[key]));
    if (values.some((value, index) => ikTarget[keys[index]].trim() === '' || !Number.isFinite(value))) {
      setIkMessage({ type: 'error', text: 'Enter a valid number in all six pose fields.' });
      return;
    }
    try {
      const solution = solvePose(values as Pose);
      setIkMessage({ type: 'success', text: `Solution found · position error ${(solution.positionError * 1000).toFixed(2)} mm · orientation error ${THREE.MathUtils.radToDeg(solution.orientationError).toFixed(2)}°` });
      moveTo(solution.joints);
    } catch (error) {
      setIkMessage({ type: 'error', text: error instanceof Error ? error.message : 'No IK solution was found.' });
    }
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

  useEffect(() => {
    const executeCommand = async (rawCommand: unknown): Promise<CommandResponse> => {
      try {
        const decodedCommand = typeof rawCommand === 'string' ? JSON.parse(rawCommand) as unknown : rawCommand;
        if (!decodedCommand || typeof decodedCommand !== 'object') {
          throw new Error('Unsupported command.');
        }
        const commandName = (decodedCommand as { cmd?: unknown }).cmd;
        if (commandName === 'hello') return HELLO_RESPONSE;
        if (commandName === 'get_position') {
          const joints = [...anglesRef.current, ...externalAxesRef.current] as JointValues;
          const currentTcp = jointRotors.current.length === 6
            ? getPoseForJoints(anglesRef.current)
            : [tcpRef.current.x, tcpRef.current.y, tcpRef.current.z, tcpRef.current.rx, tcpRef.current.ry, tcpRef.current.rz] as Pose;
          return createPositionResponse(joints, currentTcp as TcpValues);
        }
        if (commandName === 'calibrate') {
          throw new Error('calibrate is a hardware homing operation and is not available in the simulator.');
        }
        if (runningRef.current) throw new Error('Robot is already moving.');

        const command = decodedCommand as MotionCommand;
        if (command.cmd !== 'move_joints' && command.cmd !== 'move_j' && command.cmd !== 'move_l') throw new Error('Unsupported command.');
        if (command.ramp !== undefined && !Number.isFinite(command.ramp)) throw new Error('ramp must be a finite number.');
        if ((command.spd_type ?? 'percent') !== 'percent') {
          throw new Error(`${command.cmd} currently supports spd_type "percent" only.`);
        }

        let target: JointValues;
        let motion: { durationMs: number; sample: (elapsedMs: number) => JointValues };
        const start = [...anglesRef.current, ...externalAxesRef.current] as JointValues;
        const configuredMaxSpeeds = [...motorSpeeds, ...DEFAULT_MAX_SPEEDS.slice(6)] as JointValues;
        if (command.cmd === 'move_joints') {
          if (!Array.isArray(command.j) || command.j.length !== 9 || command.j.some((value) => !Number.isFinite(value))) {
            throw new Error('move_joints requires nine finite joint values.');
          }
          target = [...command.j] as JointValues;
          motion = createJointMotion({
            start,
            target,
            maxSpeeds: configuredMaxSpeeds,
            speedPercent: command.spd ?? speedPercent,
            accelerationPercent: command.acc ?? accelerationPercent,
            decelerationPercent: command.dec ?? decelerationPercent,
            ramp: command.ramp ?? 10,
          });
        } else if (command.cmd === 'move_j') {
          if (!Array.isArray(command.pose) || command.pose.length !== 6 || command.pose.some((value) => !Number.isFinite(value))) {
            throw new Error('move_j requires six finite pose values.');
          }
          const solution = solvePose([...command.pose] as Pose, command.w ?? 'A');
          target = [...solution.joints, ...externalAxesRef.current] as JointValues;
          motion = createJointMotion({
            start,
            target,
            maxSpeeds: configuredMaxSpeeds,
            speedPercent: command.spd ?? speedPercent,
            accelerationPercent: command.acc ?? accelerationPercent,
            decelerationPercent: command.dec ?? decelerationPercent,
            ramp: command.ramp ?? 10,
          });
        } else {
          if (!Array.isArray(command.pose) || command.pose.length !== 6 || command.pose.some((value) => !Number.isFinite(value))) {
            throw new Error('move_l requires six finite pose values.');
          }
          if (command.ext !== undefined && (!Array.isArray(command.ext) || command.ext.length !== 3 || command.ext.some((value) => !Number.isFinite(value)))) {
            throw new Error('move_l ext requires three finite values.');
          }
          if (command.rounding !== undefined && (!Number.isFinite(command.rounding) || command.rounding < 0)) {
            throw new Error('rounding must be a non-negative finite number.');
          }
          if ((command.rounding ?? 0) > 0) {
            throw new Error('move_l rounding greater than 0 requires command-queue lookahead and is not supported yet.');
          }
          const linearSpeed = command.spd ?? speedPercent;
          const linearAcceleration = command.acc ?? accelerationPercent;
          const linearDeceleration = command.dec ?? decelerationPercent;
          const linearRamp = command.ramp ?? 80;
          if (!Number.isFinite(linearSpeed) || linearSpeed <= 0 || linearSpeed > 100) throw new Error('spd must be greater than 0 and no more than 100.');
          if (!Number.isFinite(linearAcceleration) || linearAcceleration < 0 || linearAcceleration > 100) throw new Error('acc must be between 0 and 100.');
          if (!Number.isFinite(linearDeceleration) || linearDeceleration < 0 || linearDeceleration > 100) throw new Error('dec must be between 0 and 100.');
          if (!Number.isFinite(linearRamp) || linearRamp <= 0 || linearRamp > 100) throw new Error('ramp must be between 0 and 100.');

          runningRef.current = true;
          setRunning(true);
          const startTcp = tcpRef.current;
          const startPose: CartesianPose = [startTcp.x, startTcp.y, startTcp.z, startTcp.rx, startTcp.ry, startTcp.rz];
          const targetPose = [...command.pose] as CartesianPose;
          const startExternal = [...externalAxesRef.current] as ExternalAxes;
          const targetExternal = command.ext ? [...command.ext] as ExternalAxes : [...startExternal] as ExternalAxes;
          targetExternal.forEach((value, index) => {
            if (value < 0 || value > 3450) throw new Error(`J${index + 7} target is outside the firmware range 0 to 3450.`);
          });

          const cartesianWaypoints = buildLinearWaypoints(startPose, targetPose, startExternal, targetExternal);
          const jointWaypoints: LinearJointWaypoint[] = [];
          let referenceJoints = [...anglesRef.current] as Pose;
          for (let index = 0; index < cartesianWaypoints.length; index += 1) {
            const waypoint = cartesianWaypoints[index];
            const solution = solvePose(waypoint.pose, command.w ?? 'A', referenceJoints, true);
            referenceJoints = solution.joints;
            jointWaypoints.push({
              progress: waypoint.progress,
              joints: [...solution.joints, ...waypoint.external] as JointValues,
            });
            if ((index + 1) % 20 === 0) {
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            }
          }
          motion = createLinearMotionSequence({
            start,
            waypoints: jointWaypoints,
            maxSpeeds: configuredMaxSpeeds,
            speedPercent: linearSpeed,
            accelerationPercent: linearAcceleration,
            decelerationPercent: linearDeceleration,
            ramp: linearRamp,
          });
          target = motion.sample(motion.durationMs);
        }

        for (let index = 0; index < 6; index += 1) {
          const range = jointRanges[index];
          if (target[index] < range.min || target[index] > range.max) {
            throw new Error(`J${index + 1} target is outside its configured range.`);
          }
        }
        for (let index = 6; index < 9; index += 1) {
          if (target[index] < 0 || target[index] > 3450) {
            throw new Error(`J${index + 1} target is outside the firmware range 0 to 3450.`);
          }
        }

        if (motion.durationMs === 0) {
          runningRef.current = false;
          setRunning(false);
          return {
            msg: 'robot_pos', j: target.slice(0, 6),
            pose: [tcpRef.current.x, tcpRef.current.y, tcpRef.current.z, tcpRef.current.rx, tcpRef.current.ry, tcpRef.current.rz, ...target.slice(6)],
            speed_violation: 0, debug: '', flag: '',
          };
        }

        runningRef.current = true;
        setRunning(true);
        const started = performance.now();
        await new Promise<void>((resolve) => {
          const animate = (now: number) => {
            const values = motion.sample(now - started);
            const robotJoints = values.slice(0, 6) as Pose;
            anglesRef.current = robotJoints;
            externalAxesRef.current = values.slice(6) as [number, number, number];
            setAngles(robotJoints);
            if (now - started < motion.durationMs) animationRef.current = requestAnimationFrame(animate);
            else resolve();
          };
          animationRef.current = requestAnimationFrame(animate);
        });
        runningRef.current = false;
        setRunning(false);

        // Let React apply the final joint transforms before reading the TCP.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const finalTcp = tcpRef.current;
        return {
          msg: 'robot_pos',
          j: [...anglesRef.current],
          pose: [finalTcp.x, finalTcp.y, finalTcp.z, finalTcp.rx, finalTcp.ry, finalTcp.rz, ...externalAxesRef.current],
          speed_violation: 0,
          debug: '',
          flag: '',
        };
      } catch (error) {
        runningRef.current = false;
        setRunning(false);
        return { msg: 'error', data: error instanceof Error ? error.message : 'Invalid command.' };
      }
    };

    window.ar4Simulator = { executeCommand };
    return () => { delete window.ar4Simulator; };
  }, [accelerationPercent, decelerationPercent, getPoseForJoints, jointRanges, motorSpeeds, solvePose, speedPercent]);

  const runTestCommand = async (commandName: TestCommandName) => {
    const isMotionCommand = commandName === 'move_joints' || commandName === 'move_j' || commandName === 'move_l';
    if ((isMotionCommand && runningRef.current) || (commandName !== 'hello' && loaded < 18)) return;
    const executeCommand = window.ar4Simulator?.executeCommand;
    if (!executeCommand) return;
    setActiveTestCommand(commandName);
    setIkMessage(null);
    try {
      const profile = {
        spd_type: 'percent',
        spd: speedPercent,
        acc: accelerationPercent,
        dec: decelerationPercent,
      } as const;
      let command: unknown;
      if (commandName === 'hello' || commandName === 'get_position') {
        command = { cmd: commandName };
      } else if (commandName === 'move_joints') {
        command = { cmd: 'move_joints', j: [0, 0, 0, 0, 0, 0, 0, 0, 0], ...profile };
      } else {
        const homePose = getPoseForJoints(PRESETS.Home);
        command = commandName === 'move_j'
          ? { cmd: 'move_j', pose: homePose, w: 'A', ...profile }
          : { cmd: 'move_l', pose: homePose, ext: [0, 0, 0], rounding: 0, w: 'A', ...profile };
      }
      const response = await executeCommand(command);
      setCommandOutput(JSON.stringify(response));
      if ('msg' in response && response.msg === 'error') throw new Error(response.data);
      if (isMotionCommand) setIkMessage({ type: 'success', text: `${commandName} test completed at Home.` });
    } catch (error) {
      const message = `${commandName} test failed: ${error instanceof Error ? error.message : 'Unknown error.'}`;
      setCommandOutput(JSON.stringify({ msg: 'error', data: message }));
      setIkMessage({ type: 'error', text: message });
    } finally {
      setActiveTestCommand(null);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">AR</div>
        <div className="brand-copy"><strong>AR4 Studio</strong><span>MK5 digital twin</span></div>
        <div className="connection"><i /> Simulation online</div>
        <div className="command-output">
          <output aria-live="polite" title={commandOutput}>{commandOutput}</output>
          {commandOutput && (
            <button type="button" aria-label="Clear command response" title="Clear" onClick={() => setCommandOutput('')}>X</button>
          )}
        </div>
        <div className="top-actions">
          {(['hello', 'get_position', 'move_joints', 'move_j', 'move_l'] as TestCommandName[]).map((commandName) => {
            const isMotionCommand = commandName === 'move_joints' || commandName === 'move_j' || commandName === 'move_l';
            return (
            <button
              className="command-test-button"
              type="button"
              key={commandName}
              disabled={(isMotionCommand && running) || (commandName !== 'hello' && loaded < 18)}
              aria-label={isMotionCommand ? `Test ${commandName} command to Home` : `Test ${commandName} command`}
              title={isMotionCommand ? `Run ${commandName} to Home` : `Run ${commandName}`}
              onClick={() => { void runTestCommand(commandName); }}
            >
              {activeTestCommand === commandName ? 'Running…' : commandName}
            </button>
          );})}
          <button className="settings-button" type="button" aria-label="Open settings" title="Settings" onClick={() => setSettingsOpen(true)}><GearIcon /></button>
        </div>
      </header>

      <section
        className={`workspace${visiblePanelCount === 0 ? ' workspace-solo' : ''}`}
        style={{ '--visible-panels': visiblePanelCount } as React.CSSProperties}
      >
        <section className="viewport-card">
          <div className="canvas-wrap">
            <canvas ref={canvasRef} aria-label="Interactive 3D model of the AR4 MK5 robot" />
            {visiblePanelCount < 3 && <div className="panel-reopeners" aria-label="Show hidden panels">
              {!visiblePanels.plan && <button type="button" onClick={() => setPanelVisible('plan', true)}><ViewIcon />PLAN</button>}
              {!visiblePanels.angles && <button type="button" onClick={() => setPanelVisible('angles', true)}><ViewIcon />ANGLES</button>}
              {!visiblePanels.cartesian && <button type="button" onClick={() => setPanelVisible('cartesian', true)}><ViewIcon />CARTESIAN</button>}
            </div>}
            <div className="orbit-hint">Drag to orbit · Scroll to zoom</div>
            <div className="axis-widget" aria-label="Standard plane views">
              <button className="axis-fit" type="button" onClick={resetView}>Fit</button>
              <div className="axis-graphic">
                <img className="axis-widget-image" src="/base-axis-widget.svg" alt="World axes with clickable XY, XZ, and YZ planes" />
                <button className="axis-plane axis-plane-xy" type="button" title="View XY plane from +Z" aria-label="View XY plane from positive Z" onClick={() => setPlaneView('XY')} />
                <button className="axis-plane axis-plane-xz" type="button" title="View XZ plane from +Y" aria-label="View XZ plane from positive Y" onClick={() => setPlaneView('XZ')} />
                <button className="axis-plane axis-plane-yz" type="button" title="View YZ plane from +X" aria-label="View YZ plane from positive X" onClick={() => setPlaneView('YZ')} />
              </div>
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

        {visiblePanels.plan && <aside className="plan-panel">
          <div className="panel-heading">
            <div className="panel-title"><button className="panel-visibility-button" type="button" title="Hide PLAN" aria-label="Hide PLAN column" onClick={() => setPanelVisible('plan', false)}><ViewIcon /></button><span className="eyebrow">PLAN</span></div>
          </div>
        </aside>}

        {visiblePanels.angles && <aside className="control-panel">
          <div className="panel-heading"><div className="panel-title"><button className="panel-visibility-button" type="button" title="Hide ANGLES" aria-label="Hide ANGLES column" onClick={() => setPanelVisible('angles', false)}><ViewIcon /></button><span className="eyebrow">ANGLES</span></div><button className="zero-button" onClick={() => moveTo(PRESETS.Home)}>Zero all</button></div>
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
        </aside>}

        {visiblePanels.cartesian && <aside className="ik-panel">
          <div className="panel-heading">
            <div className="panel-title"><button className="panel-visibility-button" type="button" title="Hide CARTESIAN" aria-label="Hide CARTESIAN column" onClick={() => setPanelVisible('cartesian', false)}><ViewIcon /></button><span className="eyebrow">CARTESIAN</span></div>
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
        </aside>}
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
