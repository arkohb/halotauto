"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO AI ORB · the living holographic core (custom WebGL, zero deps)
//
//  A single-quad fragment-shader hologram that visualises ONLY real
//  assistant / engine state:
//    idle      slow rotation, breathing light, orbiting particles
//    listening concentric rings pulse with the trader's actual mic level
//              (AnalyserNode when available, real onspeechstart events
//              otherwise) — never a fake voice meter
//    thinking  particles stream inward + angular scan while a genuine
//              request is processed
//    speaking  circular waveform driven by real TTS word-boundary events
//    alert     short amber/red double-pulse for verified warnings
//    offline   dimmed + desaturated, status label lives in the card
//
//  Performance rules:
//    • lazy-loaded (dynamic import) · no loop when tab hidden / off-screen
//    • fps governor: 60 active / 30 idle (full FX) · 20 (reduced FX)
//    • DPR capped at 2 (1 on reduced) · particle detail scales with FX mode
//    • OS reduce-motion ⇒ static frames only, no animation loop
//    • pointer parallax on fine-pointer devices only, off in reduced FX
//    • any WebGL failure (or FX off) ⇒ pure CSS orb fallback — the
//      dashboard never breaks because of the decorative layer
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useFx } from "@/lib/halo/fx";
import { voiceEnergy } from "@/lib/halo/voice-energy";

export type OrbVisual = "idle" | "listening" | "thinking" | "speaking" | "alert" | "offline";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uRing;
uniform float uLevel;
uniform float uScan;
uniform float uWave;
uniform float uAlert;
uniform float uAlertWarm;
uniform float uFire;
uniform float uFireDir;
uniform float uDim;
uniform vec2  uTilt;
uniform float uQ;
uniform vec3  uColor;

float h21(vec2 p){ p = fract(p*vec2(234.34,435.345)); p += dot(p,p+34.23); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = h21(i), b = h21(i+vec2(1.0,0.0)), c = h21(i+vec2(0.0,1.0)), d = h21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){ float v = 0.0; float a = 0.5; for(int i=0;i<3;i++){ v += a*vnoise(p); p = p*2.03 + 11.3; a *= 0.5; } return v; }
float ring(float r, float R, float w){ float d = abs(r-R); return exp(-(d*d)/(w*w)); }
vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z); }
vec3 rotX(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x, c*p.y-s*p.z, s*p.y+c*p.z); }

void main(){
  vec2 p = vUv*2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  vec3 col = vec3(0.0);

  float breathe = 0.965 + 0.035*sin(uTime*1.15) + uLevel*0.05 + uWave*0.035;
  float R = 0.335*breathe;

  // core disc + living plasma
  float plasma = fbm(p*3.2 + vec2(uTime*0.20, -uTime*0.16) + uTilt*0.3);
  float disc = smoothstep(R, R*0.5, r);
  col += uColor * disc * (0.30 + 0.34*plasma);
  col += mix(uColor, vec3(1.0), 0.72) * exp(-(r*r)/(R*R*0.20)) * (0.50 + 0.22*sin(uTime*2.1));
  float rim = exp(-pow((r-R)/(R*0.16), 2.0));
  col += mix(uColor, vec3(0.62,0.91,1.0), 0.5) * rim * (0.60 + 0.75*uRing*(0.25+uLevel) + 0.65*uWave + 0.50*uScan);

  // gyroscope rings
  for(int i=0;i<3;i++){
    float fi = float(i);
    float ph = uTime*(0.16 + 0.05*fi) + fi*2.1;
    float k = max(0.28, cos(ph));
    float dirS = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;
    float rot = uTime*dirS*(0.22 + 0.08*fi) + fi*1.3;
    vec2 q = vec2(p.x*cos(rot) - p.y*sin(rot), p.x*sin(rot) + p.y*cos(rot));
    q.y /= k;
    float rr = R*(1.30 + 0.16*fi);
    float w = 0.008 + 0.004*fi;
    float glow = ring(length(q), rr, w*3.0);
    float core = ring(length(q), rr, w);
    float a = (0.15 + 0.09*fi) * (1.0 + 0.8*uScan);
    col += mix(uColor, vec3(0.62,0.91,1.0), 0.35) * (glow*0.5 + core) * a;
  }

  // listening pulse rings — amplitude from the real microphone
  for(int k=0;k<3;k++){
    float fk = float(k);
    float phase = fract(uTime*0.42 + fk*0.3333);
    float rr = R*(1.08 + phase*1.05);
    float a = pow(1.0-phase, 2.0) * uRing * (0.22 + 0.85*uLevel);
    col += uColor * ring(r, rr, 0.014) * a;
  }

  // speaking waveform — word-boundary driven envelope
  float wob = sin(ang*6.0 + uTime*8.5)*0.020 + sin(ang*11.0 - uTime*12.5)*0.012 + sin(ang*17.0 + uTime*5.0)*0.006;
  col += mix(uColor, vec3(0.62,0.91,1.0), 0.45) * ring(r, R*1.52 + wob*(0.35 + 1.3*uWave), 0.011) * (0.16 + 1.15*uWave);

  // thinking: angular sweep + scanline over the core
  float sweep = pow(max(cos(ang - uTime*2.3), 0.0), 16.0);
  col += uColor * sweep * uScan * 0.30 * smoothstep(R*0.35, R*1.15, r) * (1.0 - smoothstep(R*1.45, R*1.9, r));
  float sy = (fract(uTime*0.55)*2.0 - 1.0)*R*1.5;
  col += uColor * exp(-pow((p.y-sy)/0.022, 2.0)) * uScan * 0.20 * smoothstep(R*1.7, R*0.8, abs(p.x));

  // alert double pulse (verified warnings only)
  float prog = 1.0 - uAlert;
  vec3 alertCol = mix(vec3(1.0,0.72,0.33), vec3(1.0,0.24,0.28), uAlertWarm);
  col += alertCol * ring(r, R*(1.05 + prog*1.5), 0.016) * uAlert*uAlert * 1.10;
  col += alertCol * ring(r, R*(1.45 + prog*1.5), 0.012) * uAlert*uAlert * 0.60;

  // fire pulse — confirmed 3EL engine event
  vec3 fireCol = uFireDir > 0.0 ? vec3(0.15,0.95,0.62) : vec3(1.0,0.28,0.32);
  float fp = 1.0 - uFire;
  col += fireCol * ring(r, R*(1.0 + fp*1.7), 0.014) * uFire*uFire * 0.95;

  // orbiting particles (3D projected)
  for(int i=0;i<44;i++){
    float fi = float(i);
    float h = h21(vec2(fi*1.37 + 0.7, fi*2.11 + 0.3));
    float y = 1.0 - 2.0*((fi + 0.5)/44.0);
    float rad = sqrt(max(0.0, 1.0 - y*y));
    float phi = fi*2.399963;
    vec3 pos = vec3(cos(phi)*rad, y, sin(phi)*rad);
    float shell = mix(1.28, 1.62, h);
    shell = mix(shell, shell*(0.42 + 0.30*h), uScan*smoothstep(0.15, 0.95, h));
    shell += uRing*uLevel*0.10;
    shell += uFire*0.16*(0.4 + h);
    pos *= shell;
    pos = rotY(pos, uTime*0.16 + h*6.2);
    pos = rotX(pos, sin(uTime*0.11)*0.28 + uTilt.y*0.45);
    pos = rotY(pos, uTilt.x*0.55);
    vec2 sp = pos.xy * R * 1.05;
    float tw = 0.55 + 0.45*sin(uTime*(1.2 + 1.6*h) + fi);
    float sz = (0.016 + 0.010*h + 0.006*uLevel + 0.010*uScan) * (0.75 + 0.5*uQ);
    float depth = 0.30 + 0.70*smoothstep(-1.2, 1.2, pos.z);
    vec2 d = p - sp;
    col += mix(uColor, vec3(0.75,0.94,1.0), 0.4) * exp(-dot(d,d)/(sz*sz)) * tw * depth * (0.34 + 0.30*uQ);
  }

  // offline: dim + desaturate
  float g = dot(col, vec3(0.299,0.587,0.114));
  col = mix(col, vec3(g), uDim*0.75) * (1.0 - 0.70*uDim);

  col *= smoothstep(1.0, 0.90, r);
  col = 1.0 - exp(-col*1.35);
  float lum = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  lum = pow(lum, 0.82);
  gl_FragColor = vec4(col, lum);
}
`;

// state targets — what each visual state asks the renderer for
interface OrbParams {
  ring: number;
  scan: number;
  dim: number;
  color: [number, number, number];
}

const CYAN: [number, number, number] = [0.31, 0.85, 1.0];
const ICE: [number, number, number] = [0.45, 0.88, 1.0];
const AMBER: [number, number, number] = [1.0, 0.62, 0.2];
const RED: [number, number, number] = [1.0, 0.26, 0.3];
const GRAY: [number, number, number] = [0.5, 0.56, 0.66];

function targetsFor(state: OrbVisual, alertWarm: boolean): OrbParams {
  switch (state) {
    case "listening":
      return { ring: 1, scan: 0, dim: 0, color: CYAN };
    case "thinking":
      return { ring: 0, scan: 1, dim: 0, color: ICE };
    case "speaking":
      return { ring: 0, scan: 0, dim: 0, color: CYAN };
    case "alert":
      return { ring: 0, scan: 0, dim: 0, color: alertWarm ? RED : AMBER };
    case "offline":
      return { ring: 0, scan: 0, dim: 1, color: GRAY };
    default:
      return { ring: 0, scan: 0, dim: 0, color: CYAN };
  }
}

// ── CSS fallback orb (FX off / WebGL unavailable / context lost) ─────────
export function CssOrb({
  size = 132,
  tone = "#4FD8FF",
  dim = false,
  animate = true,
}: {
  size?: number;
  tone?: string;
  dim?: boolean;
  animate?: boolean;
}) {
  return (
    <div
      aria-hidden
      className="relative shrink-0"
      style={{ width: size, height: size, opacity: dim ? 0.45 : 1, filter: dim ? "saturate(0.3)" : "none" }}
    >
      <div
        className={`absolute inset-0 rounded-full ${animate ? "halo-anim-orbit" : ""}`}
        style={{ border: `1.5px dashed ${tone}66`, transformBox: "fill-box", transformOrigin: "center" }}
      />
      <div
        className={`absolute inset-[10%] rounded-full ${animate ? "halo-anim-orbit-rev" : ""}`}
        style={{ border: `1px solid ${tone}44`, transformBox: "fill-box", transformOrigin: "center" }}
      />
      <div
        className={`absolute inset-[20%] rounded-full ${animate ? "halo-anim-breathe" : ""}`}
        style={{
          background: `radial-gradient(circle at 42% 36%, ${tone}E6, ${tone}44 55%, rgba(11,20,38,0.92) 100%)`,
          boxShadow: `0 0 22px 2px ${tone}33, inset 0 0 18px ${tone}22`,
          transformBox: "fill-box",
          transformOrigin: "center",
        }}
      />
    </div>
  );
}

// ── the WebGL orb ─────────────────────────────────────────────────────────
export function HaloOrb({
  state,
  alertWarm = false,
  size = 132,
  className = "",
  idleColor,
}: {
  state: OrbVisual;
  alertWarm?: boolean;
  size?: number;
  className?: string;
  /** optional tint while idle — e.g. green/red when the engine manages a trade */
  idleColor?: [number, number, number];
}) {
  const { mode, motionOK } = useFx();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  // latest props for the render loop
  const stateRef = useRef(state);
  stateRef.current = state;
  const alertWarmRef = useRef(alertWarm);
  alertWarmRef.current = alertWarm;
  const idleColorRef = useRef(idleColor);
  idleColorRef.current = idleColor;

  useEffect(() => {
    if (mode === "off") return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let gl: WebGLRenderingContext | null = null;
    let prog: WebGLProgram | null = null;
    let U: Record<string, WebGLUniformLocation | null> = {};
    let ctxLost = false;
    let raf = 0;
    let simT = 0;
    let lastFrame = performance.now();
    let lastRender = 0;
    let onScreen = true;
    let fireT = 0;
    let alertT = 0;
    let lastAlertState = false;
    let levelS = 0;
    let waveS = 0;
    const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
    const cur: OrbParams = { ring: 0, scan: 0, dim: 0, color: [...CYAN] as [number, number, number] };
    const lowPowerMode = mode === "reduced";
    const animate = motionOK;

    // ── GL setup ──
    const initGL = (): boolean => {
      const opts: WebGLContextAttributes = { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" };
      gl = (canvas.getContext("webgl", opts) ?? canvas.getContext("experimental-webgl", opts)) as WebGLRenderingContext | null;
      if (!gl) return false;
      const compile = (type: number, src: string): WebGLShader | null => {
        const sh = gl!.createShader(type);
        if (!sh) return null;
        gl!.shaderSource(sh, src);
        gl!.compileShader(sh);
        if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) return null;
        return sh;
      };
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;
      prog = gl.createProgram();
      if (!prog) return false;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const names = ["uTime", "uRing", "uLevel", "uScan", "uWave", "uAlert", "uAlertWarm", "uFire", "uFireDir", "uDim", "uTilt", "uQ", "uColor"];
      U = {};
      names.forEach((n) => {
        U[n] = gl!.getUniformLocation(prog!, n);
      });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      return true;
    };

    const resize = () => {
      if (!gl) return;
      const dpr = lowPowerMode ? 1 : Math.min(2, window.devicePixelRatio || 1);
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(48, Math.min(520, Math.round(rect.width)));
      const h = Math.max(48, Math.min(520, Math.round(rect.height)));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const drawFrame = () => {
      if (!gl || !prog) return;
      const t = simT;
      const es = voiceEnergy.snapshot();
      const now = performance.now();

      // speaking envelope — real TTS word-boundary events, decaying
      let waveTarget = 0;
      if (es.speaking) {
        const since = Math.max(0, now - es.lastBoundaryAt);
        waveTarget = Math.min(1, 0.32 + 0.62 * Math.exp(-since / 420));
      }
      waveS = waveS * 0.82 + waveTarget * 0.18;

      // mic level — analyser RMS when available, real speech events otherwise
      const micLvl = voiceEnergy.readMicLevel();
      const micBump = 0.55 * Math.exp(-Math.max(0, now - es.lastMicAt) / 420);
      const lvlTarget = stateRef.current === "listening" ? Math.max(micLvl, micBump) : 0;
      levelS = levelS * 0.85 + lvlTarget * 0.15;

      // event pulses — fire flashes at the confirmed event, then decays
      const fireEnv = es.fireAt > 0 ? Math.exp(-Math.max(0, now - es.fireAt) / 650) : 0;
      fireT = Math.max(fireT * Math.exp(-0.016 * 1.9), fireEnv);
      if (stateRef.current === "alert" && !lastAlertState) {
        alertT = 1; // fresh verified warning → one short double-pulse
        voiceEnergy.alertPulse();
      }
      lastAlertState = stateRef.current === "alert";
      alertT *= Math.exp(-0.016 * 1.05);

      // state targets + smooth blend
      const tg = targetsFor(stateRef.current, alertWarmRef.current);
      if ((stateRef.current === "idle" || stateRef.current === "listening") && idleColorRef.current) {
        tg.color = idleColorRef.current; // honest tint: green/red while a trade is live
      }
      const k = Math.min(1, 0.016 * 5.5);
      cur.ring += (tg.ring - cur.ring) * k;
      cur.scan += (tg.scan - cur.scan) * k;
      cur.dim += (tg.dim - cur.dim) * k;
      for (let i = 0; i < 3; i++) cur.color[i] += (tg.color[i] - cur.color[i]) * k;

      tilt.x += (tilt.tx - tilt.x) * 0.08;
      tilt.y += (tilt.ty - tilt.y) * 0.08;

      // time dilation — offline crawls, thinking races the scanner
      const dil = cur.dim > 0.5 ? 0.12 : cur.scan > 0.5 ? 1.5 : 1;

      gl.uniform1f(U.uTime!, t);
      gl.uniform1f(U.uRing!, cur.ring);
      gl.uniform1f(U.uLevel!, Math.max(0, Math.min(1, levelS)));
      gl.uniform1f(U.uScan!, cur.scan);
      gl.uniform1f(U.uWave!, waveS);
      gl.uniform1f(U.uAlert!, Math.max(0, alertT));
      gl.uniform1f(U.uAlertWarm!, alertWarmRef.current ? 1 : 0);
      gl.uniform1f(U.uFire!, Math.max(0, Math.min(1, fireT)));
      gl.uniform1f(U.uFireDir!, es.fireDir);
      gl.uniform1f(U.uDim!, cur.dim);
      gl.uniform2f(U.uTilt!, tilt.x, tilt.y);
      gl.uniform1f(U.uQ!, lowPowerMode ? 0.4 : 1);
      gl.uniform3f(U.uColor!, cur.color[0], cur.color[1], cur.color[2]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      simT += 0.016 * dil;
    };

    // under OS reduce-motion the loop idles; state changes ask for one frame
    staticKickRef.current = () => {
      if (!ctxLost && onScreen) {
        lastFrame = performance.now();
        drawFrame();
      }
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = now - lastFrame;
      lastFrame = now;
      if (!onScreen || document.hidden || ctxLost) return;
      if (!animate) return; // OS reduce-motion → static frames drawn on state change
      const active = stateRef.current !== "idle" || levelS > 0.02 || waveS > 0.02;
      const interval = lowPowerMode ? 50 : active ? 16 : 33;
      if (now - lastRender >= interval) {
        lastRender = now;
        drawFrame();
      }
    };

    // boot
    if (!initGL()) {
      setFailed(true);
      return;
    }
    resize();
    drawFrame(); // first paint (also the static frame under reduce-motion)
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      resize();
      if (!animate) drawFrame();
    });
    ro.observe(wrap);

    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        if (onScreen && !animate) drawFrame();
      },
      { threshold: 0.05 }
    );
    io.observe(wrap);

    const onVis = () => {
      if (!document.hidden && !animate) drawFrame();
    };
    document.addEventListener("visibilitychange", onVis);

    const onLost = (e: Event) => {
      e.preventDefault();
      ctxLost = true;
    };
    const onRestored = () => {
      ctxLost = false;
      if (initGL()) {
        resize();
        drawFrame();
      } else {
        setFailed(true);
      }
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    // pointer parallax — fine pointers only, full FX only
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const onMove = (e: PointerEvent) => {
      if (!fine || lowPowerMode) return;
      const rect = wrap.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      tilt.tx = Math.max(-1, Math.min(1, nx));
      tilt.ty = Math.max(-1, Math.min(1, ny));
    };
    const onLeave = () => {
      tilt.tx = 0;
      tilt.ty = 0;
    };
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);

    return () => {
      staticKickRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      void gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
      prog = null;
      U = {};
    };
    // recreate on fx-mode change (fps/dpr profile differs)
  }, [mode, motionOK]);

  // static frame refresh when state changes under OS reduce-motion
  const staticKickRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (motionOK || mode === "off") return;
    staticKickRef.current?.();
  }, [state, motionOK, mode]);

  if (mode === "off") {
    return (
      <div className={className}>
        <CssOrb size={size} tone={state === "alert" ? (alertWarm ? "#F23645" : "#FFB454") : state === "offline" ? "#5D606B" : "#4FD8FF"} dim={state === "offline"} animate={false} />
      </div>
    );
  }

  if (failed) {
    return (
      <div className={className}>
        <CssOrb size={size} tone={state === "alert" ? (alertWarm ? "#F23645" : "#FFB454") : "#4FD8FF"} dim={state === "offline"} animate={motionOK && mode === "full"} />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`} style={{ width: size, height: size }} aria-hidden>
      <canvas ref={canvasRef} className="h-full w-full" style={{ display: "block" }} />
    </div>
  );
}

export default HaloOrb;
