export class ZoneManager {

    constructor({scene, loader, colliderMeshes, unloadDistance = 3}) {
        this.scene = scene;                     // Scène
        this.loader = loader;                   // GLTF Loader
        this.unloadDistance = unloadDistance;   // Distance de déchargement en nombre de zones
        this.colliderMeshes = colliderMeshes; // Tableau partagé avec main.js pour ajouter/retirer les meshs selon les zones visibles
        this.zones = new Map();                 // Zones administrées
        this.currentZone = null;                // Zone courant de l'utilisateur
        this.managedZones = new Set();          // Zones dont le chargement est en cours ou terminé
        this._transitioning = false;            // Transition unique
        this._loadQueue = [];                   // File d'attente des chargments
        this._isProcessingQueue = false;        // Status file d'attente
        this._rebuildScheduled = false;         // Rebuild différé
    }

    // =====================================================
    // API PUBLIQUE
    // =====================================================

    /**
     * Enregistre une zone dans le manager.
     * Appel une fois sur toutes les zones au démarrage.
     * @param zone Zone
     */
    registerZone(zone) {
        this.zones.set(zone.name, zone);
        console.log(`Zone ${zone.name} enregistrée.`);
    }

    /**
     * Gère les transitions et les chargements de manière non blocante.
     * @param playerPosition THREE.Vector3
     */
    update(playerPosition) {
        this._detectZoneChange(playerPosition); // Détecte si le joueur a changé de position
    }

    /**
     * Charge la zone de départ (bloquant) puis précharge les adjacentes.
     * @param {string} startZoneName
     */
    async init(startZoneName) {
        const startZone = this.zones.get(startZoneName); // Récupération de la zone

        if (!startZone) {
            console.error(`Zone de départ ${startZoneName} introuvable.`); // Zone non trouvée dans le manager
            return;
        }

        console.log(`Initialisation sur la zone ${startZoneName}.`);

        // Chargement en priorité de la zone de spawn (bloquant)
        await this._loadZone(startZone);
        this._showZone(startZone);
        this.currentZone = startZone;

        // Premier rebuild accepté bloquant ici
        this._rebuildColliders();

        // Chargement des zones adjacentes en arrière-plan (non bloquant)
        this._queueAdjacentZones(startZone);
    }


    // =====================================================
    // DETECTION DE TRANSITION
    // =====================================================

    _detectZoneChange(playerPosition) {
        if (!this.currentZone) return;

        if (this.currentZone.isPointInside(playerPosition)) return; // Le joueur est dans sa zone actuelle

        // Recherche dans quelle zone adjacente il se trouve
        for (const adjName of this.currentZone.adjacentZoneNames) {
            const zone = this.zones.get(adjName);
            if (zone?.isPointInside(playerPosition)) {
                this._triggerTransition(zone);
                return;
            }
        }

        // Recherche dans toutes les zones chargées
        for (const [, zone] of this.zones) {
            if (zone !== this.currentZone && zone.isLoaded && zone.isPointInside(playerPosition)) {
                this._triggerTransition(zone);
                return;
            }
        }
    }

    // =====================================================
    // TRANSITION
    // =====================================================


    async _triggerTransition(newZone) {
        if (this._transitioning) return; // Transition déjà en cours
        if (newZone === this.currentZone) return; // Zone actuelle
        this._transitioning = true; // Début de la transition

        try {
            const previousZone = this.currentZone;
            console.log(`Transition : "${previousZone?.name}" → "${newZone.name}"`);

            // Zone pas encore chargée, attente sans blocage
            if (!newZone.isLoaded) {
                console.warn(`Zone "${newZone.name}" pas encore prête...`);
                await this._loadZone(newZone);
            }

            // Affichage de la nouvelle zone
            this._showZone(newZone);
            // Affichage de toutes les zones adjacentes à la nouvelle zone
            for (const adjName of newZone.adjacentZoneNames) {
                const adjZone = this.zones.get(adjName);
                if (adjZone?.isLoaded) this._showZone(adjZone);
            }

            this.currentZone = newZone;

            // Mise à jour différée du tableau de colliders
            this._scheduleColliderRebuild();

            // Déchargement des zones trop éloignées (non bloquant)
            this._scheduleUnloadFarZones(previousZone);

            // Préchargement des nouvelles zones adjacentes en arrière-plan
            this._queueAdjacentZones(newZone);

        } catch (e) {
            console.error('Erreur lors de la transition :', e);
        } finally {
            this._transitioning = false; // Fin de la transition
        }
    }

    // =====================================================
    // CHARGEMENT ET DÉCHARGEMENT
    // =====================================================

    async _manageImpostorVisibility(zone, visible) {
        if (visible) {
            if (!zone.isImpostorLoaded) {
                await zone.loadImpostor(this.loader);
            }

            if (zone.impostorContent && !zone.impostorContent.parent) {
                this.scene.add(zone.impostorContent);
            }

            zone.impostorContent.visible = true;

        } else {
            if (zone.impostorContent) {
                zone.impostorContent.visible = false;
            }
        }
    }

    _scheduleUnloadFarZones(previousZone) {
        setTimeout(async () => {
            if (!this.currentZone) return;

            // Zones en être en HD (actuelle + voisines directes)
            const highDetailNames = new Set([
                this.currentZone.name,
                ...this.currentZone.adjacentZoneNames,
            ]);

            for (const [name, zone] of this.zones) {
                const isHDNeeded = highDetailNames.has(name);

                if (isHDNeeded) {
                    // --- MODE HAUTE DÉFINITION ---
                    if (zone.isLoaded) {
                        this._showZone(zone); // Affiche le HD et cache l'imposteur
                    }
                    // Si pas chargé, le queueManager s'en occupera
                } else {
                    // --- MODE IMPOSTEUR ---
                    if (zone.isVisible) {
                        zone.hide(this.scene); // Cache le HD si présent
                    }

                    // On affiche l'imposteur
                    if (zone.impostorPath) {
                        await this._manageImpostorVisibility(zone, true);
                    }

                    // On décharge la mémoire HD si la zone est loin
                    const wasAdjacent = previousZone?.adjacentZoneNames.includes(name);
                    if (!wasAdjacent) {
                        zone.unload(this.scene); // Ne videra que le HD avec la modif ci-dessus
                        this.managedZones.delete(name);
                    }
                }
            }

            this._scheduleColliderRebuild();
        }, 100);
    }

    _showZone(zone) {
        if (!zone.isLoaded) return;

        zone.show(this.scene);

        if (zone.impostorContent) {
            zone.impostorContent.visible = false;
        }
    }

    async _loadZone(zone) {
        if (zone.isLoaded || zone.isLoading) return;
        await zone.load(this.loader);
        this.managedZones.add(zone.name);
    }

    _queueAdjacentZones(zone) {
        for (const name of zone.adjacentZoneNames) {
            const z = this.zones.get(name);
            if (!z || z.isLoaded || z.isLoading) continue;

            if (!this._loadQueue.includes(z)) {
                this._loadQueue.push(z);
            }
        }
        this._processQueue();
    }

    async _processQueue() {
        if (this._isProcessingQueue) return;
        this._isProcessingQueue = true;

        while (this._loadQueue.length > 0) {
            const zone = this._loadQueue.shift();

            await new Promise(r => setTimeout(r, 0));

            if (!zone.isLoaded) {
                await this._loadZone(zone);

                if (this.currentZone?.adjacentZoneNames.includes(zone.name)) {
                    this._showZone(zone);
                    this._scheduleColliderRebuild();
                }
            }
        }

        this._isProcessingQueue = false;
    }

    // =====================================================
    // BVH — GESTION DU TABLEAU DE COLLIDERS
    // =====================================================

    /**
     * Planifie une mise à jour du tableau colliderMeshes hors de la frame courante.
     * Les multiples appels sont fusionnés en un seul rebuild.
     */
    _scheduleColliderRebuild() {
        if (this._rebuildScheduled) return;
        this._rebuildScheduled = true;

        setTimeout(() => {
            this._rebuildColliders();
            this._rebuildScheduled = false;
        }, 0);
    }

    /**
     * Reconstruit le tableau colliderMeshes depuis les zones visibles.
     */
    _rebuildColliders() {
        // Vide le tableau partagé en place (sans recréer la référence)
        this.colliderMeshes.length = 0;

        let totalMeshes = 0;
        for (const [, zone] of this.zones) {
            if (zone.isVisible && zone.colliderMeshes?.length) {
                for (const mesh of zone.colliderMeshes) {
                    // updateMatrixWorld pour que les transforms soient à jour
                    mesh.updateMatrixWorld(true);
                    this.colliderMeshes.push(mesh);
                }
                totalMeshes += zone.colliderMeshes.length;
            }
        }

        console.log(`Colliders BVH mis à jour : ${totalMeshes} mesh(es) actifs.`);
    }

    // =====================================================
    // DEBUG
    // =====================================================

    getStatus() {
        const status = [];
        for (const [name, zone] of this.zones) {
            const isCurrent = zone === this.currentZone;

            status.push({
                name,
                // Utilisation d'emojis pour simuler la couleur
                loaded: zone.isLoaded ? "✅" : "❌",
                loading: zone.isLoading ? "⏳" : "⚪",
                visible: zone.isVisible ? "👁️" : "🌑",
                colliders: zone.colliderMeshes?.length ?? 0,
                current: isCurrent ? "⭐" : "❌",
            });
        }
        console.table(status);
        return status;
    }
}