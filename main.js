import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { OctreeHelper } from 'three/examples/jsm/helpers/OctreeHelper.js';
import Benchmark from './Benchmarks.js';

// ============================================================
// CONFIG — modifie ces valeurs pour ajuster le comportement
// ============================================================
const CONFIG = {
    assets: [
        "1_floor_aisle_b_jpeg_draco.glb",
    ],
    spawnPoint: new THREE.Vector3(85, 9, -3.1),
    buildingScale: 1,       // Essaie 0.01 si le bâtiment est en cm (export UE)
    playerRadius: 0.25, // Repasse à 0.25, 0.1 est trop instable
    playerHeight: 1.2,
    moveSpeed: 5,           // Unités/seconde
    gravity: 30,            // m/s²
    debugCapsule: true,     // Affiche la capsule en wireframe rouge
    debugOctree: true,      // Affiche l'octree
};
// ============================================================

// --- Écran de chargement ---
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
    <p id="loading-label" style="margin-bottom: 12px; font-size: 1rem; opacity: 0.8;">Chargement du modèle...</p>
    <div style="width: 300px; height: 6px; background: #333; border-radius: 3px; overflow: hidden;">
        <div id="loading-bar" style="height: 100%; width: 0; background: #4466ff; transition: width 0.1s;"></div>
    </div>
    <p id="loading-percent" style="margin-top: 8px; font-size: 0.85rem; opacity: 0.6;">0%</p>
    <p id="loading-file" style="margin-top: 4px; font-size: 0.75rem; opacity: 0.4;"></p>
`;
document.body.appendChild(loadingScreen);

const loadingBar     = document.getElementById('loading-bar');
const loadingPercent = document.getElementById('loading-percent');
const loadingFile    = document.getElementById('loading-file');

function updateProgress(fileIndex, filePercent) {
    const global = Math.round(((fileIndex + filePercent / 100) / CONFIG.assets.length) * 100);
    loadingBar.style.width = `${global}%`;
    loadingPercent.textContent = `${global}%`;
    loadingFile.textContent = CONFIG.assets[fileIndex];
}

// --- Scene ---
const stats = new Stats();
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- Menu ---
const menuPanel  = document.getElementById('menuPanel');
const startButton = document.getElementById('startButton');
startButton.addEventListener('click', () => controls.lock(), false);

// --- Benchmark ---
const benchmark = new Benchmark(renderer, scene, camera);

// --- DRACO ---
const dLoader = new DRACOLoader();
dLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
dLoader.setDecoderConfig({ type: "js" });

// --- Physique ---
const clock        = new THREE.Clock();
const worldOctree  = new Octree();
const playerVelocity  = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let playerOnFloor = false;

// Capsule — positionnée au spawn
// Modifie l'initialisation de ta capsule
// Modifie l'initialisation de ta capsule
const playerCapsule = new Capsule(
    new THREE.Vector3(CONFIG.spawnPoint.x, CONFIG.spawnPoint.y + 0.35, CONFIG.spawnPoint.z), // +0.35 pour décoller du sol
    new THREE.Vector3(CONFIG.spawnPoint.x, CONFIG.spawnPoint.y + 0.35 + CONFIG.playerHeight, CONFIG.spawnPoint.z),
    CONFIG.playerRadius
);

// --- Helper Octree ---
const octreeHelper = new OctreeHelper(worldOctree);
octreeHelper.visible = CONFIG.debugOctree;
scene.add(octreeHelper);

// --- Helper Capsule (wireframe rouge) ---
const capsuleHelperGroup = new THREE.Group();
capsuleHelperGroup.visible = CONFIG.debugCapsule;
const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
const bodyMesh   = new THREE.Mesh(new THREE.CylinderGeometry(CONFIG.playerRadius, CONFIG.playerRadius, CONFIG.playerHeight, 8), debugMat);
const sphereTop  = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.playerRadius, 8, 8), debugMat);
const sphereBot  = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.playerRadius, 8, 8), debugMat);
sphereTop.position.y =  CONFIG.playerHeight / 2;
sphereBot.position.y = -CONFIG.playerHeight / 2;
capsuleHelperGroup.add(bodyMesh, sphereTop, sphereBot);
scene.add(capsuleHelperGroup);

// --- Contrôles FPS ---
const controls = new PointerLockControls(camera, renderer.domElement);
controls.addEventListener('lock',   () => menuPanel.style.display = 'none');
controls.addEventListener('unlock', () => menuPanel.style.display = 'block');

// --- Lumières ---
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dirLight = new THREE.DirectionalLight(0xffffff, 3);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// --- Chargement ---
const loader = new GLTFLoader();
loader.setDRACOLoader(dLoader);
const buildingRoot = new THREE.Group();
scene.add(buildingRoot);

const t0 = performance.now();

for (let i = 0; i < CONFIG.assets.length; i++) {
    try {
        const gltf = await loader.loadAsync(CONFIG.assets[i], (event) => {
            const filePercent = event.lengthComputable
                ? Math.round((event.loaded / event.total) * 100)
                : 0;
            updateProgress(i, filePercent);
        });

        const part = gltf.scene;

        part.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material.map) child.material.map.anisotropy = 16;
                if (child.material.lightMap) child.material.lightMapIntensity = 1.0;

                // Force l'affichage des deux côtés pour voir s'il manque des murs
                child.material.side = THREE.DoubleSide;

                // Force le calcul des normales
                child.geometry.computeVertexNormals();

                if (child.isMesh && child.visible) {
                    // On crée une version simplifiée pour la physique
                    worldOctree.fromGraphNode(child);
                }
            }
        });

        buildingRoot.add(part);

        // Diagnostic taille par partie
        const partBox  = new THREE.Box3().setFromObject(part);
        const partSize = partBox.getSize(new THREE.Vector3());
        console.log(`✅ ${CONFIG.assets[i]} — taille brute :`, partSize);

    } catch (error) {
        console.error(`❌ Erreur chargement ${CONFIG.assets[i]} :`, error);
    }
}

// --- Appliquer le scale AVANT de construire l'Octree ---
buildingRoot.scale.setScalar(CONFIG.buildingScale);
buildingRoot.updateMatrixWorld(true); // Force le recalcul des matrices mondiales

// Octree reconstruit sur le buildingRoot scalé
worldOctree.fromGraphNode(buildingRoot);

// Diagnostic taille totale
const totalBox  = new THREE.Box3().setFromObject(buildingRoot);
const totalSize = totalBox.getSize(new THREE.Vector3());
const center    = totalBox.getCenter(new THREE.Vector3());
console.log("🏗️ Bâtiment complet — taille totale :", totalSize);
console.log("📐 Centre du bâtiment :", center);
console.log(`💡 Si les couloirs font ~${totalSize.x.toFixed(1)} unités de large, `
    + `un humain devrait faire ~1.8 unités. Ajuste CONFIG.buildingScale si nécessaire.`);
console.log(`👤 Rayon capsule actuel : ${CONFIG.playerRadius} — `
    + `largeur couloir estimée : ${(totalSize.x).toFixed(2)}`);

// Camera au spawn
camera.position.copy(CONFIG.spawnPoint);

// Masquer l'écran de chargement
loadingScreen.style.transition = 'opacity 0.5s';
loadingScreen.style.opacity = '0';
setTimeout(() => loadingScreen.remove(), 500);

const t1 = performance.now();
console.log(`⏱️ Temps de chargement : ${((t1 - t0) / 1000).toFixed(4)}s`);

// --- Clavier ---
const keyMap = {};
document.addEventListener('keydown', (e) => { keyMap[e.code] = true; });
document.addEventListener('keyup',   (e) => { keyMap[e.code] = false; });

// Touche F1 : toggle debug visuel
document.addEventListener('keydown', (e) => {
    if (e.code === 'F1') {
        e.preventDefault();
        CONFIG.debugCapsule = !CONFIG.debugCapsule;
        CONFIG.debugOctree  = !CONFIG.debugOctree;
        capsuleHelperGroup.visible = CONFIG.debugCapsule;
        octreeHelper.visible       = CONFIG.debugOctree;
        console.log(`Debug visuel : ${CONFIG.debugCapsule ? 'ON' : 'OFF'}`);
    }
});

// --- Resize ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function playerCollisions() {
    // On récupère toutes les collisions potentielles, pas juste la première
    const result = worldOctree.capsuleIntersect(playerCapsule);
    playerOnFloor = false;

    if (result) {
        // Si la normale de la collision est très verticale (le sol)
        // On considère qu'on est sur le sol même si c'est un triangle bizarre
        playerOnFloor = result.normal.y > 0.05;

        // CRUCIAL : Si on touche un "mur" (normale horizontale) alors qu'on est au sol,
        // on ignore la collision si elle est trop petite (depth < 0.02)
        // Ça permet de "passer par dessus" les micro-lignes qui traversent ton sol.
        if (result.depth > 0.02) {
            playerCapsule.translate(result.normal.multiplyScalar(result.depth));
        }

        // On réinitialise la vitesse verticale si on touche le sol
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

// --- Boucle de rendu ---
function animate() {
    const deltaTime = Math.min(0.05, clock.getDelta());

    if (controls.isLocked) {
        const speed = CONFIG.moveSpeed * deltaTime;

        // Reset horizontal uniquement — on conserve le Y (gravité)
        const yVelocity = playerVelocity.y;
        playerVelocity.set(0, yVelocity, 0);

        // Déplacement
        if (keyMap['KeyW'] || keyMap['ArrowUp'])    playerVelocity.add(getForwardVector().multiplyScalar(speed));
        if (keyMap['KeyS'] || keyMap['ArrowDown'])  playerVelocity.add(getForwardVector().multiplyScalar(-speed));
        if (keyMap['KeyA'] || keyMap['ArrowLeft'])  playerVelocity.add(getSideVector().multiplyScalar(-speed));
        if (keyMap['KeyD'] || keyMap['ArrowRight']) playerVelocity.add(getSideVector().multiplyScalar(speed));

        // Gravité
        if (!playerOnFloor) {
            playerVelocity.y -= CONFIG.gravity * deltaTime;
        } else {
            playerVelocity.y = Math.max(0, playerVelocity.y);
        }

        // Déplacement + collisions
        playerCapsule.translate(playerVelocity);
        playerCollisions();

        // Caméra = sommet de la capsule
        camera.position.copy(playerCapsule.end);

        // Helper capsule suit le joueur
        if (CONFIG.debugCapsule) {
            const mid = playerCapsule.start.clone().lerp(playerCapsule.end, 0.5);
            capsuleHelperGroup.position.copy(mid);
        }
    }

    // P : log position
    if (keyMap['KeyP']) {
        console.log("📍 Position :", camera.position.clone().round());
        console.log("🧱 Sur le sol :", playerOnFloor);
    }

    stats.update();
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);