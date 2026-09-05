import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
  BASE_AXIS_LENGTH,
  BASE_AXIS_THICKNESS,
  JOINT_FRAMES,
  LINK_MESHES,
  LINK_MESH_TRANSFORMS,
  MESH_ROOT,
  TCP_AXIS_LENGTH,
  TCP_AXIS_THICKNESS,
  TCP_FRAME_ROTATION_Z,
  TOOL_TIP_MARKER_RADIUS,
  TOOL_TIP_OFFSET,
} from './config';
import { setFrame } from './kinematics';
import type { PlanTarget } from './types';

function materialFor(name: string) {
  let color = 0xb8c0cc, roughness = 0.42, metalness = 0.58;
  if (name.includes('Motor')) { color = 0x20242b; roughness = 0.6; metalness = 0.25; }
  else if (name.includes('Cover')) { color = 0xf4f5f7; roughness = 0.72; metalness = 0.04; }
  else if (name.includes('Logo')) { color = 0x1746e0; roughness = 0.5; metalness = 0.08; }
  else if (name.includes('Enclosure')) { color = 0xe9edf2; roughness = 0.78; metalness = 0.03; }
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

const AXES = [
  { direction: new THREE.Vector3(1, 0, 0), color: 0xef233c },
  { direction: new THREE.Vector3(0, 1, 0), color: 0x16a34a },
  { direction: new THREE.Vector3(0, 0, 1), color: 0x2563eb },
];

export function useRobotScene(canvasRef: RefObject<HTMLCanvasElement | null>, planTargets: PlanTarget[], setLoaded: Dispatch<SetStateAction<number>>) {
  const jointRotors = useRef<THREE.Group[]>([]);
  const axes = useRef<THREE.Vector3[]>([]);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const targetFramesRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f6f9);
    scene.fog = new THREE.Fog(0xf4f6f9, 1.8, 3.4);
    const targetFrames = new THREE.Group();
    targetFrames.name = 'Plan targets';
    scene.add(targetFrames);
    targetFramesRef.current = targetFrames;

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
    AXES.forEach(({ direction, color }) => {
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

    const loadMesh = (parent: THREE.Object3D, name: string, transform: { xyz: readonly number[]; rpy: readonly number[] } = { xyz: [0, 0, 0], rpy: [0, 0, 0] }) => {
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
      axes.current.push(new THREE.Vector3(...frame.axis));
      LINK_MESHES[index].forEach((name) => loadMesh(rotor, name, LINK_MESH_TRANSFORMS[index]));
      parent = rotor;
    });

    const toolTipGeometry = new THREE.SphereGeometry(TOOL_TIP_MARKER_RADIUS, 32, 20);
    const toolTipMaterial = new THREE.MeshStandardMaterial({ color: 0xe11d48, emissive: 0x4a0617, emissiveIntensity: 0.35, roughness: 0.32, metalness: 0.08 });
    const tcpFrame = new THREE.Group();
    tcpFrame.name = 'TCP frame';
    tcpFrame.position.set(0, 0, TOOL_TIP_OFFSET);
    tcpFrame.rotation.z = TCP_FRAME_ROTATION_Z;
    const toolTipMarker = new THREE.Mesh(toolTipGeometry, toolTipMaterial);
    toolTipMarker.name = 'Tool tip center';
    toolTipMarker.castShadow = true;
    toolTipMarker.receiveShadow = true;
    tcpFrame.add(toolTipMarker);
    AXES.forEach(({ direction, color }) => {
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
      targetFramesRef.current = null;
      disposables.forEach((item) => item.dispose());
    };
  }, [canvasRef, setLoaded]);

  useEffect(() => {
    const root = targetFramesRef.current;
    if (!root) return;
    root.clear();
    const resources: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
    planTargets.filter((target) => target.visible).forEach((target) => {
      const marker = new THREE.Group();
      marker.position.set(target.pose.x / 1000, target.pose.y / 1000, target.pose.z / 1000);
      const targetFrame = new THREE.Group();
      targetFrame.rotation.set(THREE.MathUtils.degToRad(target.pose.rx), THREE.MathUtils.degToRad(target.pose.ry), THREE.MathUtils.degToRad(target.pose.rz), 'XYZ');
      const originGeometry = new THREE.SphereGeometry(TOOL_TIP_MARKER_RADIUS, 32, 20);
      const originMaterial = new THREE.MeshStandardMaterial({ color: 0xe11d48, emissive: 0x4a0617, emissiveIntensity: 0.35, roughness: 0.32, metalness: 0.08 });
      targetFrame.add(new THREE.Mesh(originGeometry, originMaterial));
      resources.push(originGeometry, originMaterial);
      AXES.forEach(({ direction, color }) => {
        const headLength = 0.014;
        const shaftLength = TCP_AXIS_LENGTH - headLength;
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.05 });
        const shaftGeometry = new THREE.CylinderGeometry(TCP_AXIS_THICKNESS / 2, TCP_AXIS_THICKNESS / 2, shaftLength, 16);
        const headGeometry = new THREE.CylinderGeometry(0, TCP_AXIS_THICKNESS * 1.4, headLength, 20);
        const shaft = new THREE.Mesh(shaftGeometry, material);
        const head = new THREE.Mesh(headGeometry, material);
        shaft.position.y = shaftLength / 2;
        head.position.y = shaftLength + headLength / 2;
        const arrow = new THREE.Group();
        arrow.add(shaft, head);
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        targetFrame.add(arrow);
        resources.push(shaftGeometry, headGeometry, material);
      });
      marker.add(targetFrame);

      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = 256;
      labelCanvas.height = 64;
      const context = labelCanvas.getContext('2d');
      if (context) {
        context.fillStyle = 'rgba(255,255,255,.94)';
        context.strokeStyle = '#cfd6e2';
        context.lineWidth = 3;
        context.beginPath();
        context.roundRect(2, 2, 252, 60, 11);
        context.fill();
        context.stroke();
        context.fillStyle = '#1d2939';
        context.font = '700 27px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(target.name, 128, 33, 232);
      }
      const texture = new THREE.CanvasTexture(labelCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const labelMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
      const label = new THREE.Sprite(labelMaterial);
      label.position.set(0, 0, 0.045);
      label.scale.set(0.09, 0.0225, 1);
      label.renderOrder = 21;
      marker.add(label);
      resources.push(texture, labelMaterial);
      root.add(marker);
    });

    return () => {
      root.clear();
      resources.forEach((resource) => resource.dispose());
    };
  }, [planTargets]);

  return { jointRotors, axes, cameraRef, controlsRef };
}
