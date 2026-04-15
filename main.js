import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import Benchmark from './Benchmarks.js';

// ================= CONFIG =================
const CONFIG = {
    assets: [
        "1_floor_aisle_b_jpeg_draco.glb",
        "2_floor_aisle_b_jpeg_draco.glb",
        "stair.glb"
    ],
    spawnPoint: new THREE.Vector3(85, 11, -3.1),
    buildingScale: 1,
    playerRadius: 0.25,
    playerHeight: 1.2,
    moveSpeed: 6,
    gravity: 30
};

// --- Chrono ---
const t0 = performance.now();

// ================= LOADING SCREEN UI =================
const loadingScreen = document.createElement('div');
loadingScreen.style.cssText = `
    position: fixed; inset: 0;
    background: #1a1a2e;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 100;
    color: white;
    font-family: sans-serif;
`;
loadingScreen.innerHTML = `
    <p style="margin-bottom: 10px;">Initialisation du complexe...</p>
    <div style="width: 300px; height: 6px; background: #333;">
        <div id="bar" style="height:100%; width:0; background:#4466ff;"></div>
    </div>
    <p id="percent">0%</p>
`;
document.body.appendChild(loadingScreen);
const bar = document.getElementById("bar");
const percent = document.getElementById("percent");

// ================= SCENE SETUP =================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 10000);
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1));

// ================= TOOLS =================
const stats = new Stats();
document.body.appendChild(stats.dom);
const benchmark = new Benchmark(renderer, scene, camera);

// ================= CONTROLS =================
const menuPanel = document.getElementById('menuPanel');
const startButton = document.getElementById('startButton');
const controls = new PointerLockControls(camera, renderer.domElement);

startButton?.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => { if(menuPanel) menuPanel.style.display = 'none'; });
controls.addEventListener('unlock', () => { if(menuPanel) menuPanel.style.display = 'block'; });

// ================= PHYSIQUE =================
const worldOctree = new Octree();
const clock = new THREE.Clock();
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let playerOnFloor = false;

const playerCapsule = new Capsule(
    new THREE.Vector3(CONFIG.spawnPoint.x, CONFIG.spawnPoint.y + 0.35, CONFIG.spawnPoint.z),
    new THREE.Vector3(CONFIG.spawnPoint.x, CONFIG.spawnPoint.y + 0.35 + CONFIG.playerHeight, CONFIG.spawnPoint.z),
    CONFIG.playerRadius
);

// ================= LOAD ASSETS =================
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
loader.setDRACOLoader(draco);

const buildingRoot = new THREE.Group();
scene.add(buildingRoot);

async function loadAssets() {
    try {
        for (let i = 0; i < CONFIG.assets.length; i++) {
            const gltf = await loader.loadAsync(CONFIG.assets[i], (e) => {
                if (e.lengthComputable) {
                    const p = Math.round((e.loaded / e.total) * 100);
                    bar.style.width = p + "%";
                    percent.textContent = p + "%";
                }
            });

            gltf.scene.traverse(child => {
                if (child.isMesh) {
                    child.material.side = THREE.DoubleSide;
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            buildingRoot.add(gltf.scene);
        }

        buildingRoot.scale.setScalar(CONFIG.buildingScale);
        buildingRoot.updateMatrixWorld(true);
        worldOctree.fromGraphNode(buildingRoot);

        // --- Fin du chrono ---
        const t1 = performance.now();
        console.log(`⏱️ Temps de chargement total : ${((t1 - t0) / 1000).toFixed(3)} secondes.`);

        loadingScreen.style.display = "none";
        camera.position.copy(playerCapsule.end);

    } catch (error) {
        console.error("Erreur critique au chargement :", error);
    }
}

async function loadDecorations() {
    const gltf = await loader.loadAsync("chairs.glb");
    const model = gltf.scene;

    model.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.material.side = THREE.DoubleSide; // Force l'affichage des deux côtés
            child.material.flatShading = false; // Pour éviter l'aspect facetté (triangles visibles)
            // IMPORTANT : On ne fait PAS worldOctree.fromGraphNode(child)
        }
    });

    scene.add(model);
}

loadAssets();
// loadDecorations();


// ================= INPUT (AZERTY) =================
const keyMap = {};
document.addEventListener('keydown', e => keyMap[e.code] = true);
document.addEventListener('keyup', e => keyMap[e.code] = false);

// ================= COLLISION ENGINE =================
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

// ================= MAIN LOOP =================
function animate() {
    const deltaTime = Math.min(0.05, clock.getDelta());

    if (controls.isLocked) {
        const speed = CONFIG.moveSpeed;
        const yVel = playerVelocity.y;
        playerVelocity.set(0, yVel, 0);

        // Contrôles AZERTY
        if (keyMap['KeyW'] || keyMap['ArrowUp'])    playerVelocity.add(getForwardVector().multiplyScalar(speed));
        if (keyMap['KeyS'] || keyMap['ArrowDown'])  playerVelocity.add(getForwardVector().multiplyScalar(-speed));
        if (keyMap['KeyA'] || keyMap['ArrowLeft'])  playerVelocity.add(getSideVector().multiplyScalar(-speed));
        if (keyMap['KeyD'] || keyMap['ArrowRight']) playerVelocity.add(getSideVector().multiplyScalar(speed));
        if (keyMap['KeyP']) console.log(camera.position);

        if (!playerOnFloor) {
            playerVelocity.y -= CONFIG.gravity * deltaTime;
        }

        playerCapsule.translate(playerVelocity.clone().multiplyScalar(deltaTime));
        playerCollisions();

        camera.position.copy(playerCapsule.end);
    }

    stats.update();
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});