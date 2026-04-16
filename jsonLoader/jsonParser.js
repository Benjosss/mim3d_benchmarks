export default class JsonParser {
    /**
     * Constructeur du parseur
     * @param filePath Chemin du fichier de données
     */
    constructor(filePath) {
        this.filePath = filePath;
    }

    /**
     * Retourne les données parsées
     * @param data
     * @returns {*}
     */
    parse(data) {
        return data;
    }

    /**
     * Lit et parse le fichier de données
     * @returns {Promise<any>}
     */
    fetchJSONData() {
        return fetch(this.filePath)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Erreur, statut : ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                return this.parse(data);
            })
            .catch(error => {
                console.error('Erreur lors de la récupération :', error);
            });
    }
}