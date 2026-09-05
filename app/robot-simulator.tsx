'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createJointMotion, DEFAULT_MAX_SPEEDS, type JointValues } from './teensy-motion';
import { buildLinearWaypoints, createLinearMotionSequence, type CartesianPose, type ExternalAxes, type LinearJointWaypoint } from './teensy-linear-motion';
import { createPositionResponse, HELLO_RESPONSE, type TcpValues } from './simulator-protocol';
import { AnglesPanel, CartesianPanel } from './robot-simulator/control-panels';
import { DEFAULT_JOINT_RANGES, DEFAULT_MOTOR_SPEEDS, JOINT_ZERO_OFFSETS, PRESETS, TOOL_TIP_OFFSET } from './robot-simulator/config';
import { saveJsonFile } from './robot-simulator/file-io';
import { DeleteIcon, EditIcon, ExportIcon, GearIcon, HiddenIcon, LoadIcon, PlusIcon, PreviewIcon, RunIcon, SaveIcon, ViewIcon } from './robot-simulator/icons';
import { angularDifferenceDegrees, getTcpWorldQuaternion, rotationVector, solveLinearSystem } from './robot-simulator/kinematics';
import { chainPlanCommands, createPlanFilename, parsePlan, serializePlan } from './robot-simulator/plan';
import { CommandDialog, TargetDialog } from './robot-simulator/plan-dialogs';
import { createSettingsFilename, parseSettings, serializeSettings, type SimulatorSettings } from './robot-simulator/settings-file';
import { SettingsModal } from './robot-simulator/settings-modal';
import type { CommandResponse, IkTarget, JointRange, MotionCommand, PanelKey, PlanCommand, PlanTarget, Pose, SerialPortLike, SettingsCategory, StatusMessage, TcpPose, TestCommandName } from './robot-simulator/types';
import { useRobotScene } from './robot-simulator/use-robot-scene';

declare global {
  interface Window {
    ar4Simulator?: { executeCommand: (command: unknown) => Promise<CommandResponse> };
  }
}

export default function RobotSimulator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const nextTargetIdRef = useRef(1);
  const nextCommandIdRef = useRef(1);
  const planFileInputRef = useRef<HTMLInputElement>(null);
  const planLoadRequestRef = useRef(0);
  const settingsLoadRequestRef = useRef(0);
  const homeTargetInitializedRef = useRef(false);
  const anglesRef = useRef<Pose>(PRESETS.Home);
  const tcpRef = useRef<TcpPose>({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  const externalAxesRef = useRef<[number, number, number]>([0, 0, 0]);
  const runningRef = useRef(false);
  const planExecutionRef = useRef<'preview' | 'run' | null>(null);
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
  const [auxiliarySerialPortNames, setAuxiliarySerialPortNames] = useState<string[]>([]);
  const [serialMessage, setSerialMessage] = useState<string | null>(null);
  const [settingsFilename, setSettingsFilename] = useState('Default settings');
  const [settingsFileMessage, setSettingsFileMessage] = useState<StatusMessage | null>(null);
  const [visiblePanels, setVisiblePanels] = useState<Record<PanelKey, boolean>>({ plan: true, angles: true, cartesian: true });
  const [planTargets, setPlanTargets] = useState<PlanTarget[]>([]);
  const [planCommands, setPlanCommands] = useState<PlanCommand[]>([]);
  const [commandInsertAfterId, setCommandInsertAfterId] = useState<number | null>(null);
  const [pendingCommandType, setPendingCommandType] = useState<PlanCommand['type'] | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [targetDraft, setTargetDraft] = useState<PlanTarget | null>(null);
  const [commandDraft, setCommandDraft] = useState<PlanCommand | null>(null);
  const [planFileMessage, setPlanFileMessage] = useState<StatusMessage | null>(null);
  const [planFilename, setPlanFilename] = useState<string | null>(null);
  const [planExecution, setPlanExecution] = useState<'preview' | 'run' | null>(null);
  const [planExecutionMessage, setPlanExecutionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const { jointRotors, axes, cameraRef, controlsRef } = useRobotScene(canvasRef, planTargets, setLoaded);

  const applySettings = useCallback((settings: SimulatorSettings) => {
    setJointRanges(settings.jointRanges.map((range) => ({ ...range })));
    setMotorSpeeds([...settings.motorSpeeds] as Pose);
    setSpeedPercent(settings.motion.speedPercent);
    setAccelerationPercent(settings.motion.accelerationPercent);
    setDecelerationPercent(settings.motion.decelerationPercent);
    setSerialPortName('No COM port selected');
    setAuxiliarySerialPortNames(settings.serial.auxiliaryPortNames.map(() => 'No COM port selected'));
    setAngles((current) => current.map((angle, index) => Math.min(settings.jointRanges[index].max, Math.max(settings.jointRanges[index].min, angle))) as Pose);
  }, [setAccelerationPercent, setAngles, setAuxiliarySerialPortNames, setDecelerationPercent, setJointRanges, setMotorSpeeds, setSerialPortName, setSpeedPercent]);

  const currentSettings = (): SimulatorSettings => ({
    version: 1,
    jointRanges: jointRanges.map((range) => ({ ...range })),
    motorSpeeds: [...motorSpeeds] as Pose,
    motion: { speedPercent, accelerationPercent, decelerationPercent },
    serial: { portName: serialPortName, auxiliaryPortNames: [...auxiliarySerialPortNames] },
  });

  const saveSettings = async () => {
    setSettingsFileMessage(null);
    const filename = createSettingsFilename();
    const settings = currentSettings();
    try {
      const result = await saveJsonFile(filename, serializeSettings(settings));
      if (result.status === 'saved') {
        setSettingsFilename(result.filename);
        setSettingsFileMessage({ type: 'success', text: 'Settings saved.' });
      } else if (result.status === 'download-started') {
        setSettingsFileMessage({ type: 'info', text: 'Download started. Confirm the file in your browser.' });
      }
    } catch (error) {
      setSettingsFileMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to save settings.' });
    }
  };

  const loadSettings = async (file: File) => {
    if (runningRef.current || planExecutionRef.current !== null) {
      setSettingsFileMessage({ type: 'error', text: 'Stop the current motion before loading settings.' });
      return;
    }
    const requestId = ++settingsLoadRequestRef.current;
    try {
      const settings = parseSettings(JSON.parse(await file.text()) as unknown);
      if (requestId !== settingsLoadRequestRef.current) return;
      if (runningRef.current || planExecutionRef.current !== null) {
        setSettingsFileMessage({ type: 'error', text: 'Settings were not loaded because a motion started.' });
        return;
      }
      applySettings(settings);
      setSerialMessage('Select serial ports again after loading settings.');
      setSettingsFilename(file.name);
      setSettingsFileMessage({ type: 'success', text: 'Settings loaded.' });
    } catch (error) {
      if (requestId !== settingsLoadRequestRef.current) return;
      setSettingsFileMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to load settings.' });
    }
  };

  const setPanelVisible = (panel: PanelKey, visible: boolean) => {
    setVisiblePanels((current) => ({ ...current, [panel]: visible }));
  };
  const visiblePanelCount = Object.values(visiblePanels).filter(Boolean).length;
  const stackCartesian = visiblePanels.angles && visiblePanels.cartesian;
  const visibleColumnCount = visiblePanelCount - (stackCartesian ? 1 : 0);
  const addTargetAfter = (afterId: number) => {
    const id = nextTargetIdRef.current++;
    const target = { id, name: `Target${id}`, pose: { ...tcpRef.current }, visible: true };
    setPlanTargets((current) => {
      const index = current.findIndex((candidate) => candidate.id === afterId);
      if (index < 0) return [...current, target];
      return [...current.slice(0, index + 1), target, ...current.slice(index + 1)];
    });
  };

  const toggleTargetVisibility = (id: number) => {
    setPlanTargets((current) => current.map((target) => target.id === id ? { ...target, visible: !target.visible } : target));
  };

  const deleteTarget = (id: number) => {
    const remainingTargets = planTargets.filter((target) => target.id !== id);
    setPlanTargets(remainingTargets);
    setPlanCommands((current) => chainPlanCommands(
      current.filter((command) => command.startTargetId !== id && command.endTargetId !== id),
      current[0]?.startTargetId ?? null,
    ));
  };

  const deletePlanCommand = (id: number) => {
    setPlanCommands((current) => chainPlanCommands(
      current.filter((command) => command.id !== id),
      current[0]?.startTargetId ?? null,
    ));
  };

  const addPlanCommand = (type: PlanCommand['type']) => {
    if (commandInsertAfterId === null || planTargets.length < 1) return;
    setPendingCommandType(type);
  };

  const addPlanCommandToTarget = (endTargetId: number) => {
    if (!pendingCommandType || commandInsertAfterId === null) return;
    setPlanCommands((current) => {
      const index = current.findIndex((command) => command.id === commandInsertAfterId);
      if (index < 0) return current;
      const inserted: PlanCommand = {
        id: nextCommandIdRef.current++,
        type: pendingCommandType,
        startTargetId: current[index].endTargetId,
        endTargetId,
        speed: speedPercent,
        acceleration: accelerationPercent,
        deceleration: decelerationPercent,
      };
      const next = [...current.slice(0, index + 1), inserted, ...current.slice(index + 1)];
      return chainPlanCommands(next, next[0]?.startTargetId ?? null);
    });
    setPendingCommandType(null);
    setCommandInsertAfterId(null);
  };

  const addFirstPlanCommand = () => {
    const firstTarget = planTargets[0];
    if (!firstTarget) return;
    const command: PlanCommand = {
      id: nextCommandIdRef.current++,
      type: 'move_j',
      startTargetId: null,
      endTargetId: firstTarget.id,
      speed: speedPercent,
      acceleration: accelerationPercent,
      deceleration: decelerationPercent,
    };
    setPlanCommands((current) => current.length === 0 ? [command] : current);
  };

  const savePlan = async () => {
    setPlanFileMessage(null);
    const filename = createPlanFilename();
    try {
      const result = await saveJsonFile(filename, serializePlan(planTargets, planCommands));
      if (result.status === 'saved') {
        setPlanFilename(result.filename);
        setPlanFileMessage({ type: 'success', text: 'Plan saved.' });
      } else if (result.status === 'download-started') {
        setPlanFileMessage({ type: 'info', text: 'Download started. Confirm the file in your browser.' });
      }
    } catch (error) {
      setPlanFileMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to save plan.' });
    }
  };

  const loadPlan = async (file: File) => {
    if (runningRef.current || planExecutionRef.current !== null) {
      setPlanFileMessage({ type: 'error', text: 'Stop the current motion before loading a plan.' });
      return;
    }
    const requestId = ++planLoadRequestRef.current;
    try {
      const { targets, commands } = parsePlan(JSON.parse(await file.text()) as unknown);
      if (requestId !== planLoadRequestRef.current) return;
      if (runningRef.current || planExecutionRef.current !== null) {
        setPlanFileMessage({ type: 'error', text: 'The plan was not loaded because a motion started.' });
        return;
      }
      setPlanTargets(targets);
      setPlanCommands(commands);
      setPlanFilename(file.name);
      homeTargetInitializedRef.current = true;
      nextTargetIdRef.current = Math.max(0, ...targets.map((target) => target.id)) + 1;
      nextCommandIdRef.current = Math.max(0, ...commands.map((command) => command.id)) + 1;
      setPlanFileMessage({ type: 'success', text: `Loaded ${targets.length} targets and ${commands.length} commands.` });
    } catch (error) {
      if (requestId !== planLoadRequestRef.current) return;
      setPlanFileMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to load plan.' });
    }
  };

  // Mutable Three.js scene refs are stable even though their contents load asynchronously.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
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
  }, [jointRotors]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
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
  }, [axes, jointRotors]);

  const fillCurrentPose = useCallback(() => {
    setIkTarget({
      x: tcp.x.toFixed(1), y: tcp.y.toFixed(1), z: tcp.z.toFixed(1),
      rx: tcp.rx.toFixed(1), ry: tcp.ry.toFixed(1), rz: tcp.rz.toFixed(1),
    });
    setIkMessage(null);
  }, [tcp, setIkTarget, setIkMessage]);

  useEffect(() => {
    if (loaded >= 18 && !ikInitialized.current) {
      ikInitialized.current = true;
      fillCurrentPose();
    }
  }, [loaded, fillCurrentPose]);

  useEffect(() => {
    if (loaded < 18 || homeTargetInitializedRef.current) return;
    homeTargetInitializedRef.current = true;
    const [x, y, z, rx, ry, rz] = getPoseForJoints(PRESETS.Home);
    const homeTarget: PlanTarget = { id: 1, name: 'HOME', pose: { x, y, z, rx, ry, rz }, visible: true };
    setPlanTargets((current) => {
      if (current.length > 0) return current;
      nextTargetIdRef.current = 2;
      return [homeTarget];
    });
    setPlanCommands((current) => {
      if (current.length > 0) return current;
      nextCommandIdRef.current = 2;
      return [{ id: 1, type: 'move_j', startTargetId: null, endTargetId: homeTarget.id, speed: speedPercent, acceleration: accelerationPercent, deceleration: decelerationPercent }];
    });
  }, [loaded, getPoseForJoints, speedPercent, accelerationPercent, decelerationPercent]);


  useEffect(() => {
    anglesRef.current = angles;
    jointRotors.current.forEach((rotor, index) => rotor.quaternion.setFromAxisAngle(
      axes.current[index],
      THREE.MathUtils.degToRad(angles[index]) + JOINT_ZERO_OFFSETS[index],
    ));
    const frame = requestAnimationFrame(updateTcp);
    return () => cancelAnimationFrame(frame);
  }, [angles, axes, jointRotors, updateTcp, loaded]);

  const setJoint = (index: number, value: number) => {
    if (runningRef.current) return;
    const range = jointRanges[index];
    const safeValue = Math.min(range.max, Math.max(range.min, value));
    setAngles((current) => current.map((angle, i) => i === index ? safeValue : angle) as Pose);
  };

  const moveToAsync = (target: Pose) => new Promise<void>((resolve, reject) => {
    if (runningRef.current) {
      reject(new Error('The robot is already moving.'));
      return;
    }
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const safeTarget = target.map((value, index) => Math.min(jointRanges[index].max, Math.max(jointRanges[index].min, value))) as Pose;
    const start = [...anglesRef.current] as Pose;
    const started = performance.now(), duration = 700;
    runningRef.current = true;
    setRunning(true);
    const step = (now: number) => {
      const raw = Math.min((now - started) / duration, 1), eased = 1 - Math.pow(1 - raw, 3);
      const next = start.map((value, i) => value + (safeTarget[i] - value) * eased) as Pose;
      anglesRef.current = next;
      setAngles(next);
      if (raw < 1) animationRef.current = requestAnimationFrame(step); else {
        runningRef.current = false;
        setRunning(false);
        resolve();
      }
    };
    animationRef.current = requestAnimationFrame(step);
  });

  const moveTo = (target: Pose) => {
    if (runningRef.current) return;
    void moveToAsync(target);
  };

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
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
  }, [axes, jointRanges, jointRotors]);

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

  const moveToPlanTarget = (target: PlanTarget) => {
    if (runningRef.current || loaded < 18) return;
    try {
      const { x, y, z, rx, ry, rz } = target.pose;
      const solution = solvePose([x, y, z, rx, ry, rz]);
      setIkMessage({ type: 'success', text: `Moving to ${target.name}.` });
      moveTo(solution.joints);
    } catch (error) {
      setIkMessage({ type: 'error', text: error instanceof Error ? error.message : `Unable to move to ${target.name}.` });
    }
  };

  const getPlanTarget = (id: number) => {
    const target = planTargets.find((candidate) => candidate.id === id);
    if (!target) throw new Error(`Target ${id} was not found.`);
    return target;
  };

  const targetPoseArray = (target: PlanTarget) => {
    const { x, y, z, rx, ry, rz } = target.pose;
    return [x, y, z, rx, ry, rz] as Pose;
  };

  const previewPlan = async () => {
    if (planExecutionRef.current || runningRef.current || planCommands.length === 0) return;
    planExecutionRef.current = 'preview';
    setPlanExecution('preview');
    setPlanExecutionMessage(null);
    try {
      const startTargetId = planCommands[0].startTargetId;
      if (startTargetId !== null) {
        const startTarget = getPlanTarget(startTargetId);
        await moveToAsync(solvePose(targetPoseArray(startTarget)).joints);
      }
      for (const command of planCommands) {
        const endTarget = getPlanTarget(command.endTargetId);
        await moveToAsync(solvePose(targetPoseArray(endTarget)).joints);
      }
      setPlanExecutionMessage({ type: 'success', text: 'Preview completed.' });
    } catch (error) {
      setPlanExecutionMessage({ type: 'error', text: error instanceof Error ? error.message : 'Preview failed.' });
    } finally {
      planExecutionRef.current = null;
      setPlanExecution(null);
    }
  };

  const runPlan = async () => {
    if (planExecutionRef.current || runningRef.current || planCommands.length === 0) return;
    planExecutionRef.current = 'run';
    setPlanExecution('run');
    setPlanExecutionMessage(null);
    try {
      const executeCommand = window.ar4Simulator?.executeCommand;
      if (!executeCommand) throw new Error('The simulator command API is not ready.');
      const startTargetId = planCommands[0].startTargetId;
      if (startTargetId !== null) {
        const startTarget = getPlanTarget(startTargetId);
        await moveToAsync(solvePose(targetPoseArray(startTarget)).joints);
      }
      for (const command of planCommands) {
        const endTarget = getPlanTarget(command.endTargetId);
        const response = await executeCommand({
          cmd: command.type,
          pose: targetPoseArray(endTarget),
          spd_type: 'percent',
          spd: command.speed,
          acc: command.acceleration,
          dec: command.deceleration,
          ramp: 50,
        });
        if ('msg' in response && response.msg === 'error') throw new Error(response.data);
      }
      setPlanExecutionMessage({ type: 'success', text: 'Plan completed.' });
    } catch (error) {
      setPlanExecutionMessage({ type: 'error', text: error instanceof Error ? error.message : 'Plan failed.' });
    } finally {
      planExecutionRef.current = null;
      setPlanExecution(null);
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

  const addAuxiliarySerialPort = () => {
    setAuxiliarySerialPortNames((current) => [...current, 'No COM port selected']);
  };

  const deleteAuxiliarySerialPort = (auxiliaryIndex: number) => {
    setAuxiliarySerialPortNames((current) => current.filter((_, index) => index !== auxiliaryIndex));
  };

  const requestSerialPort = async (auxiliaryIndex?: number) => {
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
      const selectedPortName = vendor && product ? `Selected port · USB ${vendor}:${product}` : 'Selected serial port';
      if (auxiliaryIndex === undefined) {
        setSerialPortName(selectedPortName);
      } else {
        setAuxiliarySerialPortNames((current) => current.map((name, index) => index === auxiliaryIndex ? selectedPortName : name));
      }
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
  }, [accelerationPercent, decelerationPercent, getPoseForJoints, jointRanges, jointRotors, motorSpeeds, solvePose, speedPercent]);

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
        className={`workspace${visiblePanelCount === 0 ? ' workspace-solo' : ''}${stackCartesian ? ' workspace-stack-cartesian' : ''}`}
        style={{ '--visible-panels': visiblePanelCount, '--visible-columns': visibleColumnCount } as React.CSSProperties}
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
            <div className="panel-title"><button className="panel-visibility-button" type="button" title="Hide PLAN" aria-label="Hide PLAN column" onClick={() => setPanelVisible('plan', false)}><HiddenIcon /></button><span className="eyebrow">PLAN</span></div>
            <div className="plan-file-actions">
              <input ref={planFileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadPlan(file);
                event.target.value = '';
              }} />
              <button type="button" title="Load Plan" disabled={running || planExecution !== null} onClick={() => { planLoadRequestRef.current += 1; setPlanFileMessage(null); planFileInputRef.current?.click(); }}><LoadIcon /><span>Load</span></button>
              <button type="button" title="Save Plan" onClick={() => { void savePlan(); }}><SaveIcon /><span>Save</span></button>
            </div>
          </div>
          <div className="plan-content">
            {planFileMessage && <div className={`plan-file-message ${planFileMessage.type}`} role="status">{planFileMessage.text}</div>}

            {planTargets.length > 0 ? <section className="plan-group">
              <h3>Targets</h3>
              <div className="plan-items">
                {planTargets.map((target) => <div className="plan-item" key={target.id}>
                  <button className={`plan-icon-button${target.visible ? '' : ' muted'}`} type="button" title={target.visible ? `Hide ${target.name}` : `Show ${target.name}`} aria-label={target.visible ? `Hide ${target.name}` : `Show ${target.name}`} onClick={() => toggleTargetVisibility(target.id)}>{target.visible ? <ViewIcon /> : <HiddenIcon />}</button>
                  <button className="plan-icon-button" type="button" title={`Edit ${target.name}`} aria-label={`Edit ${target.name}`} onClick={() => setTargetDraft({ ...target, pose: { ...target.pose } })}><EditIcon /></button>
                  <div className="plan-item-copy"><button className="target-name-button" type="button" disabled={running || loaded < 18} title={`Move robot to ${target.name}`} onClick={() => moveToPlanTarget(target)}><strong>{target.name}</strong></button><small>{target.pose.x.toFixed(1)}, {target.pose.y.toFixed(1)}, {target.pose.z.toFixed(1)} mm</small></div>
                  <button className="plan-icon-button delete" type="button" title={`Delete ${target.name}`} aria-label={`Delete ${target.name}`} onClick={() => deleteTarget(target.id)}><DeleteIcon /></button>
                  <button className="row-add-button" type="button" disabled={running || loaded < 18} title={`Add target after ${target.name}`} aria-label={`Add target after ${target.name}`} onClick={() => addTargetAfter(target.id)}><PlusIcon /></button>
                </div>)}
              </div>
            </section> : <section className="plan-group">
              <h3>Targets</h3>
              <button className="plan-empty-action" type="button" disabled={running || loaded < 18} onClick={() => addTargetAfter(-1)}><PlusIcon />Add target</button>
            </section>}

            <section className="plan-group">
              <div className="plan-group-heading">
                <h3>Plan</h3>
                <div className="plan-run-area">
                  <button className="plan-action-button preview" type="button" title="Preview plan" disabled={planExecution !== null || running || planCommands.length === 0} onClick={() => { void previewPlan(); }}><PreviewIcon />{planExecution === 'preview' ? 'Previewing…' : 'Preview'}</button>
                  <button className="plan-run-button" type="button" title="Run plan" disabled={planExecution !== null || running || planCommands.length === 0} onClick={() => { void runPlan(); }}><RunIcon />{planExecution === 'run' ? 'Running…' : 'Run'}</button>
                  <div className="plan-export-wrap">
                    <button className="plan-action-button export" type="button" title="Export plan" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen((open) => !open)}><ExportIcon />Export</button>
                    {exportMenuOpen && <div className="plan-export-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => setExportMenuOpen(false)}>Python</button>
                      <button type="button" role="menuitem" onClick={() => setExportMenuOpen(false)}>JavaScript</button>
                    </div>}
                  </div>
                </div>
              </div>
              <div className="plan-filename" title={planFilename ?? undefined}>{planFilename ?? ''}</div>
              {planExecutionMessage && <div className={`plan-execution-message ${planExecutionMessage.type}`} role="status">{planExecutionMessage.text}</div>}
              <div className="plan-items">
                {planCommands.length === 0 && <button className="plan-empty-action" type="button" disabled={running || planExecution !== null || planTargets.length === 0} onClick={addFirstPlanCommand}><PlusIcon />Add command</button>}
                {planCommands.map((command, index) => {
                  const startTarget = planTargets.find((candidate) => candidate.id === command.startTargetId);
                  const endTarget = planTargets.find((candidate) => candidate.id === command.endTargetId);
                  return <div className="plan-item command-item" key={command.id}>
                    <button className="plan-icon-button" type="button" title={`Edit ${command.type} command`} aria-label={`Edit ${command.type} command`} onClick={() => setCommandDraft({ ...command })}><EditIcon /></button>
                    <span className={`command-kind ${command.type}`}>{command.type}</span>
                    <div className="plan-item-copy"><strong>{index === 0 && command.startTargetId === null ? 'HOMING' : <>{command.startTargetId === null ? 'Current position' : startTarget?.name ?? 'Missing'} → {endTarget?.name ?? 'Missing'}</>}</strong><small>SPD {command.speed}% · ACC {command.acceleration}% · DEC {command.deceleration}%</small></div>
                    <button className="plan-icon-button delete" type="button" title={`Delete ${command.type} command`} aria-label={`Delete ${command.type} command`} onClick={() => deletePlanCommand(command.id)}><DeleteIcon /></button>
                    <button className="row-add-button" type="button" disabled={running || planExecution !== null} title={`Add command after ${command.type}`} aria-label={`Add command after ${command.type}`} onClick={() => { setPendingCommandType(null); setCommandInsertAfterId(commandInsertAfterId === command.id ? null : command.id); }}><PlusIcon /></button>
                    {commandInsertAfterId === command.id && <div className="row-add-menu" role="menu">
                      {!pendingCommandType ? <>
                        <button type="button" role="menuitem" onClick={() => addPlanCommand('move_j')}>move_j</button>
                        <button type="button" role="menuitem" onClick={() => addPlanCommand('move_l')}>move_l</button>
                      </> : <>
                        <small>Select end target</small>
                        {planTargets.filter((target) => target.id !== command.endTargetId).map((target) => <button type="button" role="menuitem" key={target.id} onClick={() => addPlanCommandToTarget(target.id)}>{target.name}</button>)}
                        {planTargets.length < 2 && <small>Add another target first</small>}
                      </>}
                    </div>}
                  </div>;
                })}
              </div>
            </section>
          </div>
        </aside>}

        {visiblePanels.angles && <AnglesPanel angles={angles} jointRanges={jointRanges} onHide={() => setPanelVisible('angles', false)} onJointChange={setJoint} onMove={moveTo} />}
        {visiblePanels.cartesian && <CartesianPanel
          target={ikTarget}
          message={ikMessage}
          disabled={loaded < 18 || running}
          onHide={() => setPanelVisible('cartesian', false)}
          onUseCurrent={fillCurrentPose}
          onTargetChange={(updater) => {
            setIkTarget(updater);
            setIkMessage(null);
          }}
          onSubmit={solveInverseKinematics}
        />}
      </section>

      {targetDraft && <TargetDialog
        draft={targetDraft}
        onChange={setTargetDraft}
        onClose={() => setTargetDraft(null)}
        onSave={(saved) => {
          setPlanTargets((current) => current.map((target) => target.id === saved.id ? saved : target));
          setTargetDraft(null);
        }}
      />}

      {commandDraft && <CommandDialog
        draft={commandDraft}
        targets={planTargets}
        onChange={setCommandDraft}
        onClose={() => setCommandDraft(null)}
        onSave={(saved) => {
          setPlanCommands((current) => chainPlanCommands(
            current.some((command) => command.id === saved.id)
              ? current.map((command) => command.id === saved.id ? saved : command)
              : [...current, saved],
            planTargets[0]?.id,
          ));
          setCommandDraft(null);
        }}
      />}

      {settingsOpen && <SettingsModal
        category={settingsCategory}
        jointRanges={jointRanges}
        motorSpeeds={motorSpeeds}
        speedPercent={speedPercent}
        accelerationPercent={accelerationPercent}
        decelerationPercent={decelerationPercent}
        serialPortName={serialPortName}
        auxiliarySerialPortNames={auxiliarySerialPortNames}
        serialMessage={serialMessage}
        settingsFilename={settingsFilename}
        settingsFileMessage={settingsFileMessage}
        loadDisabled={running || planExecution !== null}
        onCategoryChange={setSettingsCategory}
        onClose={() => setSettingsOpen(false)}
        onAddAuxiliaryPort={addAuxiliarySerialPort}
        onDeleteAuxiliaryPort={deleteAuxiliarySerialPort}
        onRequestSerialPort={requestSerialPort}
        onJointRangeChange={updateJointRange}
        onMotorSpeedChange={updateMotorSpeed}
        onResetJointRanges={resetJointRanges}
        onResetMotorSettings={resetMotorSettings}
        onSpeedChange={setSpeedPercent}
        onAccelerationChange={setAccelerationPercent}
        onDecelerationChange={setDecelerationPercent}
        onSaveSettings={() => { void saveSettings(); }}
        onBeginLoad={() => { settingsLoadRequestRef.current += 1; setSettingsFileMessage(null); }}
        onLoadSettings={loadSettings}
      />}
    </main>
  );
}
