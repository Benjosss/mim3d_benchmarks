import * as THREE from 'three';
import {PointerLockControls} from 'three/addons/controls/PointerLockControls.js';
import {DRACOLoader} from "three/examples/jsm/loaders/DRACOLoader";
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import {Octree} from 'three/examples/jsm/math/Octree.js';
import {Capsule} from 'three/examples/jsm/math/Capsule.js';
import Benchmark from './Benchmarks.js';
import jsonParser from "./jsonLoader/jsonParser";
import {Zone} from './mapManager/Zone.js'
import {ZoneManager} from './mapManager/ZoneManager'

// ================= CONFIG =================
const CONFIG = {
    startZone: 'floor2',
    spawnPoint: new THREE.Vector3(85, 13, -3.1),
    // spawnPoint: new THREE.Vector3(0, 11, 0),
    playerRadius: 0.2,
    playerHeight: 1.0,
    moveSpeed: 5,
    gravity: 30,
    debugCapsule: false,
};

// ================= DÉFINITION DES ZONES =================
let ZONES = [];

const parser = new jsonParser("data/data.json");

const jsonData = await parser.fetchJSONData();

if (!jsonData) {
    console.log("Impossible de charger les zones");
} else {
    jsonData.forEach((zone) => {
        ZONES.push(
            new Zone({
                name: zone.name,
                path: zone.path,
                adjacentZoneNames: zone.adjacentZoneNames || [],
                type: zone.type,
                triggerBox: new THREE.Box3(
                    new THREE.Vector3(...zone.triggerBox.min),
                    new THREE.Vector3(...zone.triggerBox.max)
                ),
            })
        );
    });
}

console.log(ZONES);

// --- Chrono ---
const t0 = performance.now();

// ================= LOADING SCREEN UI =================
const loadingScreen = document.createElement('div');
loadingScreen.style.cssText = `
    position: fixed; inset: 0; background: #1a1a2e;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    z-index: 100; color: white; font-family: sans-serif;
`;
loadingScreen.innerHTML = `
    <p style="margin-bottom: 12px; font-size: 1rem; opacity: 0.8;">Chargement...</p>
    <div style="width: 300px; height: 6px; background: #333; border-radius: 3px; overflow: hidden;">
        <div id="loading-bar" style="height:100%; width:0; background:#4466ff; transition:width 0.3s;"></div>
    </div>
    <p id="loading-percent" style="margin-top: 8px; font-size: 0.85rem; opacity: 0.6;">0%</p>
`;
document.body.appendChild(loadingScreen);

// ================= SCENE SETUP =================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1));
const dirLight = new THREE.DirectionalLight(0xffffff, 3);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// ================= TOOLS =================
const stats = new Stats();
document.body.appendChild(stats.dom);
new Benchmark(renderer, scene, camera);

// ================= PHYSIQUE =================
const clock = new THREE.Clock();
const worldOctree = new Octree();

const playerCapsule = new Capsule(
    CONFIG.spawnPoint.clone(),
    CONFIG.spawnPoint.clone().add(new THREE.Vector3(0, CONFIG.playerHeight, 0)),
    CONFIG.playerRadius
);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let playerOnFloor = false;

// Debug capsule
const debugMat = new THREE.MeshBasicMaterial({color: 0xff0000, wireframe: true});
const capsuleHelper = new THREE.Group();
const bodyMesh = new THREE.Mesh(new THREE.CylinderGeometry(CONFIG.playerRadius, CONFIG.playerRadius, CONFIG.playerHeight, 8), debugMat);
const sphereTop = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.playerRadius, 8, 8), debugMat);
const sphereBot = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.playerRadius, 8, 8), debugMat);
sphereTop.position.y = CONFIG.playerHeight / 2;
sphereBot.position.y = -CONFIG.playerHeight / 2;
capsuleHelper.add(bodyMesh, sphereTop, sphereBot);
capsuleHelper.visible = CONFIG.debugCapsule;
scene.add(capsuleHelper);

// ================= CONTROLS =================
const menuPanel = document.getElementById('menuPanel');
const startButton = document.getElementById('startButton');
const controls = new PointerLockControls(camera, renderer.domElement);

startButton?.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => {
    if (menuPanel) menuPanel.style.display = 'none';
});
controls.addEventListener('unlock', () => {
    if (menuPanel) menuPanel.style.display = 'block';
});


// ================= LOAD ASSETS =================
const dLoader = new DRACOLoader();
dLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
dLoader.setDecoderConfig({type: "js"});

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dLoader);

// ================= ZONE MANAGER =================

const zoneManager = new ZoneManager({scene, loader: gltfLoader, worldOctree});
ZONES.forEach(zone => zoneManager.registerZone(zone));
ZONES.forEach(zone => {
    const helper = new THREE.Box3Helper(zone.triggerBox, 0xffff00);
    scene.add(helper);
});

// Chargement initial — seule la zone de départ est bloquante
document.getElementById('loading-bar').style.width = '30%';
document.getElementById('loading-percent').textContent = 'Zone initiale...';

await zoneManager.init(CONFIG.startZone);

document.getElementById('loading-bar').style.width = '100%';
document.getElementById('loading-percent').textContent = '100%';

loadingScreen.style.transition = 'opacity 0.5s';
loadingScreen.style.opacity = '0';
setTimeout(() => loadingScreen.remove(), 500);

// --- Fin du chrono ---
const t1 = performance.now();
const res_load = `⏱️ Temps de chargement total : ${((t1 - t0) / 1000).toFixed(3)} secondes.`
console.log(`⏱️ Temps de chargement total : ${((t1 - t0) / 1000).toFixed(3)} secondes.`);
const statsHTML = document.getElementById('stats_time');
statsHTML.textContent = res_load;

// ================= INPUT (AZERTY) =================
const keyMap = {};
document.addEventListener('keydown', e => keyMap[e.code] = true);
document.addEventListener('keyup', e => keyMap[e.code] = false);

document.addEventListener('keydown', e => {
    if (e.code === 'F1') {
        e.preventDefault();
        CONFIG.debugCapsule = !CONFIG.debugCapsule;
        capsuleHelper.visible = CONFIG.debugCapsule;
        console.log(`Capsule debug : ${CONFIG.debugCapsule ? 'ON' : 'OFF'}`);
    }
    if (e.code === 'F2') {
        e.preventDefault();
        zoneManager.getStatus(); // Affiche le tableau des zones dans la console
    }
});

// ================= RESIZE =================


window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ================= PHYSIQUE =================
function playerCollisions() {
    const result = worldOctree.capsuleIntersect(playerCapsule);
    playerOnFloor = false;

    if (result) {
        playerOnFloor = result.normal.y > 0.1;

        if (result.depth > 0.01) {
            playerCapsule.translate(result.normal.multiplyScalar(result.depth));
        }

        if (playerOnFloor && playerVelocity.y < 0) {
            playerVelocity.y = 0;
        }
    }
}

function getForwardVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    return playerDirection;
}

function getSideVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    playerDirection.cross(camera.up);
    return playerDirection;
}

// ================= BOUCLE DE RENDU =================
function animate() {
    const deltaTime = Math.min(0.05, clock.getDelta());

    if (controls.isLocked) {
        const speed = CONFIG.moveSpeed;
        const yVel = playerVelocity.y;
        playerVelocity.set(0, yVel, 0);

        // Contrôles AZERTY
        if (keyMap['KeyW'] || keyMap['ArrowUp']) playerVelocity.add(getForwardVector().multiplyScalar(speed));
        if (keyMap['KeyS'] || keyMap['ArrowDown']) playerVelocity.add(getForwardVector().multiplyScalar(-speed));
        if (keyMap['KeyA'] || keyMap['ArrowLeft']) playerVelocity.add(getSideVector().multiplyScalar(-speed));
        if (keyMap['KeyD'] || keyMap['ArrowRight']) playerVelocity.add(getSideVector().multiplyScalar(speed));
        if (keyMap['KeyP']) console.log(camera.position);

        if (!playerOnFloor) {
            playerVelocity.y -= CONFIG.gravity * deltaTime;
        }

        playerCapsule.translate(playerVelocity.clone().multiplyScalar(deltaTime));
        playerCollisions();

        camera.position.copy(playerCapsule.end);

        // ZoneManager : détection de transition à chaque frame
        zoneManager.update(camera.position);

        if (CONFIG.debugCapsule) {
            capsuleHelper.position.copy(
                playerCapsule.start.clone().lerp(playerCapsule.end, 0.5)
            );
        }
    }

    // P : log position + zone courante
    if (keyMap['KeyP']) {
        console.log("📍 Position :", camera.position.clone());
        console.log("🗺️  Zone actuelle :", zoneManager.currentZone?.name ?? 'aucune');
    }

    stats.update();
    document.getElementById('stats_nb_zones').textContent = "Nombres de zones chargées : " + zoneManager.managedZones.size.toString();
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

