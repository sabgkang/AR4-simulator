import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
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
import { CollisionWorld, type CollisionReport } from './collision';
import { modelFileExtension, ROBOT_MODEL_ID, type ImportedModelInfo, type ModelAdjustment, type ModelFileFormat, type ModelTransformKey } from './imported-model';
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

const MODEL_AXIS_KEYS = ['x', 'y', 'z'] as const;
const MODEL_ROTATION_KEYS = ['rx', 'ry', 'rz'] as const;
const MODEL_UNITS_TO_METERS = 0.001;
const ROBOT_MESH_COUNT = 3 + LINK_MESHES.reduce((total, meshes) => total + meshes.length, 0);

type CollisionReadiness = 'loading' | 'ready' | 'error';
type HighlightMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

function createModelGizmo(resources: Array<THREE.BufferGeometry | THREE.Material>) {
  const gizmo = new THREE.Group();
  gizmo.name = 'Imported model transform handles';
  gizmo.scale.setScalar(BASE_AXIS_LENGTH);
  const handles: THREE.Object3D[] = [];
  const rotationRoot = new THREE.Group();
  rotationRoot.name = 'Imported model rotation handles';
  gizmo.add(rotationRoot);

  AXES.forEach(({ direction, color }, index) => {
    const axisKey = MODEL_AXIS_KEYS[index];
    const material = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.96 });
    const shaftGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.78, 12);
    const headGeometry = new THREE.ConeGeometry(0.075, 0.22, 18);
    const pickGeometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 8);
    const shaft = new THREE.Mesh(shaftGeometry, material);
    const head = new THREE.Mesh(headGeometry, material);
    const pick = new THREE.Mesh(pickGeometry, new THREE.MeshBasicMaterial({ visible: false }));
    shaft.position.y = 0.39;
    head.position.y = 0.89;
    pick.position.y = 0.5;
    const arrow = new THREE.Group();
    arrow.add(shaft, head, pick);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    pick.userData.transformKey = axisKey;
    shaft.renderOrder = head.renderOrder = 40;
    handles.push(pick);
    gizmo.add(arrow);
    resources.push(shaftGeometry, headGeometry, pickGeometry, material, pick.material as THREE.Material);

    const arcStart = THREE.MathUtils.degToRad(index === 0 ? 110 : 20);
    const arcAngle = THREE.MathUtils.degToRad(50);
    const ringRadius = 0.7;
    const ringGeometry = new THREE.TorusGeometry(ringRadius, 0.035, 10, 36, arcAngle);
    const ringPickGeometry = new THREE.TorusGeometry(ringRadius, 0.1, 8, 28, arcAngle);
    const curveHeadGeometry = new THREE.ConeGeometry(0.09, 0.18, 16);
    const ring = new THREE.Mesh(ringGeometry, material);
    const ringPick = new THREE.Mesh(ringPickGeometry, new THREE.MeshBasicMaterial({ visible: false }));
    const curveHead = new THREE.Mesh(curveHeadGeometry, material);
    curveHead.position.set(ringRadius * Math.cos(arcAngle), ringRadius * Math.sin(arcAngle), 0);
    curveHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(arcAngle), Math.cos(arcAngle), 0));
    const arcGroup = new THREE.Group();
    arcGroup.rotation.z = arcStart;
    arcGroup.add(ring, ringPick, curveHead);
    const ringGroup = new THREE.Group();
    ringGroup.add(arcGroup);
    if (index === 0) ringGroup.rotation.y = Math.PI / 2;
    if (index === 1) ringGroup.rotation.x = Math.PI / 2;
    ringPick.userData.transformKey = MODEL_ROTATION_KEYS[index];
    ring.renderOrder = curveHead.renderOrder = 39;
    handles.push(ringPick);
    rotationRoot.add(ringGroup);
    resources.push(ringGeometry, ringPickGeometry, curveHeadGeometry, ringPick.material as THREE.Material);
  });
  return { gizmo, handles, rotationRoot };
}

function importedTransform(model: THREE.Group): ImportedModelInfo['transform'] {
  return {
    x: model.position.x * 1000,
    y: model.position.y * 1000,
    z: model.position.z * 1000,
    rx: THREE.MathUtils.radToDeg(model.rotation.x),
    ry: THREE.MathUtils.radToDeg(model.rotation.y),
    rz: THREE.MathUtils.radToDeg(model.rotation.z),
  };
}

export function useRobotScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  planTargets: PlanTarget[],
  setLoaded: Dispatch<SetStateAction<number>>,
  onModelAdjustment?: (adjustment: ModelAdjustment | null) => void,
  onModelSelectionChange?: (id: number | null) => void,
  showCollisionBoxes = false,
  collisionDetectionEnabled = true,
) {
  const jointRotors = useRef<THREE.Group[]>([]);
  const axes = useRef<THREE.Vector3[]>([]);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const targetFramesRef = useRef<THREE.Group | null>(null);
  const importedRootRef = useRef<THREE.Group | null>(null);
  const robotRootRef = useRef<THREE.Group | null>(null);
  const importedModelsRef = useRef(new Map<number, THREE.Group>());
  const nextImportedModelIdRef = useRef(1);
  const activeModelRef = useRef<THREE.Group | null>(null);
  const gizmoRef = useRef<THREE.Group | null>(null);
  const gizmoRotationRootRef = useRef<THREE.Group | null>(null);
  const importedResourcesRef = useRef<Array<THREE.BufferGeometry | THREE.Material>>([]);
  const collisionWorldRef = useRef(new CollisionWorld());
  const collisionBoxesRootRef = useRef<THREE.Group | null>(null);
  const collisionBoxHelpersRef = useRef(new Map<string, THREE.Box3Helper>());
  const collidingBodyIdsRef = useRef(new Set<string>());
  const collisionReadinessRef = useRef<CollisionReadiness>('loading');
  const [collisionReadiness, setCollisionReadiness] = useState<CollisionReadiness>('loading');
  const highlightedMaterialsRef = useRef<Array<{
    material: HighlightMaterial;
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  }>>([]);
  const adjustmentCallbackRef = useRef(onModelAdjustment);
  const selectionCallbackRef = useRef(onModelSelectionChange);

  useEffect(() => {
    adjustmentCallbackRef.current = onModelAdjustment;
  }, [onModelAdjustment]);

  useEffect(() => {
    selectionCallbackRef.current = onModelSelectionChange;
  }, [onModelSelectionChange]);

  const selectImportedModel = useCallback((id: number | null) => {
    const model = id === null ? null : importedModelsRef.current.get(id) ?? null;
    const gizmo = gizmoRef.current;
    activeModelRef.current = model;
    if (gizmo) {
      gizmo.visible = model !== null && model.visible;
      if (model) gizmo.position.copy(model.position);
    }
    if (model && gizmoRotationRootRef.current) gizmoRotationRootRef.current.quaternion.copy(model.quaternion);
    adjustmentCallbackRef.current?.(null);
    selectionCallbackRef.current?.(model ? id : null);
  }, []);

  const clearCollisionHighlight = useCallback(() => {
    highlightedMaterialsRef.current.forEach(({ material, color, emissive, emissiveIntensity }) => {
      if (color && material.color) material.color.copy(color);
      if (emissive && material.emissive) material.emissive.copy(emissive);
      if (emissiveIntensity !== undefined) material.emissiveIntensity = emissiveIntensity;
    });
    highlightedMaterialsRef.current = [];
    collidingBodyIdsRef.current.clear();
    collisionBoxHelpersRef.current.forEach((helper) => {
      const material = helper.material as THREE.LineBasicMaterial;
      material.color.set(helper.userData.collisionKind === 'environment' ? 0xf59e0b : 0x22c55e);
    });
  }, []);

  const setCollisionHighlight = useCallback((report: CollisionReport | null) => {
    clearCollisionHighlight();
    if (!report?.collided) return;
    const bodyIds = new Set(report.hits.flatMap((hit) => [hit.bodyAId, hit.bodyBId]));
    collidingBodyIdsRef.current = bodyIds;
    collisionBoxHelpersRef.current.forEach((helper, bodyId) => {
      const material = helper.material as THREE.LineBasicMaterial;
      material.color.set(bodyIds.has(bodyId) ? 0xef4444 : helper.userData.collisionKind === 'environment' ? 0xf59e0b : 0x22c55e);
    });
    const seen = new Set<THREE.Material>();
    collisionWorldRef.current.meshesForBodies(bodyIds).forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((source) => {
        if (seen.has(source)) return;
        seen.add(source);
        const material = source as HighlightMaterial;
        highlightedMaterialsRef.current.push({
          material,
          color: material.color?.clone(),
          emissive: material.emissive?.clone(),
          emissiveIntensity: material.emissiveIntensity,
        });
        material.color?.set(0xef4444);
        material.emissive?.set(0x7f1d1d);
        if (material.emissiveIntensity !== undefined) material.emissiveIntensity = Math.max(0.65, material.emissiveIntensity);
      });
    });
  }, [clearCollisionHighlight]);

  const checkCurrentCollision = useCallback((collectAll = false) => {
    if (!collisionDetectionEnabled) return { collided: false, hits: [] };
    if (collisionReadinessRef.current === 'loading') throw new Error('Collision model is still loading. Try again in a moment.');
    if (collisionReadinessRef.current === 'error') throw new Error('Collision model could not be prepared because a robot mesh failed to load.');
    return collisionWorldRef.current.detect({ collectAll });
  }, [collisionDetectionEnabled]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const collisionWorld = collisionWorldRef.current;
    const collisionBoxHelpers = collisionBoxHelpersRef.current;
    collisionWorld.reset();
    collisionReadinessRef.current = 'loading';
    setCollisionReadiness('loading');
    clearCollisionHighlight();
    let robotMeshesSettled = 0;
    let robotMeshFailures = 0;
    let sceneActive = true;
    const settleRobotCollisionMesh = (failed: boolean) => {
      robotMeshesSettled += 1;
      if (failed) robotMeshFailures += 1;
      if (!sceneActive || robotMeshesSettled !== ROBOT_MESH_COUNT) return;
      const readiness: CollisionReadiness = robotMeshFailures === 0 ? 'ready' : 'error';
      collisionReadinessRef.current = readiness;
      setCollisionReadiness(readiness);
    };
    const canvas = canvasRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f6f9);
    scene.fog = new THREE.Fog(0xf4f6f9, 1.8, 3.4);
    const targetFrames = new THREE.Group();
    targetFrames.name = 'Plan targets';
    scene.add(targetFrames);
    const collisionBoxesRoot = new THREE.Group();
    collisionBoxesRoot.name = 'Collision boxes';
    collisionBoxesRoot.visible = false;
    scene.add(collisionBoxesRoot);
    collisionBoxesRootRef.current = collisionBoxesRoot;
    targetFramesRef.current = targetFrames;
    const importedRoot = new THREE.Group();
    importedRoot.name = 'Imported models';
    scene.add(importedRoot);
    importedRootRef.current = importedRoot;
    const robotRoot = new THREE.Group();
    robotRoot.name = 'AR4-MK5';
    robotRoot.rotation.order = 'XYZ';
    robotRoot.userData.importedModelId = ROBOT_MODEL_ID;
    scene.add(robotRoot);
    robotRootRef.current = robotRoot;
    importedModelsRef.current.set(ROBOT_MODEL_ID, robotRoot);

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

    const loadMesh = (
      parent: THREE.Object3D,
      name: string,
      transform: { xyz: readonly number[]; rpy: readonly number[] } = { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      collisionBody?: { id: string; name: string; checkGround: boolean },
    ) => {
      loader.load(MESH_ROOT + name, (geometry) => {
        geometry.computeVertexNormals();
        const material = materialFor(name);
        const mesh = new THREE.Mesh(geometry, material);
        setFrame(mesh, transform.xyz, transform.rpy);
        mesh.castShadow = true; mesh.receiveShadow = true;
        parent.add(mesh);
        if (collisionBody) {
          collisionWorld.registerRobotMesh(collisionBody.id, collisionBody.name, mesh, collisionBody.checkGround);
          settleRobotCollisionMesh(false);
        }
        disposables.push(geometry, material);
        setLoaded((value) => value + 1);
      }, undefined, () => {
        if (collisionBody) settleRobotCollisionMesh(true);
        setLoaded((value) => value + 1);
      });
    };

    const baseCollisionBody = { id: 'robot-base', name: 'Base', checkGround: false };
    loadMesh(robotRoot, 'Link_Base_Aluminum.STL', undefined, baseCollisionBody);
    loadMesh(robotRoot, 'Link_Base_Enclosure.STL', undefined, baseCollisionBody);
    loadMesh(robotRoot, 'Link_Base_Motor.STL', undefined, baseCollisionBody);

    jointRotors.current = [];
    axes.current = [];
    let parent: THREE.Object3D = robotRoot;
    JOINT_FRAMES.forEach((frame, index) => {
      const fixedFrame = new THREE.Group();
      setFrame(fixedFrame, frame.xyz, frame.rpy);
      parent.add(fixedFrame);
      const rotor = new THREE.Group();
      fixedFrame.add(rotor);
      jointRotors.current.push(rotor);
      axes.current.push(new THREE.Vector3(...frame.axis));
      const collisionBody = { id: `robot-link-${index + 1}`, name: `Link ${index + 1}`, checkGround: true };
      LINK_MESHES[index].forEach((name) => loadMesh(rotor, name, LINK_MESH_TRANSFORMS[index], collisionBody));
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

    const { gizmo, handles, rotationRoot } = createModelGizmo(disposables);
    gizmo.visible = false;
    scene.add(gizmo);
    gizmoRef.current = gizmo;
    gizmoRotationRootRef.current = rotationRoot;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let drag: { key: ModelTransformKey; startX: number; startY: number; startValue: number; projectedPixels: number } | null = null;
    let clickStart: { x: number; y: number } | null = null;
    const setPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const projectedAxisPixels = (key: ModelTransformKey) => {
      const axisIndex = key === 'x' ? 0 : key === 'y' ? 1 : 2;
      const arrowLength = gizmo.scale.x;
      const origin = gizmo.position.clone().project(camera);
      const end = gizmo.position.clone().add(AXES[axisIndex].direction.clone().multiplyScalar(arrowLength)).project(camera);
      const rect = canvas.getBoundingClientRect();
      return Math.max(12, Math.hypot((end.x - origin.x) * rect.width / 2, (end.y - origin.y) * rect.height / 2));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      clickStart = { x: event.clientX, y: event.clientY };
      if (!activeModelRef.current || !gizmo.visible) return;
      setPointer(event);
      const hit = raycaster.intersectObjects(handles, false)[0];
      const key = hit?.object.userData.transformKey as ModelTransformKey | undefined;
      if (!key) return;
      event.preventDefault();
      event.stopPropagation();
      canvas.setPointerCapture(event.pointerId);
      controls.enabled = false;
      const current = importedTransform(activeModelRef.current)[key];
      drag = { key, startX: event.clientX, startY: event.clientY, startValue: current, projectedPixels: projectedAxisPixels(key) };
      adjustmentCallbackRef.current?.({ key, value: current, phase: 'dragging', cursorX: event.clientX, cursorY: event.clientY });
    };
    const onPointerMove = (event: PointerEvent) => {
      const model = activeModelRef.current;
      if (!drag || !model) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      let value: number;
      if (drag.key.startsWith('r')) {
        value = drag.startValue + (dx - dy) * 0.6;
        model.rotation[drag.key.slice(1) as 'x' | 'y' | 'z'] = THREE.MathUtils.degToRad(value);
        rotationRoot.quaternion.copy(model.quaternion);
      } else {
        const axisIndex = MODEL_AXIS_KEYS.indexOf(drag.key as 'x' | 'y' | 'z');
        const origin = gizmo.position.clone().project(camera);
        const end = gizmo.position.clone().add(AXES[axisIndex].direction.clone().multiplyScalar(0.15)).project(camera);
        const screenX = end.x - origin.x;
        const screenY = -(end.y - origin.y);
        const length = Math.max(0.0001, Math.hypot(screenX, screenY));
        const signedPixels = (dx * screenX + dy * screenY) / length;
        const arrowLengthMm = gizmo.scale.x * 1000;
        value = drag.startValue + signedPixels / drag.projectedPixels * arrowLengthMm;
        model.position[drag.key as 'x' | 'y' | 'z'] = value / 1000;
        gizmo.position.copy(model.position);
      }
      adjustmentCallbackRef.current?.({ key: drag.key, value, phase: 'dragging', cursorX: event.clientX, cursorY: event.clientY });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (drag) {
        const completed = drag;
        drag = null;
        clickStart = null;
        controls.enabled = true;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        const model = activeModelRef.current;
        if (model) adjustmentCallbackRef.current?.({ key: completed.key, value: importedTransform(model)[completed.key], phase: 'editing', cursorX: event.clientX, cursorY: event.clientY });
        return;
      }
      if (!clickStart || event.type === 'pointercancel') { clickStart = null; return; }
      const moved = Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y);
      clickStart = null;
      if (moved > 5) return;
      setPointer(event);
      const selectableModels = [...importedModelsRef.current.values()].filter((model) => model.visible);
      const hit = raycaster.intersectObjects(selectableModels, true)[0]?.object;
      let candidate: THREE.Object3D | null = hit ?? null;
      while (candidate && typeof candidate.userData.importedModelId !== 'number') candidate = candidate.parent;
      selectImportedModel(candidate ? candidate.userData.importedModelId as number : null);
    };
    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('pointerup', onPointerUp, true);
    canvas.addEventListener('pointercancel', onPointerUp, true);

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
    const updateCollisionBoxes = () => {
      if (!collisionBoxesRoot.visible) return;
      const activeIds = new Set<string>();
      collisionWorld.debugBounds().forEach((body) => {
        activeIds.add(body.bodyId);
        let helper = collisionBoxHelpers.get(body.bodyId);
        if (!helper) {
          const color = collidingBodyIdsRef.current.has(body.bodyId) ? 0xef4444 : body.kind === 'environment' ? 0xf59e0b : 0x22c55e;
          helper = new THREE.Box3Helper(body.box.clone(), color);
          helper.name = `Collision box: ${body.bodyName}`;
          helper.userData.collisionKind = body.kind;
          helper.renderOrder = 30;
          (helper.material as THREE.LineBasicMaterial).depthTest = false;
          collisionBoxHelpers.set(body.bodyId, helper);
          collisionBoxesRoot.add(helper);
        } else {
          helper.box.copy(body.box);
        }
      });
      collisionBoxHelpers.forEach((helper, bodyId) => {
        if (activeIds.has(bodyId)) return;
        helper.removeFromParent();
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
        collisionBoxHelpers.delete(bodyId);
      });
    };
    const render = () => {
      controls.update();
      updateCollisionBoxes();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      sceneActive = false;
      observer.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(frameId); controls.dispose(); renderer.dispose();
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('pointerup', onPointerUp, true);
      canvas.removeEventListener('pointercancel', onPointerUp, true);
      targetFramesRef.current = null;
      collisionBoxesRootRef.current = null;
      importedRootRef.current = null;
      robotRootRef.current = null;
      activeModelRef.current = null;
      importedModelsRef.current.clear();
      gizmoRef.current = null;
      gizmoRotationRootRef.current = null;
      clearCollisionHighlight();
      collisionWorld.reset();
      collisionReadinessRef.current = 'loading';
      collisionBoxHelpers.forEach((helper) => {
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
      });
      collisionBoxHelpers.clear();
      disposables.forEach((item) => item.dispose());
      importedResourcesRef.current.forEach((item) => item.dispose());
      importedResourcesRef.current = [];
    };
  }, [canvasRef, clearCollisionHighlight, selectImportedModel, setLoaded]);

  useEffect(() => {
    if (collisionBoxesRootRef.current) collisionBoxesRootRef.current.visible = showCollisionBoxes;
  }, [showCollisionBoxes]);

  useEffect(() => {
    if (!collisionDetectionEnabled) clearCollisionHighlight();
  }, [clearCollisionHighlight, collisionDetectionEnabled]);

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

  const importModel = useCallback(async (file: File, sourcePath: string): Promise<ImportedModelInfo> => {
    const root = importedRootRef.current;
    const gizmo = gizmoRef.current;
    if (!root || !gizmo) throw new Error('3D view is not ready yet.');
    const extension = modelFileExtension(file);
    if (!['stl', 'step', 'stp'].includes(extension)) throw new Error('Only STL and STEP files are supported.');

    const buffer = await file.arrayBuffer();
    const model = new THREE.Group();
    model.name = file.name;
    model.rotation.order = 'XYZ';
    const content = new THREE.Group();
    content.scale.setScalar(MODEL_UNITS_TO_METERS);
    model.add(content);

    if (extension === 'stl') {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.48, metalness: 0.22 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      content.add(mesh);
      importedResourcesRef.current.push(geometry, material);
    } else {
      const { default: createOcct } = await import('occt-import-js');
      const occt = await createOcct({ locateFile: () => '/occt-import-js.wasm' });
      const result = occt.ReadStepFile(new Uint8Array(buffer), { linearUnit: 'millimeter' });
      if (!result.success || result.meshes.length === 0) throw new Error('The STEP file contains no readable geometry.');
      result.meshes.forEach((source) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.attributes.position.array, 3));
        if (source.attributes.normal) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.attributes.normal.array, 3));
        else geometry.computeVertexNormals();
        geometry.setIndex(new THREE.Uint32BufferAttribute(source.index.array, 1));
        const color = source.color ? new THREE.Color(...source.color) : new THREE.Color(0x94a3b8);
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.2, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = source.name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        content.add(mesh);
        importedResourcesRef.current.push(geometry, material);
      });
    }

    const id = nextImportedModelIdRef.current++;
    const name = `Object${id}`;
    model.name = name;
    model.userData.importedModelId = id;
    root.add(model);
    importedModelsRef.current.set(id, model);
    collisionWorldRef.current.registerEnvironment(id, name, model);
    gizmo.scale.setScalar(BASE_AXIS_LENGTH);
    selectImportedModel(id);
    return {
      id,
      name,
      filename: file.name,
      format: extension as ModelFileFormat,
      sourcePath,
      visible: true,
      transform: importedTransform(model),
    };
  }, [selectImportedModel]);

  const setImportedModelTransform = useCallback((key: ModelTransformKey, value: number) => {
    const model = activeModelRef.current;
    const gizmo = gizmoRef.current;
    if (!model || !Number.isFinite(value)) return;
    if (key.startsWith('r')) model.rotation[key.slice(1) as 'x' | 'y' | 'z'] = THREE.MathUtils.degToRad(value);
    else model.position[key as 'x' | 'y' | 'z'] = value / 1000;
    if (gizmo) gizmo.position.copy(model.position);
    if (gizmoRotationRootRef.current) gizmoRotationRootRef.current.quaternion.copy(model.quaternion);
    adjustmentCallbackRef.current?.(null);
  }, []);

  const setImportedModelVisible = useCallback((id: number, visible: boolean) => {
    if (id === ROBOT_MODEL_ID) return;
    const model = importedModelsRef.current.get(id);
    if (!model) return;
    model.visible = visible;
    if (!visible && activeModelRef.current === model) selectImportedModel(null);
  }, [selectImportedModel]);

  const setImportedModelPose = useCallback((id: number, transform: ImportedModelInfo['transform']) => {
    const model = importedModelsRef.current.get(id);
    if (!model) return;
    model.position.set(transform.x / 1000, transform.y / 1000, transform.z / 1000);
    model.rotation.set(
      THREE.MathUtils.degToRad(transform.rx),
      THREE.MathUtils.degToRad(transform.ry),
      THREE.MathUtils.degToRad(transform.rz),
      'XYZ',
    );
    if (activeModelRef.current === model) {
      gizmoRef.current?.position.copy(model.position);
      gizmoRotationRootRef.current?.quaternion.copy(model.quaternion);
    }
  }, []);

  const getImportedModelTransform = useCallback((id: number) => {
    const model = importedModelsRef.current.get(id);
    return model ? importedTransform(model) : null;
  }, []);

  const renameImportedModel = useCallback((id: number, name: string) => {
    const model = importedModelsRef.current.get(id);
    if (model) model.name = name;
    collisionWorldRef.current.renameEnvironment(id, name);
  }, []);

  const removeImportedModel = useCallback((id: number) => {
    if (id === ROBOT_MODEL_ID) return;
    const model = importedModelsRef.current.get(id);
    if (!model) return;
    if (activeModelRef.current === model) selectImportedModel(null);
    collisionWorldRef.current.unregisterEnvironment(id);
    model.removeFromParent();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    importedModelsRef.current.delete(id);
  }, [selectImportedModel]);

  return {
    jointRotors,
    axes,
    cameraRef,
    controlsRef,
    robotRootRef,
    collisionReadiness,
    checkCurrentCollision,
    setCollisionHighlight,
    importModel,
    setImportedModelTransform,
    selectImportedModel,
    setImportedModelVisible,
    setImportedModelPose,
    getImportedModelTransform,
    renameImportedModel,
    removeImportedModel,
  };
}
