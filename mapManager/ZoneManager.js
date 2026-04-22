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
            const adjZone = this.zones.get(adjName);
            if (!adjZone) continue;

            if (adjZone.isPointInside(playerPosition)) {
                this._triggerTransition(adjZone);
                return;
            }
        }

        // Recherche dans toutes les zones chargées
        for (const [, zone] of this.zones) {
            if (zone === this.currentZone) continue;
            if (zone.isLoaded && zone.isPointInside(playerPosition)) {
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

    /**
     * Charge une zone immédiatement
     * @param zone
     * @returns {Promise<void>}
     * @private
     */
    async _loadZone(zone) {
        if (zone.isLoaded || zone.isLoading) return; // Zone déjà traitée ou en cours de traitement
        await zone.load(this.loader); // Chargement de la zone
        this.managedZones.add(zone.name); // Ajout aux zones managées (en cours de chargement ou chargées)
    }

    /**
     * Ajoute des zones à la file d'attente de chargement en arrière-plan.
     * Zones chargées une par une.
     * @param zone
     * @private
     */
    _queueAdjacentZones(zone) {
        for (const adjacentName of zone.adjacentZoneNames) {
            const adjacentZone = this.zones.get(adjacentName);
            if (!adjacentZone) continue; // Zone introuvable
            if (adjacentZone.isLoaded || adjacentZone.isLoading) continue; // Zone déjà traitée ou en cours de chargement

            if (this._loadQueue.includes(adjacentZone)) continue; // Zone déjà dans la file d'attente

            this._loadQueue.push(adjacentZone); // Ajout à la file d'attente
            console.log(`Zone ${adjacentName} ajoutée à la file d'attente de préchargement.`);
        }
        this._processQueue(); // Traitement de la file
    }

    /**
     * Traite la file d'attente de chargement en arrière-plan une zone à la fois.
     * Ne bloque pas la boucle de rendu
     * @returns {Promise<void>}
     * @private
     */
    async _processQueue() {
        if (this._isProcessingQueue) return; // File d'attente déjà en cours de traitement
        this._isProcessingQueue = true; // Début du traitement

        while (this._loadQueue.length > 0) {
            const zone = this._loadQueue.shift();

            // Laisse le contrôle au navigateur entre chaque chargement
            await new Promise(resolve => setTimeout(resolve, 0));

            if (!zone.isLoaded && !zone.isLoading) {
                await this._loadZone(zone); // Chargement de la zone

                // Affichage de la zone si elle est adjacente à la zone courante
                if (this.currentZone?.adjacentZoneNames.includes(zone.name)) {
                    this._showZone(zone);
                    // Mise à jour différée
                    this._scheduleColliderRebuild();
                }
            }
        }

        this._isProcessingQueue = false; // Fin du traitement
    }

    /**
     * Masque les zones qui ne sont plus adjacentes à la zone actuelle et décharge les zones les plus éloignées.
     * Non bloquant.
     * @param previousZone
     * @private
     */
    _scheduleUnloadFarZones(previousZone) {
        // Traitement différent (non bloquant)
        setTimeout(() => {
            if (!previousZone) return; // Zone précédente introuvable

            // Garde en mémoire les noms des zones
            const keepNames = new Set([
                this.currentZone.name,
                ...this.currentZone.adjacentZoneNames,
            ]);

            for (const [name, zone] of this.zones) {
                if (keepNames.has(name)) continue;
                if (!zone.isLoaded && !zone.isVisible) continue;

                // Masquer les zones adjacentes à la précédente, mais pas à l'actuelle
                if (zone.isVisible) {
                    zone.hide(this.scene);
                }

                // Déchargement complètement les zones vraiment loin
                const wasAdjacentToPrevious = previousZone.adjacentZoneNames.includes(name);
                if (!wasAdjacentToPrevious) {
                    zone.unload(this.scene);
                    this.managedZones.delete(name);
                }
            }

            // Mise à jour après nettoyage
            this._scheduleColliderRebuild();

        }, 100); // Délais de 100ms
    }

    _showZone(zone) {
        if (!zone.isLoaded) return; // La zone n'est pas chargée
        zone.show(this.scene); // Affichage de la zone

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