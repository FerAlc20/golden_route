/* ============================================================
   The Lost Path — JS completo (versión larga)
   Cambios:
   - "🏆 Ver puntuaciones" SOLO en Pausa y Game Over (no en el menú inicial).
   - Icono 🏆 flotante siempre visible a la derecha.
   - Botón de sonido (mute/unmute).
   - Animaciones: look/jog/walkL/walkR/push/jump/strong/take/macaco.
   - Empuje con tecla E.
   - HUD con alerta de 10s, tokens dentro del área, luces cálidas de columnas.
   ============================================================ */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

/* ===================== Estado global ===================== */
let scene, camera, renderer, clock, worldOctree;
let player, mixer, action, actions = {};
let playerCollider, playerOnFloor = false;
let verticalVelocity = 0;
let lastOnFloorMs = 0;
const COYOTE_MS = 140;

let treasures = [], dynamicBoxes = [];
let gameState = 'menu';
let assetsReady = false;

let score = 0, currentLevel = 1, timeLeft = 60;
const LEVEL_SCORE_STEP = 500;
const WIN_SCORE = 2500;
const GRAVITY_BASE = 30;
const SPEED_BASE = 10;
const JUMP_VEL = 15.2;

const PLAY_MIN_XZ = -20, PLAY_MAX_XZ = 20;
const clampPlay = v => Math.min(PLAY_MAX_XZ, Math.max(PLAY_MIN_XZ, v));

/* ===================== UI ===================== */
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const timerEl = document.getElementById('timer');

const hudLeft  = document.getElementById('info-panel');
const hudRight = document.getElementById('timer-panel');

const menuEl    = document.getElementById('menu');
const pauseMenu = document.getElementById('pause-menu');
const victoryEl = document.getElementById('victory-message');

const startBtn        = document.getElementById('startButton');
const continueBtn     = document.getElementById('continueButton');
const pauseRestartBtn = document.getElementById('pauseRestartButton');
const restartBtn      = document.getElementById('restartButton');

const gemCount    = document.getElementById('gem-count');
const bookCount   = document.getElementById('book-count');
const potionCount = document.getElementById('potion-count');

const levelUpMessage = document.getElementById('level-up-message');

/* ===================== Audio ===================== */
let listener, audioLoader, bgMusic, sfxTake, sfxLevelUp, sfxPush, sfxGameOver;
const VOL = { bg: 0.28, take: 1.0, level: 0.9, push: 0.7, over: 0.95 };
let audioMuted = false;

const safePlay = (audio) => { try { if (audio?.buffer && !audio.isPlaying && !audioMuted) audio.play(); } catch {} };
function applyVolumes(){
  if (bgMusic)     bgMusic.setVolume(audioMuted ? 0 : VOL.bg);
  if (sfxTake)     sfxTake.setVolume(audioMuted ? 0 : VOL.take);
  if (sfxLevelUp)  sfxLevelUp.setVolume(audioMuted ? 0 : VOL.level);
  if (sfxPush)     sfxPush.setVolume(audioMuted ? 0 : VOL.push);
  if (sfxGameOver) sfxGameOver.setVolume(audioMuted ? 0 : VOL.over);
}
function setAudioMuted(m){
  audioMuted = m;
  applyVolumes();
  const b = document.getElementById('soundButton');
  if (b) b.textContent = audioMuted ? '🔇' : '🔊';
}

/* ===================== Cámara ===================== */
let camYaw = 0, camPitch = 0;
const CAMERA_DISTANCE = 3.2;
const CAMERA_HEIGHT = 1.65;
let cameraBumpT = 0;
let pointerLockBound = false;

/* ===================== Niveles / Dificultad ===================== */
const levels = {
  1: { duration: 60, positions: [ new THREE.Vector3(-10,0.35,-10), new THREE.Vector3(10,0.35,-10), new THREE.Vector3(10,0.35,10), new THREE.Vector3(-10,0.35,10), new THREE.Vector3(0,0.35,0) ] },
  2: { duration: 55, positions: [ new THREE.Vector3(-18,0.35,-5), new THREE.Vector3(15,0.35,18), new THREE.Vector3(-5,0.35,15), new THREE.Vector3(10,0.35,10), new THREE.Vector3(-15,0.35,-15), new THREE.Vector3(5,0.35,-18), new THREE.Vector3(18,0.35,5), new THREE.Vector3(0,0.35,-10) ] },
  3: { duration: 50, positions: [ new THREE.Vector3(-19,0.35,0), new THREE.Vector3(19,0.35,0), new THREE.Vector3(0,0.35,-19), new THREE.Vector3(0,0.35,19), new THREE.Vector3(12,0.35,12), new THREE.Vector3(-12,0.35,-12), new THREE.Vector3(12,0.35,-12), new THREE.Vector3(-12,0.35,12), new THREE.Vector3(0,0.35,0), new THREE.Vector3(5,0.35,5) ] }
};
function difficultyFor(level){
  const hard = (level>=3);
  const mult = 1 + 0.15*(level-1) + (hard?0.05:0);
  return {
    speed:    SPEED_BASE * mult,
    gravity:  GRAVITY_BASE * (1 + 0.07*(level-1) + (hard?0.04:0)),
    tokenSpin:  (level===1?1.0:level===2?1.3:1.6),
    tokenFloat: (level===1?0.16:level===2?0.19:0.22),
    boxes:      (level===1?14:level===2?20:28),
    tokenTarget:(level===1?10:level===2?13:18),
    pushForce:  (level===1?3.8:level===2?4.2:4.8)
  };
}

/* ===================== Tokens ===================== */
const treasureScores = { poison: 50, libro: 150, gema: 250 };
const treasureColors = { gema:'#5ec8ff', libro:'#ffa500', poison:'#800080' };
let poisonModel = null, libroModel = null, gemaModel = null;

/* ===================== Input ===================== */
const keyStates = {};
document.addEventListener('keydown', e => {
  if (e.code === 'KeyP'){
    if (gameState === 'playing') pauseGame();
    else if (gameState === 'paused') resumeGame();
  }
  if (e.code === 'Space') e.preventDefault();
  keyStates[e.code] = true;
});
document.addEventListener('keyup', e => { keyStates[e.code] = false; });

/* Pointer lock (gesto) */
function bindPointerLock(){
  if (pointerLockBound) return;
  pointerLockBound = true;
  const canvas = renderer.domElement;
  canvas.addEventListener('click', ()=>{
    if (gameState==='playing' && document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });
  document.addEventListener('mousemove', (e)=>{
    if (gameState!=='playing') return;
    if (document.pointerLockElement === canvas){
      const s=0.002; camYaw -= e.movementX*s; camPitch = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, camPitch - e.movementY*s));
    }
  });
}

/* ===================== Overlays / visibilidad ===================== */
function styleOverlays(){
  const css = `
    .golden-card{
      position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
      display:flex; flex-direction:column; gap:16px; align-items:center; justify-content:center;
      min-width:min(92vw,560px); max-width:92vw; padding:28px 24px;
      background: radial-gradient(120% 140% at 50% 0%, rgba(255,204,102,.08), rgba(0,0,0,.55) 60%), rgba(13,17,23,.8);
      border:1px solid rgba(255,210,122,.35); border-radius:16px;
      box-shadow:0 0 24px rgba(255,210,122,.22), inset 0 0 32px rgba(255,210,122,.1);
      color:#fff; text-align:center; backdrop-filter: blur(8px); z-index:10000;
    }
    .golden-card h1,.golden-card h2{margin:0 0 8px;color:#ffdfb0;text-shadow:0 0 12px rgba(255,210,122,.35)}
    .golden-card .btn{padding:10px 18px;border-radius:12px;border:1px solid rgba(255,210,122,.35);
      background:linear-gradient(180deg, rgba(255,210,122,.16), rgba(0,0,0,.35));
      color:#fff; font-weight:600; cursor:pointer; transition:.15s;
      box-shadow:0 0 16px rgba(255,210,122,.18), inset 0 0 12px rgba(255,210,122,.1);}
    .golden-card .btn:hover{transform:translateY(-2px);}
    .timer-pulse{animation:pulse .7s ease-in-out infinite;color:#ff6b6b !important;text-shadow:0 0 8px rgba(255,90,90,.7);}
    @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
  `;
  const tag = document.createElement('style'); tag.textContent = css; document.head.appendChild(tag);

  // aplica skin dorada
  const menuCard    = document.querySelector('#menu .menu-card');
  const pauseCard   = document.querySelector('#pause-menu .menu-card');
  const victoryCard = document.querySelector('#victory-message .menu-card');
  [menuCard, pauseCard, victoryCard].forEach(c=> c && c.classList.add('golden-card'));

  // visibilidad inicial
  if (pauseMenu)  pauseMenu.style.display  = 'none';
  if (victoryEl)  victoryEl.style.display  = 'none';
  if (menuEl)     menuEl.style.display     = 'flex';
}
function hideAllOverlays(){
  if (menuEl)    menuEl.style.display    = 'none';
  if (pauseMenu) pauseMenu.style.display = 'none';
  if (victoryEl) victoryEl.style.display = 'none';
  const sc = document.getElementById('scoreboard');
  if (sc) sc.style.display = 'none';
}
function setHudVisible(v){
  if (hudLeft)  hudLeft.style.display  = v ? '' : 'none';
  if (hudRight) hudRight.style.display = v ? '' : 'none';
}
function openMenu(){
  hideAllOverlays();
  if (menuEl) menuEl.style.display = 'flex';
  setHudVisible(false);
}

/* ===================== Botones: sonido / home / puntajes en overlays ===================== */
function injectSoundToggle(){
  let sb = document.getElementById('soundButton');
  if (sb) return;
  sb = document.createElement('button');
  sb.id = 'soundButton';
  sb.textContent = audioMuted ? '🔇' : '🔊';
  Object.assign(sb.style, {
    position:'fixed', bottom:'18px', right:'84px',
    width:'54px', height:'54px', borderRadius:'50%',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:'22px', color:'#fff',
    background:'radial-gradient(120% 120% at 50% 30%, rgba(255,210,122,.28), rgba(0,0,0,.55))',
    border:'1px solid rgba(255,210,122,.35)',
    boxShadow:'0 0 18px rgba(255,210,122,.25), inset 0 0 12px rgba(255,210,122,.14)',
    cursor:'pointer', zIndex:'10001'
  });
  document.body.appendChild(sb);
  sb.addEventListener('click', ()=>{
    if (!bgMusic?.isPlaying) safePlay(bgMusic);
    setAudioMuted(!audioMuted);
  });
}
function ensureHomeButtons(){
  const addHome = (rootSelector, id) => {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    const exists = root.querySelector(`#${id}`);
    if (exists) return;
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'btn';
    btn.textContent = 'Home';
    btn.style.marginTop = '8px';
    root.appendChild(btn);
    btn.addEventListener('click', goHome);
  };
  // Home en Pausa y Game Over
  ensureRemoveMenuScoresButton(); // por si quedó algo previo
  addHome('#pause-menu .menu-card',      'homeButtonPause');
  addHome('#victory-message .menu-card', 'homeButtonWin');
}
function ensureOverlayScoreButtons(){
  // Remueve (si existe) en el menú inicial
  ensureRemoveMenuScoresButton();

  // Agrega solo en PAUSA y GAME OVER
  const addScore = (rootSelector, id) => {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    if (root.querySelector(`#${id}`)) return;
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'btn';
    btn.textContent = '🏆 Ver puntuaciones';
    root.appendChild(btn);
    btn.addEventListener('click', openScoreboard);
  };
  addScore('#pause-menu .menu-card',     'pauseScoresButton');
  addScore('#victory-message .menu-card','winScoresButton');
}
function ensureRemoveMenuScoresButton(){
  const oldMenuScoresA = document.getElementById('menuScores');
  const oldMenuScoresB = document.getElementById('menuScoresButton');
  if (oldMenuScoresA) oldMenuScoresA.remove();
  if (oldMenuScoresB) oldMenuScoresB.remove();
}
function goHome(){
  gameState = 'menu';
  hideAllOverlays();
  openMenu();
  setHudVisible(false);
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  if (actions?.look) playAction(actions.look, 0.2);
  levelEl && (levelEl.textContent = '1');
  timeLeft = 60; updateTimerUI();

  // Asegúrate de no mostrar botón de puntuaciones en menú
  ensureRemoveMenuScoresButton();
}

/* ===================== Luces de aventura (columnas) ===================== */
let warmLights = [];
let playerTopLight; // antorcha
function addWarmAdventureLights(){
  const spots = [
    new THREE.Vector3(-15, 9, -15),
    new THREE.Vector3( 15, 9, -15),
    new THREE.Vector3(-15, 9,  15),
    new THREE.Vector3( 15, 9,  15),
    new THREE.Vector3(  0, 10,   0)
  ];
  warmLights = [];
  for (const p of spots){
    const l = new THREE.SpotLight(0xffc880, 0.95, 36, Math.PI/5, 0.35, 1.9);
    l.position.copy(p);
    l.target.position.set(p.x, 0.6, p.z);
    l.castShadow = false;
    scene.add(l.target);
    scene.add(l);
    warmLights.push(l);
  }
}

/* ===================== Init ===================== */
init();
async function init(){
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);
  scene.fog = new THREE.Fog(0x0b0f14, 12, 85);

  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  document.getElementById('container').appendChild(renderer.domElement);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 220);
  camera.position.set(0,2,5);

  // Iluminación cálida base
  scene.add(new THREE.AmbientLight(0x4d2e16, 0.32));
  scene.add(new THREE.HemisphereLight(0x5b6b7a, 0x2a170b, 1.0));
  const camp = new THREE.PointLight(0xffd9a0, 1.2, 38, 1.9); camp.position.set(0, 6, 0); scene.add(camp);

  // Audio
  listener = new THREE.AudioListener(); camera.add(listener);
  audioLoader = new THREE.AudioLoader();
  audioLoader.load('./sounds/Cavern Expedition.mp3', (b)=>{ bgMusic=new THREE.Audio(listener); bgMusic.setBuffer(b); bgMusic.setLoop(true); safePlay(bgMusic); applyVolumes(); });
  audioLoader.load('./sounds/take-item.mp3',  (b)=>{ sfxTake=new THREE.Audio(listener); sfxTake.setBuffer(b); applyVolumes(); });
  audioLoader.load('./sounds/level-up.mp3',   (b)=>{ sfxLevelUp=new THREE.Audio(listener); sfxLevelUp.setBuffer(b); applyVolumes(); });
  audioLoader.load('./sounds/push-box.mp3',   (b)=>{ sfxPush=new THREE.Audio(listener); sfxPush.setBuffer(b); applyVolumes(); }, undefined, ()=>console.warn('push-box.mp3 opcional no encontrado'));
  audioLoader.load('./sounds/game-over.mp3',  (b)=>{ sfxGameOver=new THREE.Audio(listener); sfxGameOver.setBuffer(b); applyVolumes(); }, undefined, ()=>console.warn('game-over.mp3 no encontrado'));

  window.addEventListener('click', ()=>{ safePlay(bgMusic); }, { once:true });

  // Estilos / botones globales
  styleOverlays();
  injectScoreboardUI();          // crea modal + 🏆 flotante
  injectSoundToggle();           // botón de sonido
  ensureHomeButtons();           // agrega Home en Pausa y Game Over
  ensureOverlayScoreButtons();   // agrega "🏆 Ver puntuaciones" SOLO en Pausa y Game Over

  openMenu(); // menú visible al inicio

  // botones HTML
  startBtn?.addEventListener('click', ()=>{ if (assetsReady) startGame(); });
  continueBtn?.addEventListener('click', resumeGame);
  pauseRestartBtn?.addEventListener('click', startGame);
  restartBtn?.addEventListener('click', startGame);

  window.addEventListener('resize', onResize);
  animate(); // loop

  // Carga de assets async
  loadAssetsAndSetup();
}

/* ===================== Carga de assets ===================== */
async function loadAssetsAndSetup(){
  const gltf = new GLTFLoader();
  const fbx  = new FBXLoader();

  if (startBtn){ startBtn.textContent='Cargando…'; startBtn.disabled=true; }

  let env, arissa, fStrong, fJog, fLook, fWalkL, fWalkR, fPush, fJump, fMacaco, fTake, gPoison, gLibro, gGema;

  try{
    const results = await Promise.all([
      gltf.loadAsync('./models/gltf/big_scary_level_2.glb'),
      fbx.loadAsync('./models/fbx/Arissa.fbx'),
      fbx.loadAsync('./models/fbx/Strong Gesture.fbx'),
      fbx.loadAsync('./models/fbx/Jogging.fbx'),
      fbx.loadAsync('./models/fbx/Look Around.fbx'),
      fbx.loadAsync('./models/fbx/Standing Walk Left.fbx'),
      fbx.loadAsync('./models/fbx/Standing Walk Right.fbx'),
      fbx.loadAsync('./models/fbx/Push Stop.fbx'),
      fbx.loadAsync('./models/fbx/Jump.fbx'),
      fbx.loadAsync('./models/fbx/Macaco Side.fbx'),
      fbx.loadAsync('./models/fbx/Taking Item.fbx'),
      gltf.loadAsync('./models/gltf/poison.glb'),
      gltf.loadAsync('./models/gltf/libro.glb'),
      gltf.loadAsync('./models/gltf/gema.glb'),
    ]);
    [
      env, arissa,
      fStrong, fJog, fLook, fWalkL, fWalkR, fPush, fJump,
      fMacaco, fTake,
      gPoison, gLibro, gGema
    ] = results;
  }catch(err){
    console.error('Error cargando assets:', err);
    if (startBtn){ startBtn.textContent='Error al cargar'; startBtn.disabled=true; }
    return;
  }

  // luz direccional cálida
  const dirWarm = new THREE.DirectionalLight(0xffd9a0, 1.18);
  dirWarm.position.set(-8, 18, -6);
  dirWarm.castShadow = true;
  dirWarm.shadow.mapSize.set(1024, 1024);
  scene.add(dirWarm);

  env.scene.traverse(o=>{ if(o.isMesh){ o.receiveShadow=true; o.castShadow=false; } });
  scene.add(env.scene);
  worldOctree = new Octree(); worldOctree.fromGraphNode(env.scene);

  player = arissa; player.scale.set(0.01,0.01,0.01);
  player.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  scene.add(player);

  // luz personal (antorcha cálida) + halo
  playerTopLight = new THREE.PointLight(0xffd9a0, 0.95, 8.0, 2.0);
  playerTopLight.position.set(0, 2.2, -0.2); player.add(playerTopLight);
  const auraSprite = makeGlowSprite(256, '#ffd27a'); auraSprite.position.set(0,1.05,0); auraSprite.scale.set(2.6,2.6,2.6); player.add(auraSprite);

  // Animaciones
  mixer = new THREE.AnimationMixer(player);
  actions.strong  = mixer.clipAction(fStrong.animations[0]);
  actions.jogging = mixer.clipAction(fJog.animations[0]);
  actions.look    = mixer.clipAction(fLook.animations[0]);
  actions.walkL   = mixer.clipAction(fWalkL.animations[0]);
  actions.walkR   = mixer.clipAction(fWalkR.animations[0]);
  actions.push    = mixer.clipAction(fPush.animations[0]);
  actions.jump    = mixer.clipAction(fJump.animations[0]);
  actions.macaco  = mixer.clipAction(fMacaco.animations[0]);
  actions.take    = mixer.clipAction(fTake.animations[0]);

  [actions.jogging,actions.look,actions.walkL,actions.walkR,actions.push,actions.macaco].forEach(a=>a.setLoop(THREE.LoopRepeat,Infinity));
  actions.take.setLoop(THREE.LoopOnce);   actions.take.clampWhenFinished = true;
  actions.strong.setLoop(THREE.LoopOnce); actions.strong.clampWhenFinished = true;
  actions.jump.setLoop(THREE.LoopOnce);   actions.jump.clampWhenFinished = true;

  Object.values(actions).forEach(a=>{ a.enabled=true; a.play(); a.fadeOut(0); });
  actions.look.fadeIn(0.2); action = actions.look;

  playerCollider = new Capsule(new THREE.Vector3(0,1.0,0), new THREE.Vector3(0,2.0,0), 0.35);
  player.position.set(0,0.5,0);

  // Modelos de tokens (tamaños y color)
  poisonModel = gPoison.scene; poisonModel.name='poison'; poisonModel.scale.set(3.2,3.2,3.2);
  libroModel  = gLibro.scene;  libroModel.name='libro';   libroModel.scale.set(0.03,0.03,0.03); // 50%
  gemaModel   = gGema.scene;   gemaModel.name='gema';     gemaModel.scale.set(5.5,5.5,5.5);    // más grande

  // luces cálidas estratégicas
  addWarmAdventureLights();

  spawnBoxesForLevel(1);
  spawnTreasures(1);
  ensureMinimumTreasures();

  bindPointerLock();
  assetsReady = true;
  if (startBtn){ startBtn.textContent='Comenzar Aventura'; startBtn.disabled=false; }
  applyVolumes();
}

/* ===================== Utils ===================== */
function makeGlowSprite(size=256,color='#ffd27a'){
  const cnv=document.createElement('canvas'); cnv.width=cnv.height=size;
  const ctx=cnv.getContext('2d');
  const g=ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  g.addColorStop(0, hexToRgba(color, 1.0));
  g.addColorStop(0.5, hexToRgba(color, 0.30));
  g.addColorStop(1, hexToRgba(color, 0.0));
  ctx.fillStyle=g; ctx.fillRect(0,0,size,size);
  const tex=new THREE.CanvasTexture(cnv);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending }));
}
function hexToRgba(hex,a){ const c=hex.replace('#',''); const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16); return `rgba(${r},${g},${b},${a})`; }
function onResize(){ camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }
function updateScoreUI(){ scoreEl && (scoreEl.textContent=score); }
function updateTimerUI(){
  const m=Math.floor(timeLeft/60), s=Math.floor(timeLeft%60);
  if (timerEl){
    timerEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (timeLeft<=10) timerEl.classList.add('timer-pulse'); else timerEl.classList.remove('timer-pulse');
  }
}

/* ===================== Cámara (fallback si no hay player) ===================== */
function updateCamera(dt){
  if (!player){
    const idleTarget = new THREE.Vector3(0, 1.2, 0);
    const idlePos    = new THREE.Vector3(0, 2.2, 6);
    camera.position.lerp(idlePos, 0.05);
    camera.lookAt(idleTarget);
    return;
  }
  const dir=new THREE.Vector3(
    Math.cos(camPitch)*Math.sin(camYaw),
    Math.sin(camPitch),
    Math.cos(camPitch)*Math.cos(camYaw)
  );
  if (cameraBumpT>0) cameraBumpT=Math.max(0,cameraBumpT-dt*1.5);
  const bump=Math.sin(cameraBumpT*Math.PI)*0.4;

  const camTarget=player.position.clone().add(new THREE.Vector3(0, CAMERA_HEIGHT+bump, 0));
  const camPos   =camTarget.clone().sub(dir.multiplyScalar(CAMERA_DISTANCE));

  camera.position.lerp(camPos,0.12);
  camera.lookAt(camTarget);
  player.rotation.y = camYaw;
}

/* ===================== Animación helpers ===================== */
let animLock = false;
function playOneShot(act, fade=0.18, onAfter=()=>{}){
  if (!act) return;
  animLock = true;
  act.reset().setLoop(THREE.LoopOnce, 1);
  act.clampWhenFinished = true;
  act.fadeIn(fade).play();
  action?.fadeOut(fade);
  action = act;
  const handler = (e)=>{
    if (e.action === act){
      mixer.removeEventListener('finished', handler);
      animLock = false;
      onAfter();
    }
  };
  mixer.addEventListener('finished', handler);
}
function playAction(next, fade=0.16){
  if (action===next || animLock) return;
  next.reset().fadeIn(fade).play();
  action?.fadeOut(fade);
  action = next;
}
function movementActionFromKeys(){
  const isF = keyStates['KeyW']||keyStates['ArrowUp'];
  const isB = keyStates['KeyS']||keyStates['ArrowDown'];
  const isL = keyStates['KeyA']||keyStates['ArrowLeft'];
  const isR = keyStates['KeyD']||keyStates['ArrowRight'];
  if ((isL||isR) && !(isF||isB)) return isL ? actions.walkL : actions.walkR;
  if (isF||isB) return actions.jogging;
  return actions.look;
}

/* ===================== Tokens ===================== */
function spawnTreasures(levelIdx){
  for(const t of treasures) scene.remove(t.mesh); treasures.length=0;
  const diff=difficultyFor(levelIdx), target=diff.tokenTarget;
  const positions=[...levels[levelIdx].positions];

  while(positions.length<target){
    positions.push(new THREE.Vector3(
      THREE.MathUtils.randFloat(PLAY_MIN_XZ+1.5, PLAY_MAX_XZ-1.5),
      0.35,
      THREE.MathUtils.randFloat(PLAY_MIN_XZ+1.5, PLAY_MAX_XZ-1.5)
    ));
  }
  const pool=[ {model:poisonModel,type:'poison'}, {model:libroModel,type:'libro'}, {model:gemaModel,type:'gema'} ];

  positions.slice(0,target).forEach((p,i)=>{
    p.x=clampPlay(p.x); p.z=clampPlay(p.z); p.y=0.35;
    const {model,type}=pool[Math.floor(Math.random()*pool.length)];
    const mesh=model.clone(true); mesh.position.copy(p);

    mesh.traverse(c=>{
      if(c.isMesh){
        c.castShadow = true; c.receiveShadow = false;
        c.material = c.material.clone();
        c.material.transparent = true; c.material.opacity = 1;
        if ('emissive' in c.material){
          c.material.emissive = new THREE.Color(treasureColors[type]);
          c.material.emissiveIntensity = (type==='gema'?1.6:1.2);
        }
      }
    });

    const tLight=new THREE.PointLight(treasureColors[type], (type==='gema'?1.0:0.7), 5.0, 2.2);
    tLight.position.set(0, 1.2, 0); mesh.add(tLight);

    const halo=makeGlowSprite(256, treasureColors[type]);
    halo.scale.set((type==='gema'?2.0:1.6),(type==='gema'?2.0:1.6),1);
    halo.position.set(0, 0.9, 0); mesh.add(halo);

    scene.add(mesh);
    treasures.push({ mesh, type, y0:mesh.position.y, glow:0, collected:false, fade:1, light:tLight, halo });
  });
}
function ensureMinimumTreasures(){
  const diff=difficultyFor(currentLevel);
  if (treasures.length < Math.floor(diff.tokenTarget*0.6)){
    const need=diff.tokenTarget - treasures.length;
    for(let i=0;i<need;i++){
      const pos=new THREE.Vector3(THREE.MathUtils.randFloat(-8,8),0.35,THREE.MathUtils.randFloat(-8,8));
      const model=(i%3===0)?gemaModel:((i%2===0)?libroModel:poisonModel);
      const type=(model===gemaModel?'gema':(model===libroModel?'libro':'poison'));
      const mesh=model.clone(true); mesh.position.copy(pos);
      const tLight=new THREE.PointLight(treasureColors[type], (type==='gema'?1.0:0.7), 5.0, 2.2); tLight.position.set(0,1.2,0); mesh.add(tLight);
      const halo=makeGlowSprite(256, treasureColors[type]); halo.scale.set((type==='gema'?2.0:1.6),(type==='gema'?2.0:1.6),1); halo.position.set(0,0.9,0); mesh.add(halo);
      scene.add(mesh); treasures.push({mesh,type,y0:pos.y, glow:0, collected:false, fade:1, light:tLight, halo});
    }
  }
}
function updateTreasures(dt){
  const time=performance.now()*0.001; const diff=difficultyFor(currentLevel);
  for (let i=treasures.length-1;i>=0;i--){
    const t=treasures[i];

    const distToPlayer = player ? t.mesh.position.clone().sub(player.position).length() : 999;
    t.light.visible = distToPlayer < 18;

    if (t.collected){
      t.glow=Math.min(1,t.glow+dt*4); t.fade-=dt*1.8; t.mesh.position.y+=dt*2.2;
      t.light.intensity=Math.max(0,1.2*t.glow*t.fade); t.halo.material.opacity=Math.max(0,t.fade);
      t.mesh.traverse(c=>{ if(c.isMesh){ if('emissive' in c.material){ c.material.emissiveIntensity=2.0*t.glow; } c.material.opacity=Math.max(0,t.fade); }});
      if (t.fade<=0){ scene.remove(t.mesh); treasures.splice(i,1); }
      continue;
    }

    t.mesh.rotation.y += dt*0.6*diff.tokenSpin;
    t.mesh.position.y  = t.y0 + Math.sin(time*2.0+i)*diff.tokenFloat;
    t.halo.material.opacity = 0.55 + 0.35*Math.sin(time*3.2+i);
    if (t.light.visible) t.light.intensity = 0.45 + 0.35*Math.sin(time*3.6+i);

    if (player){
      const dx=player.position.x - t.mesh.position.x;
      const dz=player.position.z - t.mesh.position.z;
      const horiz = Math.hypot(dx,dz);
      if (horiz < 2.2 && horiz > 1.45){
        const pull = new THREE.Vector3(dx,0,dz).multiplyScalar(-0.6 * dt);
        t.mesh.position.add(pull);
      }
      if (horiz < 1.45){
        t.collected=true; cameraBumpT=1.0; safePlay(sfxTake);
        score += (treasureScores[t.type]||0); updateScoreUI();
        const map={gema:gemCount,libro:bookCount,poison:potionCount}; map[t.type] && (map[t.type].textContent = String(parseInt(map[t.type].textContent)+1));
        playOneShot(actions.take, 0.12, ()=> playAction(movementActionFromKeys(),0.18));
        const nextGate=LEVEL_SCORE_STEP*currentLevel; if (score>=nextGate && currentLevel<3) levelUp(); if (score>=WIN_SCORE) winGame();
      }
    }
  }
  if (currentLevel>=3) ensureMinimumTreasures();
}

/* ===================== Cajas ===================== */
function spawnBoxesForLevel(lvl){
  for(const b of dynamicBoxes) scene.remove(b.mesh); dynamicBoxes.length=0;
  const count=difficultyFor(lvl).boxes;
  const geom=new THREE.BoxGeometry(1,1,1);
  for(let i=0;i<count;i++){
    const m=new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color:0x8b6c42, roughness:0.85, metalness:0.08 }));
    const px=THREE.MathUtils.randFloat(PLAY_MIN_XZ+2, PLAY_MAX_XZ-2);
    const pz=THREE.MathUtils.randFloat(PLAY_MIN_XZ+2, PLAY_MAX_XZ-2);
    m.position.set(px, THREE.MathUtils.randFloat(2,7), pz);
    m.castShadow=m.receiveShadow=true;
    scene.add(m);
    dynamicBoxes.push({ mesh:m, vel:new THREE.Vector3(THREE.MathUtils.randFloatSpread(0.4),0,THREE.MathUtils.randFloatSpread(0.4)) });
  }
}
function updateBoxes(dt){
  const diff=difficultyFor(currentLevel);
  for(const b of dynamicBoxes){
    b.vel.y -= diff.gravity * dt;
    b.mesh.position.addScaledVector(b.vel, dt);

    let iter = 0;
    while (iter < 3) {
      const sphere = new THREE.Sphere(b.mesh.position, 0.5);
      const hit = worldOctree?.sphereIntersect(sphere);
      if (!hit) break;
      b.mesh.position.addScaledVector(hit.normal, hit.depth + 1e-4);
      const vn = hit.normal.dot(b.vel);
      b.vel.addScaledVector(hit.normal, -vn).multiplyScalar(0.6);
      if (hit.normal.y > 0.5 && Math.abs(b.vel.y) < 1.5) b.vel.y = 0;
      iter++;
    }
    b.vel.x *= 0.992; b.vel.z *= 0.992;
    if (iter === 0) b.vel.multiplyScalar(0.998);

    b.mesh.position.x = clampPlay(b.mesh.position.x);
    b.mesh.position.z = clampPlay(b.mesh.position.z);

    if (playerCollider){
      const center = playerCollider.start.clone().add(playerCollider.end).multiplyScalar(0.5);
      const delta  = new THREE.Vector3().subVectors(b.mesh.position, center);
      const dist   = delta.length();
      const minDist = 0.5 + playerCollider.radius;
      if (dist>0 && dist<minDist){
        const n=delta.multiplyScalar(1/dist);
        b.mesh.position.addScaledVector(n, (minDist - dist) + 0.001);
        b.vel.addScaledVector(n, 2.2);
      }
    }
  }
}

/* ===== Empuje con E ===== */
const raycaster = new THREE.Raycaster();
function pushBoxesForward(){
  if (!player) return false;
  const origin  = player.position.clone().add(new THREE.Vector3(0,1.2,0));
  const forward = new THREE.Vector3(0,0,1).applyQuaternion(player.quaternion).normalize();
  raycaster.set(origin, forward); raycaster.far = 1.6;
  const hits = raycaster.intersectObjects(dynamicBoxes.map(b=>b.mesh), false);
  const diff = difficultyFor(currentLevel);
  let pushed=false;

  if (hits.length>0){
    const mesh=hits[0].object;
    const box=dynamicBoxes.find(b=>b.mesh===mesh);
    if (box){ box.vel.add(forward.clone().multiplyScalar(diff.pushForce)); box.vel.y = Math.min(0, box.vel.y); box.vel.clampLength(0, 7.5); pushed=true; }
  }
  for(const b of dynamicBoxes){
    const delta=b.mesh.position.clone().sub(origin);
    const dist=delta.length();
    if (dist<1.1 && forward.dot(delta.normalize())>0.35){
      b.vel.addScaledVector(forward, diff.pushForce*0.8); b.vel.y=Math.min(0,b.vel.y); b.vel.clampLength(0,7.5); pushed=true;
    }
  }
  if (pushed) safePlay(sfxPush);
  return pushed;
}

/* ===================== Física jugador ===================== */
function updatePlayerPhysics(dt){
  if (!playerCollider) return;

  const forward = new THREE.Vector3(0,0,1).applyQuaternion(player.quaternion);
  const right   = new THREE.Vector3(-1,0,0).applyQuaternion(player.quaternion);
  let move = new THREE.Vector3();

  const isF = keyStates['KeyW']||keyStates['ArrowUp'];
  const isB = keyStates['KeyS']||keyStates['ArrowDown'];
  const isL = keyStates['KeyA']||keyStates['ArrowLeft'];
  const isR = keyStates['KeyD']||keyStates['ArrowRight'];
  const pushingKey = !!keyStates['KeyE'];

  // salto (coyote)
  const now = performance.now();
  const canCoyote = (now - lastOnFloorMs) < COYOTE_MS;
  if (!animLock && keyStates['Space'] && (playerOnFloor || canCoyote)){
    verticalVelocity = JUMP_VEL;
    playerOnFloor = false;
    keyStates['Space'] = false;
    playOneShot(actions.jump, 0.12, ()=> playAction(movementActionFromKeys(),0.14));
  }

  if (pushingKey){
    pushBoxesForward();
    playAction(actions.push, 0.1);
  } else if (!animLock && (isF||isB||isL||isR)){
    if (isF) move.add(forward);
    if (isB) move.add(forward.clone().multiplyScalar(-1));
    if (isL) move.add(right.clone().multiplyScalar(-1));
    if (isR) move.add(right);

    move.normalize().multiplyScalar(difficultyFor(currentLevel).speed * dt);
    playerCollider.translate(move);

    if ((isL||isR) && !(isF||isB)){
      if (isL) playAction(actions.walkL, 0.12);
      if (isR) playAction(actions.walkR, 0.12);
    } else {
      playAction(actions.jogging, 0.12);
    }
  } else if (!animLock){
    playAction(actions.look, 0.18);
  }

  verticalVelocity -= difficultyFor(currentLevel).gravity * dt;
  playerCollider.translate(new THREE.Vector3(0, verticalVelocity * dt, 0));

  playerOnFloor=false;
  const hitV=worldOctree?.capsuleIntersect(playerCollider);
  if (hitV){
    playerCollider.translate(hitV.normal.multiplyScalar(hitV.depth + 1e-4));
    if (hitV.normal.y>0.5){
      playerOnFloor=true;
      lastOnFloorMs = now;
      verticalVelocity=Math.max(0,verticalVelocity);
    }
  }

  player.position.copy(playerCollider.start);
  player.position.y -= 0.5;
}

/* ===================== Estados ===================== */
function startGame(){
  if (!assetsReady) return;
  hideAllOverlays(); setHudVisible(true);
  safePlay(bgMusic);

  score=0; updateScoreUI(); currentLevel=1; levelEl && (levelEl.textContent='1');
  timeLeft=levels[1].duration; updateTimerUI();
  if (gemCount) gemCount.textContent='0';
  if (bookCount) bookCount.textContent='0';
  if (potionCount) potionCount.textContent='0';

  player.position.set(0,0.5,0);
  playerCollider.start.set(0,1.0,0);
  playerCollider.end.set(0,2.0,0);
  verticalVelocity=-1; playerOnFloor=false;

  spawnTreasures(1);
  ensureMinimumTreasures();
  spawnBoxesForLevel(1);

  playOneShot(actions.strong, 0.2, ()=> playAction(actions.look,0.2));
  gameState='playing';
}
function pauseGame(){
  gameState='paused'; applyVolumes();
  hideAllOverlays();
  if (pauseMenu) pauseMenu.style.display='flex';
}
function resumeGame(){
  gameState='playing'; applyVolumes();
  hideAllOverlays(); setHudVisible(true);
}
function levelUp(){
  gameState='paused'; currentLevel++; levelEl&&(levelEl.textContent=String(currentLevel)); safePlay(sfxLevelUp);
  if (levelUpMessage){ levelUpMessage.textContent=`Nivel ${currentLevel}`; levelUpMessage.style.display='block'; }
  playOneShot(actions.strong, 0.22, ()=>{
    levelUpMessage && (levelUpMessage.style.display='none');
    gameState='playing';
    timeLeft=levels[currentLevel].duration; updateTimerUI();
    spawnTreasures(currentLevel); ensureMinimumTreasures(); spawnBoxesForLevel(currentLevel);
    if (currentLevel===2) scene.fog.far=70; if (currentLevel>=3) scene.fog.far=60;
    playAction(movementActionFromKeys(),0.2);
  });
}
function loseGame(){
  gameState='finished';
  setHudVisible(false);

  safePlay(sfxGameOver);
  if (bgMusic) bgMusic.setVolume(audioMuted ? 0 : VOL.bg * 0.25);

  const finalScoreEl = document.getElementById('final-score');
  if (finalScoreEl) finalScoreEl.textContent = String(score);
  const h2 = victoryEl?.querySelector('h2');
  if (h2) h2.textContent = '💀 Game Over';
  hideAllOverlays();
  if (victoryEl) victoryEl.style.display='flex';
  saveScore();
}
function winGame(){
  if (gameState==='finished') return;
  gameState='finished';
  setHudVisible(false);
  const finalScoreEl = document.getElementById('final-score');
  if (finalScoreEl) finalScoreEl.textContent = String(score);
  const h2 = victoryEl?.querySelector('h2');
  if (h2) h2.textContent = '¡Felicidades, viajero!';
  hideAllOverlays();
  if (victoryEl) victoryEl.style.display='flex';
  playAction(actions.macaco,0.25);
  saveScore();
}

/* ===================== Scoreboard (modal + botón 🏆 fijo a la derecha) ===================== */
function openScoreboard(){
  const board = document.getElementById('scoreboard');
  if (!board) return;
  board.style.display = 'flex';
  board.style.zIndex = '10005';
  renderScores();
}
function injectScoreboardUI(){
  let board = document.getElementById('scoreboard');
  if (!board){
    board = document.createElement('div');
    board.id = 'scoreboard';
    board.className = 'golden-card';
    board.style.display = 'none';
    board.innerHTML = `
      <h2>🏆 Mejores puntajes</h2>
      <table style="width:100%; border-collapse:separate; border-spacing:0 6px;">
        <thead><tr><th style="text-align:left">#</th><th style="text-align:left">Puntaje</th><th style="text-align:left">Nivel</th><th style="text-align:left">Fecha</th></tr></thead>
        <tbody id="score-rows"></tbody>
      </table>
      <div style="margin-top:10px"><button id="closeScore" class="btn">Cerrar</button></div>`;
    document.body.appendChild(board);
    document.getElementById('closeScore').addEventListener('click', ()=>{ board.style.display='none'; });
  }

  let fab = document.getElementById('scoreButton');
  if (!fab){
    fab = document.createElement('button');
    fab.id='scoreButton';
    fab.textContent='🏆';
    Object.assign(fab.style,{
      position:'fixed', bottom:'18px', right:'18px',
      width:'54px', height:'54px', borderRadius:'50%',
      display:'block',
      alignItems:'center', justifyContent:'center',
      fontSize:'22px', color:'#fff',
      background:'radial-gradient(120% 120% at 50% 30%, rgba(255,210,122,.28), rgba(0,0,0,.55))',
      border:'1px solid rgba(255,210,122,.35)',
      boxShadow:'0 0 18px rgba(255,210,122,.25), inset 0 0 12px rgba(255,210,122,.14)',
      cursor:'pointer', zIndex:'10001'
    });
    document.body.appendChild(fab);
    fab.addEventListener('click', ()=>{
      const open = board.style.display==='flex';
      board.style.display = open ? 'none' : 'flex';
      board.style.zIndex = '10005';
      renderScores();
    });
  }
  renderScores();
}
function saveScore(){
  const key='lostpath_scores';
  const arr=JSON.parse(localStorage.getItem(key)||'[]');
  arr.push({ score, level:currentLevel, date:new Date().toLocaleString() });
  arr.sort((a,b)=>b.score-a.score);
  localStorage.setItem(key, JSON.stringify(arr.slice(0,10)));
  renderScores();
}
function renderScores(){
  const rows=document.getElementById('score-rows'); if(!rows) return;
  const arr=JSON.parse(localStorage.getItem('lostpath_scores')||'[]');
  rows.innerHTML = arr.length ?
    arr.map((r,i)=>`<tr><td>${i+1}</td><td>${r.score}</td><td>${r.level}</td><td>${r.date}</td></tr>`).join('') :
    `<tr><td colspan="4">Sin registros</td></tr>`;
}

/* ===================== Main Loop ===================== */
function animate(){
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  mixer && mixer.update(dt);

  if (gameState==='playing'){
    timeLeft -= dt;
    if (timeLeft<=0){
      (score>=WIN_SCORE)?winGame():loseGame();
      timeLeft = 0;
      updateTimerUI();
    } else updateTimerUI();

    // subpasos pequeños para estabilidad
    const steps = Math.max(1, Math.ceil(dt / 0.005));
    const step = dt / steps;
    for (let i = 0; i < steps; i++) {
      updatePlayerPhysics(step);
      updateBoxes(step);
    }
    updateTreasures(dt);

    if (currentLevel<3 && score>=LEVEL_SCORE_STEP*currentLevel) levelUp();
    if (score>=WIN_SCORE) winGame();
  }

  // flicker cálido
  const t = performance.now() * 0.001;
  for (let i=0;i<warmLights.length;i++){
    warmLights[i].intensity = 0.9 + 0.15 * Math.sin(t * 2.2 + i);
  }
  if (playerTopLight){
    playerTopLight.intensity = 0.9 + 0.1 * Math.sin(t * 3.1);
  }

  updateCamera(dt);
  renderer.render(scene, camera);
}
