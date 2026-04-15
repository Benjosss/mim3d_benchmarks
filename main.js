import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {DRACOLoader} from "three/examples/jsm/loaders/DRACOLoader";
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import Benchmark from './Benchmarks.js';

// --- Liste des fichiers à charger ---
const assets = [
    "1_floor_aisle_b_jpeg_draco.glb",
];

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
    <p id="loading-label" style="margin-bottom: 12px; font-size: 1rem; opacity: 0.8;">
        Chargement du modèle...
    </p>
    <div style="width: 300px; height: 6px; background: #333; border-radius: 3px; overflow: hidden;">
        <div id="loading-bar" style="height: 100%; width: 0; background: #4466ff; transition: width 0.1s;"></div>
    </div>
    <p id="loading-percent" style="margin-top: 8px; font-size: 0.85rem; opacity: 0.6;">0%</p>
    <p id="loading-file" style="margin-top: 4px; font-size: 0.75rem; opacity: 0.4;"></p>
`;
document.body.appendChild(loadingScreen);

const loadingBar = document.getElementById('loading-bar');
const loadingPercent = document.getElementById('loading-percent');
const loadingFile = document.getElementById('loading-file');

function updateProgress(fileIndex, filePercent) {
    // Progression globale : chaque fichier vaut une part égale
    const global = Math.round(((fileIndex + filePercent / 100) / assets.length) * 100);
    loadingBar.style.width = `${global}%`;
    loadingPercent.textContent = `${global}%`;
    loadingFile.textContent = assets[fileIndex];
}

// --- Scene ---
const stats = new Stats();
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
camera.position.set(0, 10, 30);

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Menu de l'app
const menuPanel = document.getElementById('menuPanel');
const startButton = document.getElementById('startButton');
startButton.addEventListener(
    'click',
    function () {
        controls.lock()
    },
    false
)

const benchmark = new Benchmark(renderer, scene, camera);
const dLoader = new DRACOLoader();
dLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
dLoader.setDecoderConfig({type: "js"});

// Controles FPS
const controls = new PointerLockControls(camera, renderer.domElement)
//controls.addEventListener('change', () => console.log("Controls Change"))
controls.addEventListener('lock', () => (menuPanel.style.display = 'none'))
controls.addEventListener('unlock', () => (menuPanel.style.display = 'block'))

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 3);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// --- Chargement séquentiel ---
const loader = new GLTFLoader();
loader.setDRACOLoader(dLoader);
const buildingRoot = new THREE.Group(); // Conteneur unique pour tout le bâtiment
scene.add(buildingRoot);

let t0 = performance.now(); // Timer début du chargement

for (let i = 0; i < assets.length; i++) {
    try {
        const gltf = await loader.loadAsync(assets[i], (event) => {
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
                if (child.material.lightMap) {
                    child.material.lightMapIntensity = 1.0;
                }
            }
        });

        buildingRoot.add(part);

        // Diagnostic par partie
        const box = new THREE.Box3().setFromObject(part);
        const size = box.getSize(new THREE.Vector3());
        console.log(`✅ ${assets[i]} — taille :`, size);

    } catch (error) {
        console.error(`❌ Erreur lors du chargement de ${assets[i]} :`, error);
    }
}

// Centrer la caméra sur le bâtiment complet
const box = new THREE.Box3().setFromObject(buildingRoot);
// const center = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());
// const maxDim = Math.max(size.x, size.y, size.z);
//
// camera.position.set(center.x, center.y + maxDim * 0.5, center.z + maxDim * 1.5);
// camera.far = maxDim * 10;
// camera.updateProjectionMatrix();

// Faire spawn le joueur au bon endroit
const spawnPoint = {x: 85, y: 9, z: -3.1};
camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);

console.log("🏗️ Bâtiment complet — taille totale :", size);

// Masquer l'écran de chargement
loadingScreen.style.transition = 'opacity 0.5s';
loadingScreen.style.opacity = '0';
setTimeout(() => loadingScreen.remove(), 500);

// Controls
const keyMap = {}
const onDocumentKey = (e) => {
    keyMap[e.code] = e.type === 'keydown'
}
document.addEventListener('keydown', onDocumentKey, false)
document.addEventListener('keyup', onDocumentKey, false)

// --- Resize ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

let t1 = performance.now(); // Timer fin du chargement
console.log("Temps de chargement : " + ((t1 - t0) / 1000).toFixed(4) + "s");

// --- Boucle de rendu ---
const velocity = 0.05;
function animate() {
    requestAnimationFrame(animate)
    if (keyMap['KeyW'] || keyMap['ArrowUp']) {
        controls.moveForward(velocity)
    }
    if (keyMap['KeyS'] || keyMap['ArrowDown']) {
        controls.moveForward(-velocity)
    }
    if (keyMap['KeyA'] || keyMap['ArrowLeft']) {
        controls.moveRight(-velocity)
    }
    if (keyMap['KeyD'] || keyMap['ArrowRight']) {
        controls.moveRight(velocity)
    }
    if (keyMap['KeyP']) {
        console.log(camera.position)
    }


    stats.update();
    renderer.render(scene, camera);
}

animate();