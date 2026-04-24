import * as THREE from "three";

export class Zone {
    DEBUG_IMPOSTORS_OPACITY = true;

    /**
     * Constructeur de la classe Zone permettant de construire la hierarchie des zones
     * @param config
     */
    constructor(config) {
        this.name = config.name;                                    // Nom de la zone
        this.modelPath = config.path;                               // Chemin du fichier .glb HD de la zone
        this.impostorPath = config.impostorPath;                    // Chemin du fichier .glb SD de la zone
        this.adjacentZoneNames = config.adjacentZoneNames ?? [];    // Tableau des noms des zones adjacentes
        this.type = config.type;                                    // Type de zone
        this.triggerBox = config.triggerBox;                        // Trigger Box de la zone

        this.content = null;                                        // THREE.Group
        this.impostorContent = null;

        this.isLoaded = false;                                      // Status zone chargée ou non
        this.isImpostorLoaded = false;
        this.isLoading = false;                                     // Status zone en chargement ou non
        this.isVisible = false;                                     // Status zone visible ou non
    }

    /**
     * Charge le modèle en arrière-plan sans l'afficher.
     * Calcule le BVH sur chaque géométrie pour les collisions.
     * @param loader GLTFLoader
     * @returns {Promise<void>}
     */
    async load(loader) {
        if (this.isLoaded || this.isLoading) return; // Zone déjà traitée

        this.isLoading = true; // Début du chargement

        try {
            const gltf = await loader.loadAsync(this.modelPath); // Chargement du modèle
            this.content = gltf.scene;

            // Préparation des meshes invisibles pour le moment
            this.content.visible = false; // Meshes invisibles
            this.colliderMeshes = [];

            // Propriétés des meshes
            this.content.traverse(child => {
                if (child.isMesh) {
                    // Ombrages
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material.map) {
                        child.material.map.anisotropy = 16;
                    }

                    if(this.type === "floor"){
                        // Calcul du BVH en arrière-plan après le chargement.
                        child.geometry.computeBoundsTree();
                        child.updateMatrixWorld(true);
                        this.colliderMeshes.push(child);
                    }
                }
            });

            this.isLoaded = true; // Chargé
            this.isLoading = false; // Plus en chargement
            console.log(`Zone "${this.name}" chargée — ${this.colliderMeshes.length} colliders BVH.`);

        } catch (e) {
            this.isLoading = false; // Plus en chargement
            console.error(`Erreur de chargement de la zone ${this.name} :`, e);
            throw e;
        }
    }

    async loadImpostor(loader) {
        if (this.isImpostorLoaded || !this.impostorPath) return;

        const gltf = await loader.loadAsync(this.impostorPath);
        this.impostorContent = gltf.scene;

        this.impostorContent.traverse(child => {
            if (child.isMesh) {
                if (this.DEBUG_IMPOSTORS_OPACITY) {
                    child.material.format = THREE.RGBAFormat;
                    child.material.transparent = true;
                    child.material.opacity = 0.5;
                }
                child.castShadow = false;
                child.receiveShadow = true;
            }
        });

        // alignement avec la vraie zone
        if (this.content) {
            this.impostorContent.position.copy(this.content.position);
            this.impostorContent.rotation.copy(this.content.rotation);
            this.impostorContent.scale.copy(this.content.scale);
        }

        this.impostorContent.visible = false;
        this.isImpostorLoaded = true;
    }

    /**
     * Ajoute le contenu à la scène et le rend visible.
     * @param scene THREE.Scene
     */
    show(scene) {
        if (!this.isLoaded || this.isVisible) return; // La zone n'est pas chargée ou déjà traitée
        scene.add(this.content); // Ajout du modèle à la scène
        this.content.visible = true; // Visible
        this.isVisible = true; // Status visible
        console.log(`Zone ${this.name} affichée.`);
    }

    /**
     * Retire le contenu de la scène sans libérer la mémoire.
     * @param scene THREE.Scene
     */
    hide(scene) {
        if (!this.isVisible) return; // La zone est déjà cachée
        scene.remove(this.content); // Retrait du modèle de la scène
        this.isVisible = false; // Status non visible
        console.log(`Zone ${this.name} cachée.`);
    }

    /**
     * Retire le contenu de la scène et libère la mémoire GPU + BVH.
     * @param scene THREE.Scene
     */
    unload(scene) {
        if (!this.isLoaded) return; // On ne décharge que si le HD est là

        this.hide(scene); // On retire le modèle HD de la scène

        // On vide uniquement le contenu lourd (Meshes HD + BVH)
        this.content.traverse(child => {
            if (child.isMesh) {
                // Libération de la mémoire BVH
                if (child.geometry.boundsTree) {
                    child.geometry.disposeBoundsTree();
                }
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => this._disposeMaterial(m));
                } else {
                    this._disposeMaterial(child.material);
                }
            }
        });

        this.content = null; // Modèle plus chargé
        this.isLoaded = false; // Zone non chargée
        this.isLoading = false; // Zone non en chargement
        this.colliderMeshes = [];

        console.log(`Zone "${this.name}" déchargée de la mémoire`);
    }

    /**
     * Libération des textures du matériau
     * @param material Matériau
     * @private
     */
    _disposeMaterial(material) {
        for (const key of Object.keys(material)) {
            const value = material[key];
            if (value && value.isTexture) value.dispose();
        }
        material.dispose();
    }

    /**
     * Retourne si un point est dans une TriggerBox de la zone
     * @param point THREE.Vector3
     * @returns {boolean}
     */
    isPointInside(point) {
        return this.triggerBox.containsPoint(point);
    }
}