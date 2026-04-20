import * as THREE from 'three';
import {PointerLockControls} from 'three/addons/controls/PointerLockControls.js';
import {DRACOLoader} from "three/examples/jsm/loaders/DRACOLoader";
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import {computeBoundsTree, disposeBoundsTree, acceleratedRaycast} from 'three-mesh-bvh';
import Benchmark from './Benchmarks.js';
import jsonParser from "./jsonLoader/jsonParser";
import {Zone} from './mapManager/Zone.js'
import {ZoneManager} from './mapManager/ZoneManager'

// Monkey-patch Three.js
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ================= CONFIG =================
const CONFIG = {
    startZone: 'floor2',
    spawnPoint: new THREE.Vector3(85, 13, -3.1),
    playerRadius: 0.4,
    playerHeight: 1.3,
    moveSpeed: 6,
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

let skyArray = [];
let texture_ft = new THREE.TextureLoader().load('models/skybox/miramar_ft.jpg');
let texture_bk = new THREE.TextureLoader().load('models/skybox/miramar_bk.jpg');
let texture_up = new THREE.TextureLoader().load('models/skybox/miramar_up.jpg');
let texture_dn = new THREE.TextureLoader().load('models/skybox/miramar_dn.jpg');
let texture_rt = new THREE.TextureLoader().load('models/skybox/miramar_rt.jpg');
let texture_lf = new THREE.TextureLoader().load('models/skybox/miramar_lf.jpg');

skyArray.push(new THREE.MeshBasicMaterial({map: texture_ft}));
skyArray.push(new THREE.MeshBasicMaterial({map: texture_bk}));
skyArray.push(new THREE.MeshBasicMaterial({map: texture_up}));
skyArray.push(new THREE.MeshBasicMaterial({map: texture_dn}));
skyArray.push(new THREE.MeshBasicMaterial({map: texture_rt}));
skyArray.push(new THREE.MeshBasicMaterial({map: texture_lf}));

for (let i = 0; i < 6; i++) {
    skyArray[i].side = THREE.BackSide;
}

let skyboxGeo = new THREE.BoxGeometry(10000, 10000, 10000);
let skybox = new THREE.Mesh(skyboxGeo, skyArray);
scene.add(skybox);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
scene.add(camera);

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

// La capsule est représentée par sa position (centre bas) + rayon + hauteur.
const playerPos = CONFIG.spawnPoint.clone();  // position du bas de la capsule
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let playerOnFloor = false;

const _capsuleBottom = new THREE.Vector3();
const _capsuleTop = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

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

// ================= CHARGEMENT DU PERSONNAGE =================
const player = new THREE.Group();
scene.add(player);

let characterModel = null;
let mixer = null;

// Noms de nodes à masquer en vue FPS
const FPS_HIDDEN_PARTS = ['head', 'hair', 'eyes', 'internal', 'internal2'];

gltfLoader.load('models/players/woman_anim.glb', (gltf) => {
    characterModel = gltf.scene;
    characterModel.scale.set(0.8, 0.8, 0.8);
    characterModel.position.y = 0;
    characterModel.rotation.y = Math.PI; // Rotation de 180 deg

    characterModel.traverse(node => {
        if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
            const nameLower = node.name.toLowerCase();
            node.visible = !FPS_HIDDEN_PARTS.some(part => nameLower.includes(part));
        }
    });

    mixer = new THREE.AnimationMixer(characterModel);

    const animations = gltf.animations;
    const clip = animations[0];

    // Supprime les déplacement du modèle (root motion)
    clip.tracks = clip.tracks.filter(track => {
        return !(track.name.includes('position') &&
            (track.name.includes('Hips') || track.name.includes('hips')));
    });

    const walkAction = mixer.clipAction(clip);
    walkAction.play();
    walkAction.paused = true;
    characterModel.userData.walkAction = walkAction;

    player.add(characterModel);

}, undefined, (error) => console.error("Erreur chargement personnage :", error));

// ================= ZONE MANAGER =================
// On passe colliderMeshes au ZoneManager
// Il y ajoute/retire les meshes de collision selon les zones visibles
const colliderMeshes = [];

const zoneManager = new ZoneManager({scene, loader: gltfLoader, colliderMeshes});
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
    if (e.code === 'F3') {
        e.preventDefault();
        debugColliderMeshes();
    }
});

// ================= RESIZE =================


window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ================= PHYSIQUE BVH =================

function debugColliderMeshes() {

    colliderMeshes.forEach(mesh => {
        // On crée un clone visuel en fil de fer pour ne pas casser le matériau original
        const wireframeGeom = new THREE.WireframeGeometry(mesh.geometry);
        const wireframe = new THREE.LineSegments(wireframeGeom);

        // On applique la même position/rotation que le mesh original
        wireframe.matrixAutoUpdate = false;
        wireframe.matrix.copy(mesh.matrixWorld);

        // Couleur rouge pour les collisions
        wireframe.material.color.set(0xff0000);
        wireframe.material.opacity = 0.5;
        wireframe.material.transparent = true;

        scene.add(wireframe);
    });
}

/**
 * Résolution des collisions capsule/monde via BVH.
 * Teste chaque mesh de collision actif dans colliderMeshes.
 * Pousse le joueur hors des surfaces de manière itérative.
 */
function playerCollisions() {
    playerOnFloor = false;

    const EPS = 0.002;          // seuil anti micro-collisions
    const MAX_PUSH = 3;         // limite de corrections par mesh
    let pushCount = 0;

    _capsuleBottom.copy(playerPos);
    _capsuleBottom.y = playerPos.y + CONFIG.playerRadius;

    _capsuleTop.copy(playerPos);
    _capsuleTop.y = playerPos.y + CONFIG.playerHeight - CONFIG.playerRadius;

    for (const mesh of colliderMeshes) {
        if (!mesh.geometry.boundsTree) continue;

        pushCount = 0;

        const invMat = _matrix.copy(mesh.matrixWorld).invert();

        const localBottom = _capsuleBottom.clone().applyMatrix4(invMat);
        const localTop = _capsuleTop.clone().applyMatrix4(invMat);

        const scale = mesh.matrixWorld.getMaxScaleOnAxis();
        const localR = CONFIG.playerRadius / scale;

        mesh.geometry.boundsTree.shapecast({
            intersectsBounds: box => {
                const capsuleBox = new THREE.Box3();

                capsuleBox.min.set(
                    Math.min(localBottom.x, localTop.x) - localR,
                    Math.min(localBottom.y, localTop.y) - localR,
                    Math.min(localBottom.z, localTop.z) - localR
                );

                capsuleBox.max.set(
                    Math.max(localBottom.x, localTop.x) + localR,
                    Math.max(localBottom.y, localTop.y) + localR,
                    Math.max(localBottom.z, localTop.z) + localR
                );

                return capsuleBox.intersectsBox(box);
            },

            intersectsTriangle: tri => {

                if (pushCount >= MAX_PUSH) return false;

                const capsuleSeg = new THREE.Line3(localBottom, localTop);

                const closestPointOnTriangle = new THREE.Vector3();
                const closestPointOnSegment = new THREE.Vector3();

                tri.closestPointToSegment(
                    capsuleSeg,
                    closestPointOnTriangle,
                    closestPointOnSegment
                );

                const distance = closestPointOnSegment.distanceTo(closestPointOnTriangle);

                // seuil anti jitter
                if (distance >= localR - EPS) return false;

                const depth = localR - distance;

                _normal.subVectors(closestPointOnSegment, closestPointOnTriangle);

                if (_normal.lengthSq() === 0) return false;

                _normal.normalize();

                const worldNormal = _normal.clone().transformDirection(mesh.matrixWorld);

                // --- SOL ---
                if (worldNormal.y > 0.5) {
                    playerOnFloor = true;

                    // empêche rebond vertical
                    if (playerVelocity.y < 0) playerVelocity.y = 0;

                    // colle légèrement au sol (empêche les micro-sauts)
                    playerPos.y -= EPS;
                }

                // --- PLAFOND ---
                else if (worldNormal.y < -0.5) {
                    if (playerVelocity.y > 0) playerVelocity.y = 0;
                }

                // --- MUR / ESCALIER ---
                else {
                    // glissement
                    const dot = playerVelocity.dot(worldNormal);
                    if (dot < 0) {
                        playerVelocity.addScaledVector(worldNormal, -dot);
                    }
                }

                // correction position avec clamp
                const push = depth * scale + 0.003;
                playerPos.addScaledVector(worldNormal, push);

                pushCount++;

                return false;
            }
        });
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

    // Mise à jour du mixer
    if (mixer) mixer.update(deltaTime);

    if (controls.isLocked) {
        const speed = CONFIG.moveSpeed;
        const yVel = playerVelocity.y;
        playerVelocity.set(0, yVel, 0);

        const isMoving =
            keyMap['KeyW'] || keyMap['ArrowUp'] ||
            keyMap['KeyS'] || keyMap['ArrowDown'] ||
            keyMap['KeyA'] || keyMap['ArrowLeft'] ||
            keyMap['KeyD'] || keyMap['ArrowRight'];

        if (keyMap['KeyW'] || keyMap['ArrowUp']) playerVelocity.add(getForwardVector().multiplyScalar(speed));
        if (keyMap['KeyS'] || keyMap['ArrowDown']) playerVelocity.add(getForwardVector().multiplyScalar(-speed));
        if (keyMap['KeyA'] || keyMap['ArrowLeft']) playerVelocity.add(getSideVector().multiplyScalar(-speed));
        if (keyMap['KeyD'] || keyMap['ArrowRight']) playerVelocity.add(getSideVector().multiplyScalar(speed));

        if (characterModel?.userData.walkAction) {
            characterModel.userData.walkAction.paused = !isMoving;
        }

        if (!playerOnFloor) {
            playerVelocity.y -= CONFIG.gravity * deltaTime;
        } else {
            playerVelocity.y = Math.max(0, playerVelocity.y);
        }

        const steps = 8;
        const subDelta = deltaTime / steps;

        for (let i = 0; i < steps; i++) {

            // appliquer gravité
            if (!playerOnFloor) {
                playerVelocity.y -= CONFIG.gravity * subDelta;
            }

            // déplacement
            const deltaMove = playerVelocity.clone().multiplyScalar(subDelta);
            playerPos.add(deltaMove);

            // collisions
            playerCollisions();

        }

        // Limite le regard vertical
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        euler.x = Math.max(-0.9, Math.min(Math.PI / 2, euler.x));
        camera.quaternion.setFromEuler(euler);

        // Caméra FPS
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        camera.position.set(
            playerPos.x + forward.x * 0.12, // 0.12 pour être juste devant les yeux
            playerPos.y + CONFIG.playerHeight,
            playerPos.z + forward.z * 0.12 // 0.12 pour être juste devant les yeux
        );

        // Modèle visible
        player.position.copy(playerPos);
        if (characterModel) {
            const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
            characterModel.rotation.y = yaw + Math.PI;
        }

        // ZoneManager : détection de transition à chaque frame
        zoneManager.update(camera.position);

        if (CONFIG.debugCapsule) {
            capsuleHelper.position.set(
                playerPos.x,
                playerPos.y + CONFIG.playerHeight / 2,
                playerPos.z
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
    document.getElementById('current_zone').textContent = "Zone actuelle : " + zoneManager.currentZone?.name ?? 'aucune';
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
