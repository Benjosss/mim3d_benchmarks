import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

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
`;
document.body.appendChild(loadingScreen);

const loadingBar = document.getElementById('loading-bar');
const loadingPercent = document.getElementById('loading-percent');

// --- Scene ---
const stats = new Stats();
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 5;
controls.maxDistance = 100;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

const fillLight = new THREE.PointLight(0x4466ff, 0.8, 100);
fillLight.position.set(-10, 5, -10);
scene.add(fillLight);

// --- Chargement avec progression ---
const loader = new FBXLoader();
const object = await loader.loadAsync('salle_meca.fbx', (event) => {
    if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        loadingBar.style.width = `${percent}%`;
        loadingPercent.textContent = `${percent}%`;
    }
});

object.traverse(child => {
    if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
    }
});
object.scale.setScalar(0.1);
scene.add(object);

// Cacher l'écran de chargement
loadingScreen.style.transition = 'opacity 0.5s';
loadingScreen.style.opacity = '0';
setTimeout(() => loadingScreen.remove(), 500);

// --- Resize ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Boucle de rendu ---
function animate() {
    stats.update();
    controls.update();
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);