/*
 ******
 * DB *
 ******
 */
export class LocalStorageWrapper {
    constructor() { }
    set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
    get(key) {
        return JSON.parse(localStorage.getItem(key));
    }
    getMany(keyPrefix) {
        let results = [];
        for (let i = 0; i < localStorage.length; i++) {
            let key = localStorage.key(i);
            if (key.startsWith(keyPrefix)) {
                results.push({
                    key: key,
                    value: this.get(key),
                });
            }
        }
        return results;
    }
    remove(key) {
        localStorage.removeItem(key);
    }
    clear() {
        localStorage.clear();
    }
}
