import * as THREE from "three";
import {Octree} from 'three/examples/jsm/math/Octree.js'

export class ZoneManager {
    constructor({scene, loader, worldOctree, unloadDistance = 3}) {
        this.scene = scene;                     // Scène
        this.loader = loader;                   // GLTF Loader
        this.worldOctree = worldOctree;         // Octree
        this.unloadDistance = unloadDistance;   // Distance de déchargement en nombre de zones
        this.zones = new Map();                 // Zones administrées
        this.currentZone = null;                // Zone courant de l'utilisateur
        this.managedZones = new Set();          // Zones dont le chargement est en cours ou terminé
        this._transitioning = false;            // Transition unique
        this._loadQueue = [];                   // File d'attente des chargments
        this._isProcessingQueue = false;        // Status file d'attente
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
     *
     * @param startZoneName
     * @returns {Promise<void>}
     */
    async init(startZoneName){
        const startZone = this.zones.get(startZoneName); // Récupération de la zone

        if(!startZone){
            console.error(`Zone de départ ${startZoneName} introuvable.`); // Zone non trouvée dans le manager
            return;
        }

        console.log(`Initialisation sur la zone ${startZoneName}.`);

        // Chargement en priorité de la zone de spawn (bloquant)
        await this._loadZone(startZone);
        this._showZone(startZone);
        this.currentZone = startZone;
        this._rebuildOctree();

        // Chargement des zones adjacentes en arrière-plan (non bloquant)
        this._queueAdjacentZones(startZone);
    }


    // =====================================================
    // DETECTION DE TRANSITION
    // =====================================================

    _detectZoneChange(playerPosition) {
        if(!this.currentZone) return;

        if(this.currentZone.isPointInside(playerPosition)) return; // Le joueur est dans sa zone actuelle

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

        const previousZone = this.currentZone;
        console.log(`Transition : "${previousZone?.name}" vers "${newZone.name}"`);

        // Zone pas encore chargée, attente sans blocage
        if (!newZone.isLoaded) {
            console.warn(`Zone "${newZone.name}" pas encore prête...`);
            await this._loadZone(newZone);
        }

        // Affichage de la nouvelle zone
        this._showZone(newZone);
        this.currentZone = newZone;

        // Rebuild de l'Octree avec les zones actuellement visibles
        this._rebuildOctree();

        // Déchargement des zones trop éloignées (non bloquant)
        this._scheduleUnloadFarZones(previousZone);

        // Préchargement des nouvelles zones adjacentes en arrière-plan
        this._queueAdjacentZones(newZone);

        this._transitioning = false; // Fin de la transition
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
    async _loadZone(zone){
        if(zone.isLoaded || zone.isLoading) return; // Zone déjà traitée ou en cours de traitement
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
        for(const adjacentName of zone.adjacentZoneNames){
            const adjacentZone = this.zones.get(adjacentName);
            if(!adjacentZone) continue; // Zone introuvable
            if(adjacentZone.isLoaded || adjacentZone.isLoading) continue; // Zone déjà traitée ou en cours de chargement

            if(this._loadQueue.includes(adjacentZone)) continue; // Zone déjà dans la file d'attente

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
        if(this._isProcessingQueue) return; // File d'attente déjà en cours de traitement
        this._isProcessingQueue = true; // Début du traitement

        while(this._loadQueue.length > 0) {
            const zone = this._loadQueue.shift();

            // Laisse le contrôle au navigateur entre chaque chargemen
            await new Promise(resolve => setTimeout(resolve, 0));

            if(!zone.isLoaded && !zone.isLoading){
                await this._loadZone(zone); // Chargement de la zone
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
        setTimeout(()=>{
            if(!previousZone) return; // Zone précédente introuvable

            // Garde en mémoire les noms des zones
            const keepNames = new Set([
                this.currentZone.name,
                ...this.currentZone.adjacentZoneNames,
            ]);

            for(const [name, zone] of this.zones) {
                if(keepNames.has(name)) continue;
                if(!zone.isLoaded && !zone.isVisible) continue;

                // Masquer les zones adjacentes à la précédente, mais pas à l'actuelle
                if(zone.isVisible){
                    zone.hide(this.scene);
                }

                // Déchargement complètement les zones vraiment loin
                const wasAdjacentToPrevious = previousZone.adjacentZoneNames.include(name);
                if(!wasAdjacentToPrevious){
                    zone.unload(this.scene);
                    this.managedZones.delete(name);
                }
            }

            // Rebuild du Octree après le nettoyage
            this._rebuildOctree();
        }, 100); // Délais de 100ms
    }

    _showZone(zone) {
        if(!zone.isLoaded) return; // La zone n'est pas chargée
        zone.show(this.scene); // Affichage de la zone

    }

    // =====================================================
    // OCTREE
    // =====================================================

    /**
     * Reconstruit l'Octree depuis toutes les zones visibles.
     * Appelé uniquement lors des transitions
     * @private
     */
    _rebuildOctree() {
        this.worldOctree.clear?.(); // Nettoyage de l'Octree du monde s'il existe

        // Fallback si clear n'existe pas dans la version de THREEJS
        try{ this.worldOctree.clear(); }
        catch {}

        let count = 0;
        for(const [,zone] of this.zones) {
            if(zone.isVisible && zone.content){
                zone.content.updateMatrixWorld(true);
                this.worldOctree.fromGraphNode(zone.content);
                count++;
            }
        }

        console.log(`Octree reconstruit depuis ${count} zone(s) visible(s).`);
    }

    // =====================================================
    // DEBUT
    // =====================================================

    getStatus(){
        const status = [];
        for (const [name, zone] of this.zones) {
            status.push({
                name,
                loaded:  zone.isLoaded,
                loading: zone.isLoading,
                visible: zone.isVisible,
                current: zone === this.currentZone,
            });
        }
        console.table(status);
        return status;
    }
}